from memgine_config import setting
from prompts import SYSTEM_PROMPT

import hashlib
import json
import logging
import re
import sqlite3
import sys
import subprocess

import splade
import ui_settings
import hmac
import os
from urllib.request import Request, urlopen
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4
from pathlib import Path
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from time import perf_counter

LOG = logging.getLogger("memgine")

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
CREATE TABLE IF NOT EXISTS splade_vectors (
    memory_id TEXT PRIMARY KEY, version TEXT NOT NULL, weights TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_scope ON memories(client,user_id,model_id,active);
"""


def required(body, field, maximum=256):
    value = body.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"Invalid {field}")
    return value


def message_context(body):
    history = body.get("history", [])
    if not isinstance(history, list) or len(history) > 2:
        raise ValueError("Invalid recent history")
    for entry in history:
        if (not isinstance(entry, dict) or entry.get("role") not in ("user", "assistant")
                or not isinstance(entry.get("content"), str) or len(entry["content"]) > 2000):
            raise ValueError("Invalid recent message")
    timezone = body.get("timezone", setting("MEMGINE_TIMEZONE"))
    if not isinstance(timezone, str) or not 1 <= len(timezone) <= 128:
        raise ValueError("Invalid time zone")
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Invalid time zone") from error
    return json.dumps({"received_at": datetime.now(zone).isoformat(),
                       "timezone": timezone, "history": history}, ensure_ascii=False)


def ingest(db, client, body):
    scope = (client, required(body, "user_id"), required(body, "model_id"),
             required(body, "conversation_id"), required(body, "message_id"))
    text = required(body, "text", 65536)
    context = message_context(body)
    review_required = body.get("review_required")
    if "review_required" in body and type(review_required) is not bool:
        raise ValueError("Invalid review_required")
    with db:
        db.execute(
            """INSERT INTO jobs (id, client, user_id, model_id, conversation_id, message_id, text, status, review_required, message_context) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
               ON CONFLICT(client,user_id,model_id,conversation_id,message_id) DO NOTHING""",
            (uuid4().hex, *scope, text, review_required, context),
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
    query = required(body, "query", 8192)
    started = perf_counter()
    terms = set(re.findall(r"\w+", query.casefold()))
    rows = db.execute(
        """SELECT id, kind, text, conversation_id FROM memories
           WHERE client=? AND user_id=? AND model_id=? AND active=1
             AND (expires_at IS NULL OR expires_at > unixepoch())
             AND (kind IN ('profile','context') OR (kind='project' AND conversation_id=?))
           ORDER BY id""",
        (client, user, model, conversation),
    ).fetchall()
    sparse = {}
    used = "lexical"
    engine = setting("MEMGINE_SEARCH_ENGINE").strip().lower()
    if engine not in ("lexical", "splade"):
        raise ValueError("Invalid search engine")
    if engine == "splade" and any(row[1] != "profile" for row in rows):
        try:
            config = splade.encoder()
            vectors = db.execute(
                """SELECT v.memory_id, v.weights FROM splade_vectors v
                   JOIN memories m ON m.id=v.memory_id
                   WHERE v.version=? AND m.client=? AND m.user_id=? AND m.model_id=?
                     AND m.active=1 AND (m.expires_at IS NULL OR m.expires_at > unixepoch())
                     AND (m.kind='context' OR
                         (m.kind='project' AND m.conversation_id=?))""",
                (config[0], client, user, model, conversation),
            ).fetchall()
            sparse = splade.scores(query, vectors, config)
            if any(weights for _, weights in vectors):
                used = "splade"
        except (OSError, subprocess.SubprocessError) as error:
            LOG.warning("search_fallback engine=splade fallback=lexical error=%s", type(error).__name__)
    ranked = []
    for memory in rows:
        score = len(terms & set(re.findall(r"\w+", memory[2].casefold())))
        sparse_score = sparse.get(memory[0], 0)
        if score or sparse_score or memory[1] == "profile":
            ranked.append((memory[1] == "profile", sparse_score, score, memory))
    ranked.sort(key=lambda item: item[:3], reverse=True)
    fields = ("id", "kind", "text", "conversation_id")
    LOG.info("search configured=%s engine=%s elapsed_ms=%.1f matches=%d",
             engine, used, (perf_counter() - started) * 1000, min(limit, len(ranked)))
    return 200, {"memories": [dict(zip(fields, row)) for _, _, _, row in ranked[:limit]]}


def replacement(db, scope, proposal):
    if proposal.get("action") != "supersede":
        return None
    return db.execute(
        """SELECT text FROM memories
           WHERE client=? AND user_id=? AND model_id=? AND active=1
             AND (expires_at IS NULL OR expires_at > unixepoch())
             AND (kind IN ('profile','context') OR conversation_id=?)
             AND id=? AND kind=?""",
        (*scope, proposal["memory_id"], proposal["kind"]),
    ).fetchone()


def list_memories(db, client, body):
    filters = ["client=?"]
    params = [client]
    for field in ("user_id", "model_id", "conversation_id", "kind"):
        if body.get(field):
            filters.append(f"{field}=?")
            params.append(required(body, field))
    query = body.get("query", "")
    if query:
        filters.append("instr(lower(text), lower(?)) > 0")
        params.append(required(body, "query", 500))
    if body.get("include_inactive") is not True:
        filters.append("active=1 AND (expires_at IS NULL OR expires_at > unixepoch())")
    offset = body.get("offset", 0)
    if type(offset) is not int or not 0 <= offset <= 1000000:
        raise ValueError("Invalid offset")
    fields = ["id", "user_id", "model_id", "conversation_id", "kind", "text", "active", "event_date", "expires_at"]
    rows = db.execute(
        f"SELECT {', '.join(fields)} FROM memories WHERE {' AND '.join(filters)} "
        "ORDER BY rowid DESC LIMIT 26 OFFSET ?", (*params, offset),
    ).fetchall()
    return 200, {"memories": [dict(zip(fields, row)) for row in rows[:25]], "more": len(rows) > 25}


def delete_memory(db, client, body):
    memory_id = required(body, "id")
    with db:
        db.execute("BEGIN IMMEDIATE")
        deleted = db.execute(
            "DELETE FROM memories WHERE client=? AND id=?", (client, memory_id),
        ).rowcount
        if not deleted:
            return 404, {"error": "Memory not found"}
        db.execute("DELETE FROM splade_vectors WHERE memory_id=?", (memory_id,))
    LOG.info("memory_deleted id=%s", memory_id)
    return 200, {"id": memory_id}


def edit_memory(db, client, body):
    memory_id = required(body, "id")
    text = required(body, "text", 500).strip()
    with db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            """SELECT user_id, model_id, conversation_id, kind, text, active, event_date, expires_at
               FROM memories WHERE client=? AND id=?""", (client, memory_id),
        ).fetchone()
        if row is None:
            return 404, {"error": "Memory not found"}
        user, model, conversation, kind, old_text, active, event_date, expires_at = row
        if not active or (expires_at is not None and expires_at <= datetime.now().timestamp()):
            return 409, {"error": "Memory has already been replaced"}
        new_kind = body.get("kind", kind)
        if new_kind not in ("project", "profile", "context"):
            raise ValueError("Invalid memory kind")
        if new_kind == "project" and not conversation:
            raise ValueError("Project memory requires a conversation")
        if text == old_text and new_kind == kind:
            return 200, {"id": memory_id}
        new_id = uuid4().hex
        db.execute("UPDATE memories SET active=0 WHERE client=? AND id=?", (client, memory_id))
        db.execute(
            """INSERT INTO memories (id,client,user_id,model_id,conversation_id,kind,text,active,event_date,expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (new_id, client, user, model, conversation, new_kind, text, event_date, expires_at),
        )
    LOG.info("memory_edited previous_id=%s id=%s", memory_id, new_id)
    return 200, {"id": new_id}


def review_scopes(db, client, body):
    rows = db.execute(
        """SELECT user_id, model_id, COUNT(*) FROM jobs
           WHERE client=? AND status='review'
           GROUP BY user_id, model_id ORDER BY user_id, model_id""", (client,),
    )
    return 200, {"scopes": [
        {"user_id": user, "model_id": model, "total": count}
        for user, model, count in rows
    ]}


def list_reviews(db, client, body):
    scope = (client, required(body, "user_id"), required(body, "model_id"))
    rows = db.execute(
        """SELECT id, text, proposal, conversation_id, COUNT(*) OVER ()
           FROM jobs WHERE client=? AND user_id=? AND model_id=? AND status='review'
           ORDER BY rowid LIMIT 1""", scope,
    ).fetchone()
    if rows is None:
        return 200, {"total": 0, "next": None}
    job_id, source, raw, conversation, total = rows
    proposal = json.loads(raw)
    previous = replacement(db, (*scope, conversation), proposal)
    return 200, {"total": total, "next": {
        "job_id": job_id, "source": source, "proposal": proposal, "previous": previous[0] if previous else None,
    }}


def save_proposal(db, job_id, scope, proposal, action, kind, text):
    if action == "supersede":
        if kind != proposal["kind"] or not replacement(db, scope, proposal):
            return False
        db.execute("UPDATE memories SET active=0 WHERE id=?", (proposal["memory_id"],))
    db.execute(
        """INSERT INTO memories (id,client,user_id,model_id,conversation_id,kind,text,active,event_date,expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
        (job_id, *scope, kind, text, proposal.get("event_date"), proposal.get("expires_at")),
    )
    return True


def review(db, client, body):
    job_id = required(body, "job_id")
    decision = body.get("decision", "inspect")
    if decision not in ("inspect", "approve", "dismiss"):
        raise ValueError("Invalid decision")
    with db:
        db.execute("BEGIN IMMEDIATE")
        job = db.execute(
            """SELECT status, proposal, user_id, model_id, conversation_id
               FROM jobs WHERE id=? AND client=?""", (job_id, client)
        ).fetchone()
        if job is None:
            return 404, {"error": "Job not found"}
        status, raw, user, model, conversation = job
        proposal = json.loads(raw) if raw else None
        for field, value in (("user_id", user), ("model_id", model)):
            if field in body and required(body, field) != value:
                return 404, {"error": "Job not found"}
        if decision == "inspect":
            return 200, {"job_id": job_id, "status": status, "proposal": proposal}
        if status != "review":
            return 409, {"error": "Job is not awaiting review"}
        if decision == "approve":
            text = required(body, "text", 500).strip() if "text" in body else proposal["text"]
            kind = body.get("kind", proposal["kind"])
            if kind not in ("profile", "project", "context"):
                raise ValueError("Invalid memory kind")
            action = body.get("mode", proposal["action"])
            if action not in ("add", "supersede"):
                raise ValueError("Invalid approval mode")
            if not save_proposal(db, job_id, (client, user, model, conversation), proposal, action, kind, text):
                return 409, {"error": "Replacement target unavailable or kind changed"}
        status = "approved" if decision == "approve" else "dismissed"
        db.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    LOG.info("review id=%s decision=%s status=%s", job_id, decision, status)
    return 200, {"job_id": job_id, "status": status}


def initialize(database):
    with closing(sqlite3.connect(database)) as db, db:
        db.executescript(SCHEMA)
        db.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
        if "proposal" not in columns:
            db.execute("ALTER TABLE jobs ADD COLUMN proposal TEXT")
        if "review_required" not in columns:
            db.execute("ALTER TABLE jobs ADD COLUMN review_required INTEGER")
        if "message_context" not in columns:
            db.execute("ALTER TABLE jobs ADD COLUMN message_context TEXT")
        memory_columns = {row[1] for row in db.execute("PRAGMA table_info(memories)")}
        if "event_date" not in memory_columns:
            db.execute("ALTER TABLE memories ADD COLUMN event_date TEXT")
        if "expires_at" not in memory_columns:
            db.execute("ALTER TABLE memories ADD COLUMN expires_at INTEGER")


def extract(text, candidates=(), context=None):
    context = context or {}
    local_date = None
    if context:
        zone = ZoneInfo(context["timezone"])
        local_date = datetime.fromisoformat(context["received_at"]).astimezone(zone).date()
    message = {"message": text, "memories": candidates, "history": context.get("history", [])}
    if local_date:
        message.update({"local_date": local_date.isoformat(), "timezone": context["timezone"],
                        "tomorrow": (local_date + timedelta(days=1)).isoformat()})
    payload = {
        "model": setting("MEMGINE_EXTRACT_MODEL"),
        "temperature": float(setting("MEMGINE_EXTRACT_TEMPERATURE")),
        "max_tokens": int(setting("MEMGINE_EXTRACT_MAX_TOKENS")),
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": json.dumps(message, ensure_ascii=False)}],
    }
    request = Request(
        setting("MEMGINE_EXTRACT_URL"),
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=float(setting("MEMGINE_EXTRACT_TIMEOUT"))) as response:
        choice = json.load(response)["choices"][0]
    if choice["finish_reason"] != "stop":
        raise ValueError("Incomplete extraction response")
    proposal = json.loads(choice["message"]["content"])
    if not isinstance(proposal, dict):
        raise ValueError("Expected an extraction object")
    if proposal.get("action") == "skip":
        return "skipped", {"action": "skip"}
    kind, action = proposal.get("kind"), proposal.get("action")
    if action not in ("add", "supersede") or kind not in ("profile", "project", "context"):
        raise ValueError("Invalid extraction action or kind")
    result = {"action": action, "kind": kind, "text": required(proposal, "text", 500).strip()}
    if proposal.get("event_date") is not None:
        try:
            value = proposal["event_date"]
            event = date.fromisoformat(value)
            if not local_date or event.isoformat() != value or event < local_date:
                raise ValueError
            expiry = datetime.combine(event + timedelta(days=1), time.min, tzinfo=zone)
        except (TypeError, ValueError, OverflowError):
            return "skipped", {"action": "skip", "reason": "invalid event date"}
        result.update(event_date=value, expires_at=int(expiry.timestamp()))
    if action == "supersede":
        target = proposal.get("memory_id")
        if not any(item["id"] == target and item["kind"] == kind for item in candidates):
            return "skipped", {"action": "skip", "reason": "invalid replacement target"}
        result["memory_id"] = target
    return "review", result


def work(database):
    initialize(database)
    default_policy = setting("MEMGINE_REVIEW_REQUIRED").strip().lower()
    if default_policy not in ("true", "false"):
        raise ValueError("api.review_required must be true or false")
    updated = 0
    with closing(sqlite3.connect(database)) as db:
        if setting("MEMGINE_SEARCH_ENGINE").strip().lower() == "splade":
            try:
                splade.index(db)
            except (OSError, subprocess.SubprocessError) as error:
                print(f"Memgine SPLADE indexing unavailable: {type(error).__name__}", file=sys.stderr)
        jobs = db.execute("SELECT id, text, client, user_id, model_id, conversation_id, review_required, message_context FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 3").fetchall()
        for job_id, text, client, user, model, conversation, review_required, context in jobs:
            _, result = search(db, client, {
                "user_id": user, "model_id": model, "conversation_id": conversation,
                "query": text[:8192].strip(), "limit": 8,
            })
            try:
                status, proposal = extract(text, result["memories"], json.loads(context) if context else None)
            except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
                LOG.error("extraction_failed id=%s error=%s", job_id, type(error).__name__)
                raise
            manual = default_policy == "true" if review_required is None else bool(review_required)
            with db:
                db.execute("BEGIN IMMEDIATE")
                if not db.execute("SELECT 1 FROM jobs WHERE id=? AND status='queued'", (job_id,)).fetchone():
                    continue
                if status == "review" and not manual:
                    saved = save_proposal(
                        db, job_id, (client, user, model, conversation),
                        proposal, proposal["action"], proposal["kind"], proposal["text"],
                    )
                    status = "approved" if saved else "conflict"
                updated += db.execute(
                    "UPDATE jobs SET status=?, proposal=? WHERE id=? AND status='queued'",
                    (status, json.dumps(proposal, ensure_ascii=False), job_id),
                ).rowcount
            LOG.info("job_processed id=%s mode=%s action=%s status=%s",
                     job_id, "manual" if manual else "automatic", proposal["action"], status)
    return updated


def read_logs(db, client, body):
    units = {
        "api": "memgine-api.service",
        "worker": "memgine-worker.service",
        "proxy": "memgine-proxy.service",
        "extractor": "memgine-extractor.service",
    }
    levels = {"all": 7, "info": 6, "warning": 4, "error": 3}
    source, level = required(body, "source"), required(body, "level")
    if source not in units or level not in levels:
        raise ValueError("Invalid log filter")
    try:
        result = subprocess.run(
            ["journalctl", "--user", "--unit", units[source], "--lines=300",
             "--output=json", "--no-pager"],
            capture_output=True, text=True, errors="replace", timeout=5, check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return 503, {"error": "Service journal unavailable"}
    lines = []
    for raw in result.stdout.splitlines():
        entry = json.loads(raw)
        message = entry.get("MESSAGE", "")
        if not isinstance(message, str):
            continue
        priority = int(entry.get("PRIORITY", "6"))
        match = re.match(r"^\d{4}-\d\d-\d\d \S+ (DEBUG|INFO|WARNING|ERROR|CRITICAL) memgine ", message)
        if match:
            priority = {"DEBUG": 7, "INFO": 6, "WARNING": 4, "ERROR": 3, "CRITICAL": 2}[match[1]]
        if priority <= levels[level]:
            timestamp = int(entry.get("__REALTIME_TIMESTAMP", "0")) / 1_000_000
            lines.append(f"{datetime.fromtimestamp(timestamp).isoformat(timespec='seconds')}  {message}"[:2000])
    return 200, {"lines": lines[-100:]}


def save_ui_settings(db, client, body):
    ui_settings.save(body.get("changes"))
    return 200, {"saved": True}


SERVICE_UNITS = {
    "api": "memgine-api.service",
    "proxy": "memgine-proxy.service",
    "extractor": "memgine-extractor.service",
    "worker": "memgine-worker.timer",
}


def service_control(db, client, body):
    action = body.get("action")
    if action == "status":
        states = {}
        for name, unit in SERVICE_UNITS.items():
            result = subprocess.run(
                ["systemctl", "--user", "show", "--property=LoadState,ActiveState",
                 "--", unit], capture_output=True, text=True, timeout=3,
            )
            props = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
            states[name] = props.get("ActiveState", "unknown") if props.get("LoadState") == "loaded" else "unavailable"
        return 200, {"states": states}
    name = body.get("service")
    if action != "restart" or name not in ("api", "proxy", "extractor"):
        raise ValueError("Invalid service action")
    if name == "api" and int(ui_settings.read_config().get("api", "port")) != int(setting("MEMGINE_PORT")):
        return 409, {"error": "API port changed. Restart from the terminal and open the new address."}
    command = ["systemctl", "--user", "--no-block", "restart", "--", SERVICE_UNITS[name]]
    if name == "api":
        command = ["systemd-run", "--user", "--on-active=2s", "--", *command]
    result = subprocess.run(
        command,
        capture_output=True, timeout=3,
    )
    if result.returncode:
        return 503, {"error": "Could not queue service restart"}
    return 202, {"queued": True}


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        LOG.debug("http status=%s", code)

    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        asset = {
            "/": ("index.html", "text/html"),
            "/ui/style.css": ("style.css", "text/css"),
            "/ui/locale.js": ("locale.js", "text/javascript"),
            "/ui/app.js": ("app.js", "text/javascript"),
            "/ui/memgine.png": ("memgine.png", "image/png"),
        }.get(self.path)
        if asset is None:
            self.respond(404, {"error": "Endpoint not found"})
            return
        filename, media_type = asset
        data = (Path(__file__).resolve().parent / "ui" / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", media_type if media_type == "image/png" else media_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        supplied = self.headers.get("Authorization", "").encode()
        client = self.server.clients.get(hashlib.sha256(supplied).digest())
        if client is None:
            self.respond(401, {"error": "Unauthorized"})
            return
        if self.path == "/v1/admin/logs" and (len(self.server.clients) != 1 or client != setting("MEMGINE_CLIENT")):
            self.respond(403, {"error": "Instance operator access required"})
            return
        if self.path.startswith("/v1/admin/settings"):
            secret = os.environ.get("MEMGINE_SETTINGS_KEY", "") or ui_settings.read_config().get(
                "ui", "settings_key", fallback=""
            )
            supplied_operator = self.headers.get("X-Memgine-Settings-Key", "")
            if (len(self.server.clients) != 1 or client != setting("MEMGINE_CLIENT")
                    or not secret or not hmac.compare_digest(secret.encode(), supplied_operator.encode("latin-1"))):
                self.respond(403, {"error": "Settings operator key required"})
                return
        operation = {
            "/v1/admin/logs": read_logs,
            "/v1/admin/settings": lambda db, client, body: (200, {"sections": ui_settings.fields()}),
            "/v1/admin/settings/save": save_ui_settings,
            "/v1/admin/settings/services": service_control,
            "/v1/admin/settings/browse": lambda db, client, body: (
                200, ui_settings.browse(body.get("path", ""), body.get("kind"))
            ),
            "/v1/memory/search": search,
            "/v1/memory/list": list_memories,
            "/v1/memory/edit": edit_memory,
            "/v1/memory/delete": delete_memory,
            "/v1/memory/ingest": ingest,
            "/v1/memory/review": review,
            "/v1/memory/reviews": list_reviews,
            "/v1/memory/review-scopes": review_scopes,
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
        except (sqlite3.Error, OSError, subprocess.SubprocessError) as error:
            LOG.error("storage_unavailable error=%s", type(error).__name__)
            self.respond(503, {"error": "Storage unavailable"})
            return
        self.respond(status, payload)


def create_server(database, keys, port=8079):
    if not keys or any(not isinstance(key, str) or not key.strip() for key in keys.values()):
        raise ValueError("Configure nonempty client keys")
    if len(set(keys.values())) != len(keys):
        raise ValueError("Client keys must be distinct")
    initialize(database)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.database = database
    server.clients = {
        hashlib.sha256(f"Bearer {key}".encode()).digest(): client
        for client, key in keys.items()
    }
    return server


if __name__ == "__main__":
    logging.basicConfig(
        level=setting("MEMGINE_LOG_LEVEL").strip().upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    database = setting("MEMGINE_DB")
    if sys.argv[1:] == ["index-splade"]:
        initialize(database)
        with closing(sqlite3.connect(database)) as db:
            print(f"Indexed SPLADE memories: {splade.index(db)}")
        sys.exit(0)
    if sys.argv[1:] == ["work"]:
        print(f"Processed jobs: {work(database)}")
        sys.exit(0)
    with create_server(database,
                       {setting("MEMGINE_CLIENT"): setting("MEMGINE_API_KEY")},
                       int(setting("MEMGINE_PORT"))) as server:
        server.serve_forever()
