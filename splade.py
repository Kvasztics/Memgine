import json
import math
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

from memgine_config import setting


@lru_cache(maxsize=512)
def encode(version, binary, model, text, timeout):
    directory = str(Path(binary).parent)
    result = subprocess.run(
        [binary, "-m", model, "--sparse", "--", text],
        cwd=directory,
        env={**os.environ, "LD_LIBRARY_PATH": directory},
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=timeout,
        check=True,
    )
    vector = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0].isascii() and fields[0].isdigit():
            try:
                weight = float(fields[1])
            except ValueError:
                continue
            if math.isfinite(weight) and weight > 0:
                vector[int(fields[0])] = weight
    return vector


def encoder():
    binary = Path(setting("MEMGINE_SPLADE_BINARY")).resolve()
    model = Path(setting("MEMGINE_SPLADE_MODEL")).resolve()
    timeout = float(setting("MEMGINE_SPLADE_TIMEOUT"))
    version = json.dumps([(str(path), path.stat().st_mtime_ns) for path in (binary, model)])
    return version, str(binary), str(model), timeout


def vector(config, text):
    return encode(*config[:3], text.strip()[:4000], config[3])


def index(db):
    config = encoder()
    rows = db.execute(
        """SELECT m.id, m.text FROM memories m
           LEFT JOIN splade_vectors v ON v.memory_id=m.id AND v.version=?
           WHERE m.active=1 AND m.kind IN ('context','project') AND v.memory_id IS NULL
           ORDER BY m.rowid LIMIT 8""", (config[0],),
    ).fetchall()
    indexed = 0
    for memory_id, text in rows:
        try:
            weights = vector(config, text)
        except (OSError, subprocess.SubprocessError) as error:
            print(f"Memgine SPLADE indexing failed: {type(error).__name__}", file=sys.stderr)
            continue
        with db:
            indexed += db.execute(
                """INSERT INTO splade_vectors (memory_id, version, weights)
                   SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id=? AND active=1)
                   ON CONFLICT(memory_id) DO UPDATE SET version=excluded.version, weights=excluded.weights""",
                (memory_id, config[0], json.dumps(weights), memory_id),
            ).rowcount
    return indexed


def scores(query, rows, config):
    if not any(weights for _, weights in rows):
        return {}
    query_vector = vector(config, query)
    return {
        memory_id: sum(query_vector.get(int(term), 0) * weight
                       for term, weight in json.loads(weights).items())
        for memory_id, weights in rows if weights
    }
