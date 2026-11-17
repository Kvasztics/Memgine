"""Forward OpenAI-compatible model and chat requests to a configured upstream."""
import base64
import hmac
import http.client
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from memgine_config import setting
from prompts import MEMORY_CONTEXT_PROMPT, MEMORY_RECALL_PROMPT
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener


class InvalidIdentity(ValueError):
    pass


def webui_user(token, secret):
    def decode(segment):
        return base64.b64decode(segment + "=" * (-len(segment) % 4),
                                altchars=b"-_", validate=True)

    try:
        if not token or len(token) > 8192:
            raise ValueError
        head, body, signature = token.split(".")
        signed = (head + "." + body).encode("ascii")
        expected = hmac.digest(secret.encode(), signed, "sha256")
        if not hmac.compare_digest(decode(signature), expected):
            raise ValueError
        header, claims = json.loads(decode(head)), json.loads(decode(body))
        if not isinstance(header, dict) or not isinstance(claims, dict):
            raise ValueError
        subject, expiry = claims.get("sub"), claims.get("exp")
        if (header.get("alg") != "HS256" or claims.get("iss") != "open-webui"
                or type(expiry) is not int or expiry <= time.time()
                or not isinstance(subject, str) or not subject.strip() or len(subject) > 248):
            raise ValueError
        return "webui:" + subject
    except (ValueError, TypeError):
        raise InvalidIdentity("Missing or invalid Open WebUI identity") from None


class Proxy(BaseHTTPRequestHandler):
    def error(self, status, message):
        body = json.dumps({"error": {"message": message}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.forward("/models")

    def do_POST(self):
        self.forward("/chat/completions")

    def forward(self, route):
        if self.path != "/v1" + route:
            self.error(404, "Endpoint not found")
            return
        authorization = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(authorization, self.server.authorization):
            self.error(401, "Invalid proxy API key")
            return

        body = None
        headers = {"Accept-Encoding": "identity"}
        if self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                length = 0
            if self.headers.get("Transfer-Encoding") or not 0 < length <= 16 * 1024 * 1024:
                self.error(400, "Expected a JSON body with a valid Content-Length")
                return
            body = self.rfile.read(length)
            try:
                body = self.with_memory(body)
            except InvalidIdentity as error:
                self.error(401, str(error))
                return
            except ValueError as error:
                self.error(400, str(error))
                return
            except RuntimeError as error:
                self.error(503, str(error))
                return
            headers["Content-Type"] = "application/json"
        if self.server.upstream_key:
            headers["Authorization"] = "Bearer " + self.server.upstream_key

        upstream = self.server.upstream
        connection_type = (
            http.client.HTTPSConnection if upstream.scheme == "https"
            else http.client.HTTPConnection
        )
        connection = connection_type(upstream.hostname, upstream.port, timeout=self.server.upstream_timeout)
        try:
            try:
                connection.request(self.command, upstream.path.rstrip("/") + route, body, headers)
                response = connection.getresponse()
            except (OSError, http.client.HTTPException):
                self.error(502, "Model server unavailable")
                return

            self.send_response(response.status)
            for name in ("Content-Type", "Content-Encoding", "Cache-Control"):
                value = response.getheader(name)
                if value:
                    self.send_header(name, value)
            self.send_header("Connection", "close")
            self.end_headers()
            while chunk := response.read1(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()


    def memory_call(self, route, payload):
        request = Request(
            self.server.memory_url + "/" + route,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.server.memory_key,
            },
        )
        with build_opener(ProxyHandler({})).open(request, timeout=self.server.memory_timeout) as response:
            return json.load(response)

    def with_memory(self, body):
        recall = self.headers.get("X-Memgine-Recall", "0") == "1"
        conversation = self.headers.get("X-Memgine-Conversation-ID")
        if recall and (not self.server.memory_key or conversation is None):
            raise ValueError("Memory recall requires configured memory and a conversation ID")
        if not self.server.memory_key or conversation is None:
            return body
        message_id = self.headers.get("X-Memgine-Message-ID")
        if any(not value or not value.strip() or len(value) > 256
               for value in ((conversation,) if recall else (conversation, message_id))):
            raise ValueError("Provide valid Memgine conversation and message IDs")
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("Expected a chat object")
        model, messages = payload.get("model"), payload.get("messages")
        if not isinstance(model, str) or not isinstance(messages, list):
            raise ValueError("Expected a model and messages")
        if not messages or not isinstance(messages[-1], dict) or messages[-1].get("role") != "user":
            return body
        content = messages[-1].get("content")
        if isinstance(content, list):
            content = "\n".join(part["text"] for part in content
                                if isinstance(part, dict) and part.get("type") == "text"
                                and isinstance(part.get("text"), str))
        if not isinstance(content, str) or not content.strip():
            return body
        user = self.server.memory_user
        if self.server.webui_jwt_secret:
            user = webui_user(self.headers.get("X-OpenWebUI-User-Jwt"), self.server.webui_jwt_secret)
        scope = {"user_id": user, "model_id": model,
                 "conversation_id": conversation}
        history = [
            {"role": entry["role"], "content": entry["content"][:2000]}
            for entry in messages[:-1]
            if isinstance(entry, dict) and entry.get("role") in ("user", "assistant")
            and isinstance(entry.get("content"), str)
        ][-2:]
        try:
            response = self.memory_call("search", dict(scope, query=content))
            texts = [memory["text"] for memory in response["memories"]]
            if texts or recall:
                instruction = (
                    MEMORY_RECALL_PROMPT + "\n" + MEMORY_CONTEXT_PROMPT
                    if recall else MEMORY_CONTEXT_PROMPT
                )
                messages.insert(0, {"role": "system", "content":
                    instruction + " "
                    + json.dumps(texts, ensure_ascii=False)})
                body = json.dumps(payload, ensure_ascii=False).encode()
        except (OSError, ValueError, KeyError, TypeError):
            self.log_error("Memgine search failed")
            if recall:
                raise RuntimeError("Memory search unavailable")
        if recall:
            return body
        try:
            self.memory_call("ingest", dict(scope, message_id=message_id, text=content, history=history))
        except (OSError, ValueError):
            self.log_error("Memgine ingest failed")
        return body


def create_proxy(upstream_url, key, upstream_key="", port=8086, memory_key="", memory_user="proxy"):
    if memory_key and not memory_user.strip():
        raise ValueError("Set a nonempty memory user ID")
    upstream = urlsplit(upstream_url)
    if (upstream.scheme not in ("http", "https") or not upstream.hostname
            or upstream.username is not None or upstream.query or upstream.fragment):
        raise ValueError("Set an HTTP(S) upstream API base URL")
    if not key.strip():
        raise ValueError("Set a nonempty proxy API key")
    server = ThreadingHTTPServer(("127.0.0.1", port), Proxy)
    server.upstream = upstream
    server.authorization = ("Bearer " + key).encode()
    server.upstream_key = upstream_key
    server.memory_key = memory_key
    server.memory_user = memory_user
    server.webui_jwt_secret = setting("MEMGINE_WEBUI_JWT_SECRET")
    server.upstream_timeout = float(setting("MEMGINE_UPSTREAM_TIMEOUT"))
    server.memory_timeout = float(setting("MEMGINE_MEMORY_TIMEOUT"))
    server.memory_url = setting("MEMGINE_MEMORY_URL").rstrip("/")
    return server


if __name__ == "__main__":
    with create_proxy(
        setting("MEMGINE_UPSTREAM_URL"),
        setting("MEMGINE_PROXY_KEY"),
        setting("MEMGINE_UPSTREAM_KEY"),
        int(setting("MEMGINE_PROXY_PORT")),
        setting("MEMGINE_API_KEY"),
        setting("MEMGINE_MEMORY_USER"),
    ) as server:
        server.serve_forever()
