import json
"""Local operator configuration and server-side path browsing."""
import configparser
import fcntl
import math
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from memgine_config import OPTIONS, ROOT, setting
from prompts import PROMPT_DEFAULTS

SECRETS = {"key", "upstream_key", "webui_jwt_secret"}
CHOICES = {
    "engine": ("lexical", "splade"),
    "level": ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"),
    "review_required": ("true", "false"),
}
PATHS = {
    "database": "database", "llama_server": "executable", "gguf": "gguf",
    "splade_binary": "executable", "splade_model": "gguf",
}
NUMBERS = {
    "port": (1, 65535, int), "threads": (1, 1024, int),
    "context_size": (1, 10000000, int), "max_tokens": (1, 10000000, int),
    "temperature": (0, 10, float),
}
NAMES = {"api": "Memória-API", "extractor": "Kivonatoló", "proxy": "Chatproxy",
         "search": "Keresés", "logging": "Naplózás"}


def local_config():
    return Path(os.environ.get("MEMGINE_CONFIG", ROOT / "memgine.ini")).expanduser().resolve()


def read_config():
    config = configparser.ConfigParser(interpolation=None)
    config.read(ROOT / "memgine.example.ini", encoding="utf-8")
    config.read(local_config(), encoding="utf-8")
    return config


def fields():
    config = read_config()
    sections = {section: [] for section in NAMES}
    for env, (section, name) in OPTIONS.items():
        value = config[section][name]
        secret = name in SECRETS
        sections[section].append({
            "name": name, "value": "" if secret else value,
            "secret": secret, "configured": bool(setting(env)) if secret else False,
            "overridden": env in os.environ, "choices": CHOICES.get(name),
            "path_type": PATHS.get(name),
        })
    return [{"name": section, "title": NAMES[section], "fields": values}
            for section, values in sections.items()]


def validate(section, name, value):
    if not isinstance(value, str) or len(value) > 4096 or any(c in value for c in "\r\n\0"):
        raise ValueError(f"Invalid setting: {section}.{name}")
    value = value.strip()
    if name == "timezone":
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("Invalid IANA time zone") from error
    if name in CHOICES and value not in CHOICES[name]:
        raise ValueError(f"Invalid choice: {section}.{name}")
    number = NUMBERS.get(name)
    if name.endswith("timeout"):
        number = (0.001, 3600, float)
    if number:
        low, high, parse = number
        converted = parse(value)
        if not math.isfinite(converted) or not low <= converted <= high:
            raise ValueError(f"Value out of range: {section}.{name}")
    if name.endswith("url"):
        url = urlsplit(value)
        if (url.scheme not in ("http", "https") or not url.hostname
                or url.username is not None or url.query or url.fragment):
            raise ValueError(f"Invalid URL: {section}.{name}")
        _ = url.port
    if name in ("client", "memory_user", "database", "model") and not value:
        raise ValueError(f"Missing value: {section}.{name}")
    if PATHS.get(name) == "gguf" and value and Path(value).suffix.lower() != ".gguf":
        raise ValueError(f"Expected a GGUF path: {section}.{name}")
    return value


def save(changes):
    if not isinstance(changes, dict):
        raise ValueError("Invalid settings")
    path = local_config()
    with path.with_name(path.name + ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = configparser.ConfigParser(interpolation=None)
        current.read(path, encoding="utf-8")
        allowed = {(section, name): env for env, (section, name) in OPTIONS.items()}
        for section, values in changes.items():
            if not isinstance(values, dict):
                raise ValueError("Invalid settings section")
            for name, raw in values.items():
                if section == "prompts" and name in PROMPT_DEFAULTS:
                    if not isinstance(raw, str) or len(raw) > 16000 or not raw.strip():
                        raise ValueError(f"Invalid prompt: {name}")
                    if not current.has_section(section):
                        current.add_section(section)
                    if raw == PROMPT_DEFAULTS[name]:
                        current.remove_option(section, name)
                    else:
                        current.set(section, name, json.dumps(raw, ensure_ascii=False))
                    continue
                env = allowed.get((section, name))
                if not env or env in os.environ:
                    raise ValueError(f"Setting cannot be changed: {section}.{name}")
                value = validate(section, name, raw)
                if name in SECRETS and not value:
                    continue
                if not current.has_section(section):
                    current.add_section(section)
                current.set(section, name, value)
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".memgine-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                current.write(output)
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)


def browse(path, kind):
    if kind not in {*PATHS.values(), "directory"} or not isinstance(path, str):
        raise ValueError("Invalid path filter")
    roots = [root.resolve() for root in (Path.home(), Path("/mnt"), Path("/opt"), Path("/usr/bin"))
             if root.is_dir()]

    def allowed(target):
        return any(target.is_relative_to(root) for root in roots)

    if not path:
        return {"path": "", "parent": None, "entries": [
            {"name": str(root), "path": str(root), "directory": True} for root in roots
        ]}
    directory = Path(path).expanduser().resolve()
    if not allowed(directory) or not directory.is_dir():
        raise ValueError("Directory is unavailable")
    entries = []
    for item in directory.iterdir():
        target = item.resolve()
        if item.name.startswith(".") or not allowed(target):
            continue
        folder = target.is_dir()
        if not folder:
            if not target.is_file() or kind == "directory":
                continue
            if kind == "gguf" and target.suffix.lower() != ".gguf":
                continue
            if kind == "database" and target.suffix.lower() not in (".sqlite", ".sqlite3", ".db"):
                continue
            if kind == "executable" and not os.access(target, os.X_OK):
                continue
        entries.append({"name": item.name, "path": str(target), "directory": folder})
    entries.sort(key=lambda item: (not item["directory"], item["name"].casefold()))
    return {"path": str(directory), "parent": str(directory.parent) if allowed(directory.parent) else "", "entries": entries}
