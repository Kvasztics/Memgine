"""Launch a local llama.cpp extractor using the Memgine configuration."""
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

from memgine_config import setting


def command():
    binary = Path(setting("MEMGINE_LLAMA_SERVER")).expanduser().resolve()
    model = Path(setting("MEMGINE_EXTRACT_GGUF")).expanduser().resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError("Set extractor.llama_server to an executable llama-server")
    if not model.is_file() or not os.access(model, os.R_OK):
        raise ValueError("Set extractor.gguf to a readable model file")

    endpoint = urlsplit(setting("MEMGINE_EXTRACT_URL"))
    if (endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1"
            or not endpoint.port or endpoint.path != "/v1/chat/completions"
            or endpoint.username is not None or endpoint.query or endpoint.fragment):
        raise ValueError("Local extractor needs http://127.0.0.1:PORT/v1/chat/completions")
    threads = int(setting("MEMGINE_EXTRACT_THREADS"))
    context = int(setting("MEMGINE_EXTRACT_CONTEXT_SIZE"))
    alias = setting("MEMGINE_EXTRACT_MODEL").strip()
    if threads < 1 or context < 1 or not alias:
        raise ValueError("Set a model alias and positive thread and context sizes")
    return [
        str(binary), "-m", str(model), "--alias", alias,
        "--host", "127.0.0.1", "--port", str(endpoint.port),
        "-ngl", "0", "-t", str(threads), "-tb", str(threads),
        "-c", str(context), "-np", "1",
    ]


if __name__ == "__main__":
    try:
        args = command()
        if sys.argv[1:] == ["--check"]:
            print("Local extractor configuration: OK")
        else:
            os.execv(args[0], args)
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
