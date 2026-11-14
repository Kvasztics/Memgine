import hashlib
import json
import os
import re
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, client TEXT NOT NULL, user_id TEXT NOT NULL,
    model_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
    UNIQUE (client, user_id, model_id, conversation_id, message_id)
);
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, client TEXT NOT NULL, user_id TEXT NOT NULL,
    model_id TEXT NOT NULL, conversation_id TEXT, kind TEXT NOT NULL,
    text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS memories_scope ON memories(client,user_id,model_id,active);
"""


def required(body, field, maximum=256):
    value = body.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"Invalid {field}")
    return value


def ingest(db, client, body):
    scope = (client, required(body, "user_id"), required(body, "model_id"),
             required(body, "conversation_id"), required(body, "message_id"))
    text = required(body, "text", 65536)
    with db:
        db.execute(
            """INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
               ON CONFLICT(client,user_id,model_id,conversation_id,message_id) DO NOTHING""",
            (uuid4().hex, *scope, text),
        )
        job = db.execute(
            """SELECT id, text, status FROM jobs
               WHERE client=? AND user_id=? AND model_id=? AND conversation_id=? AND message_id=?""",
            scope,
        ).fetchone()
        if job[1] != text:
            return 409, {"error": "Message ID already exists with different text"}
        return 202, {"job_id": job[0], "status": job[2]}


def search(db, client, body):
    user = required(body, "user_id")
    model = required(body, "model_id")
    conversation = required(body, "conversation_id") if body.get("conversation_id") is not None else None
    limit = body.get("limit", 3)
    if type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError("Invalid limit")
    terms = set(re.findall(r"\w+", required(body, "query", 8192).casefold()))
    rows = db.execute(
        """SELECT id, kind, text, conversation_id FROM memories
           WHERE client=? AND user_id=? AND model_id=? AND active=1
             AND (kind IN ('profile','context') OR (kind='project' AND conversation_id=?))
           ORDER BY id""",
        (client, user, model, conversation),
    )
    ranked = []
    for memory in rows:
        score = len(terms & set(re.findall(r"\w+", memory[2].casefold())))
        if score or memory[1] == "profile":
            ranked.append((memory[1] == "profile", score, memory))
    ranked.sort(key=lambda item: item[:2], reverse=True)
    fields = ("id", "kind", "text", "conversation_id")
    return 200, {"memories": [dict(zip(fields, row)) for _, _, row in ranked[:limit]]}


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        supplied = self.headers.get("Authorization", "").encode()
        client = self.server.clients.get(hashlib.sha256(supplied).digest())
        if client is None:
            self.respond(401, {"error": "Unauthorized"})
            return
        operation = {
            "/v1/memory/search": search,
            "/v1/memory/ingest": ingest,
        }.get(self.path)
        if operation is None:
            self.respond(404, {"error": "Endpoint not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 524288:
                self.respond(413, {"error": "Invalid body size"})
                return
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object")
            with closing(sqlite3.connect(self.server.database)) as db:
                status, payload = operation(db, client, body)
        except ValueError as error:
            self.respond(400, {"error": str(error)})
            return
        except sqlite3.Error:
            self.respond(503, {"error": "Storage unavailable"})
            return
        self.respond(status, payload)


def create_server(database, keys, port=8079):
    if not keys or any(not isinstance(key, str) or not key.strip() for key in keys.values()):
        raise ValueError("Configure nonempty client keys")
    if len(set(keys.values())) != len(keys):
        raise ValueError("Client keys must be distinct")
    with closing(sqlite3.connect(database)) as db:
        db.executescript(SCHEMA)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.database = database
    server.clients = {
        hashlib.sha256(f"Bearer {key}".encode()).digest(): client
        for client, key in keys.items()
    }
    return server


if __name__ == "__main__":
    with create_server(os.environ.get("MEMGINE_DB", "memgine.sqlite"),
                       {"mara": os.environ["MEMGINE_API_KEY"]},
                       int(os.environ.get("MEMGINE_PORT", "8079"))) as server:
        server.serve_forever()
