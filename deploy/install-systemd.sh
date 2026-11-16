#!/usr/bin/env bash
set -euo pipefail

with_proxy=false
with_extractor=false
for option in "$@"; do
    case "$option" in
        --with-proxy) with_proxy=true ;;
        --with-extractor) with_extractor=true ;;
        *) printf 'Usage: bash deploy/install-systemd.sh [--with-proxy] [--with-extractor]\n' >&2; exit 2 ;;
    esac
done

cd -- "$(dirname -- "$0")/.."
if [[ "$PWD" != "$HOME/memgine" ]]; then
    printf 'Install the project in %s/memgine before running this installer.\n' "$HOME" >&2
    exit 1
fi
if [[ ! -r memgine.ini ]]; then
    printf 'Create memgine.ini from memgine.example.ini first.\n' >&2
    exit 1
fi

MEMGINE_CONFIG="$PWD/memgine.ini" /usr/bin/python3 - "$with_proxy" <<'PY'
import sys
from memgine_config import setting

required = ["MEMGINE_API_KEY"]
if sys.argv[1] == "true":
    required.append("MEMGINE_PROXY_KEY")
for name in required:
    if not setting(name).strip():
        raise SystemExit(f"Missing configuration: {name}")
PY

if [[ "$with_extractor" == true ]]; then
    MEMGINE_CONFIG="$PWD/memgine.ini" /usr/bin/python3 extractor.py --check
fi

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -d "$unit_dir"
install -m 0644 deploy/memgine-{api,worker,proxy,extractor}.service deploy/memgine-worker.timer "$unit_dir/"
systemctl --user daemon-reload

units=(memgine-api.service memgine-worker.timer)
if [[ "$with_proxy" == true ]]; then
    units+=(memgine-proxy.service)
fi
if [[ "$with_extractor" == true ]]; then
    units=(memgine-extractor.service "${units[@]}")
fi
systemctl --user enable "${units[@]}"
systemctl --user restart "${units[@]}"
systemctl --user --no-pager status "${units[@]}"
