import configparser
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OPTIONS = {
    "MEMGINE_TIMEZONE": ("api", "timezone"),
    "MEMGINE_LLAMA_SERVER": ("extractor", "llama_server"),
    "MEMGINE_EXTRACT_GGUF": ("extractor", "gguf"),
    "MEMGINE_EXTRACT_THREADS": ("extractor", "threads"),
    "MEMGINE_EXTRACT_CONTEXT_SIZE": ("extractor", "context_size"),
    "MEMGINE_WEBUI_JWT_SECRET": ("proxy", "webui_jwt_secret"),
    "MEMGINE_LOG_LEVEL": ("logging", "level"),
    "MEMGINE_REVIEW_REQUIRED": ("api", "review_required"),
    "MEMGINE_SEARCH_ENGINE": ("search", "engine"),
    "MEMGINE_SPLADE_BINARY": ("search", "splade_binary"),
    "MEMGINE_SPLADE_MODEL": ("search", "splade_model"),
    "MEMGINE_SPLADE_TIMEOUT": ("search", "splade_timeout"),
    "MEMGINE_PORT": ("api", "port"),
    "MEMGINE_DB": ("api", "database"),
    "MEMGINE_CLIENT": ("api", "client"),
    "MEMGINE_API_KEY": ("api", "key"),
    "MEMGINE_EXTRACT_URL": ("extractor", "url"),
    "MEMGINE_EXTRACT_MODEL": ("extractor", "model"),
    "MEMGINE_EXTRACT_TIMEOUT": ("extractor", "timeout"),
    "MEMGINE_EXTRACT_TEMPERATURE": ("extractor", "temperature"),
    "MEMGINE_EXTRACT_MAX_TOKENS": ("extractor", "max_tokens"),
    "MEMGINE_PROXY_PORT": ("proxy", "port"),
    "MEMGINE_PROXY_KEY": ("proxy", "key"),
    "MEMGINE_UPSTREAM_URL": ("proxy", "upstream_url"),
    "MEMGINE_UPSTREAM_KEY": ("proxy", "upstream_key"),
    "MEMGINE_UPSTREAM_TIMEOUT": ("proxy", "upstream_timeout"),
    "MEMGINE_MEMORY_URL": ("proxy", "memory_url"),
    "MEMGINE_MEMORY_TIMEOUT": ("proxy", "memory_timeout"),
    "MEMGINE_MEMORY_USER": ("proxy", "memory_user"),
}

config = configparser.ConfigParser(interpolation=None)
with (ROOT / "memgine.example.ini").open(encoding="utf-8") as defaults:
    config.read_file(defaults)
if "MEMGINE_CONFIG" in os.environ:
    with Path(os.environ["MEMGINE_CONFIG"]).open(encoding="utf-8") as override:
        config.read_file(override)
else:
    config.read(ROOT / "memgine.ini", encoding="utf-8")


def setting(name):
    section, option = OPTIONS[name]
    return os.environ.get(name, config[section][option])
