import os
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
AUTO_INGEST = os.getenv("AUTO_INGEST", "true").strip().lower() in {"1", "true", "yes"}


def pg_connect_kwargs() -> dict:
    return {
        "host": os.getenv("PGHOST", "localhost"),
        "port": int(os.getenv("PGPORT", "5432")),
        "dbname": os.getenv("PGDATABASE", "fireprint"),
        "user": os.getenv("PGUSER", "fireprint"),
        "password": os.getenv("PGPASSWORD", "fireprint_local_change_me"),
        "connect_timeout": 10,
    }
