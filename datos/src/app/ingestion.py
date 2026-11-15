"""Importa carpetas MODIS/VIIRS en lotes. Cada CSV es una transacción."""

import csv
from datetime import datetime, timezone
import gzip
import hashlib
import logging
from pathlib import Path
import threading

import psycopg
from psycopg.types.json import Jsonb

from .cleaning import InvalidDetection, clean_row, sensor_from_path
from .settings import DATA_DIR, pg_connect_kwargs

logger = logging.getLogger("fireprint.ingestion")

INSERT_COLUMNS = (
    "fingerprint", "sensor", "satellite", "instrument", "source_file", "source_row",
    "detected_at", "latitude", "longitude", "brightness_k", "background_brightness_k",
    "frp_mw", "scan_km", "track_km", "confidence_raw", "confidence_pct", "version",
    "daynight", "type_code", "raw_record"
)
INSERT_SQL = (
    "INSERT INTO fireprint.detections (" + ", ".join(INSERT_COLUMNS) + ") VALUES ("
    + ", ".join(["%s"] * len(INSERT_COLUMNS)) + ") ON CONFLICT (fingerprint) DO NOTHING"
)


def hash_file(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def is_csv(path: Path) -> bool:
    """Acepta .csv y .csv.gz (los comprimidos pesan ~4 veces menos en el repositorio)."""
    name = path.name.lower()
    return path.is_file() and (name.endswith(".csv") or name.endswith(".csv.gz"))


def open_csv(path: Path):
    if path.name.lower().endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def to_params(record: dict) -> tuple:
    values = [record[column] for column in INSERT_COLUMNS]
    values[-1] = Jsonb(values[-1])
    return tuple(values)


def ingest_file(path: Path) -> dict:
    sensor = sensor_from_path(path)
    source_file = path.relative_to(DATA_DIR).as_posix()
    if sensor is None:
        return {"file": source_file, "status": "skipped_unknown_folder"}
    digest = hash_file(path)
    with psycopg.connect(**pg_connect_kwargs()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT file_sha256, status FROM fireprint.ingestion_files WHERE source_file = %s",
                (source_file,),
            )
            previous = cur.fetchone()
            if previous == (digest, "completed"):
                return {"file": source_file, "sensor": sensor, "status": "unchanged"}

            read = inserted = invalid = 0
            invalid_samples = []
            batch = []
            with open_csv(path) as stream:
                reader = csv.DictReader(stream)
                headers = {x.strip().lower() for x in (reader.fieldnames or []) if x}
                required = {"latitude", "longitude", "acq_date", "acq_time"}
                if not required <= headers:
                    raise ValueError(f"Faltan columnas obligatorias: {sorted(required - headers)}")

                for source_row, raw_row in enumerate(reader, start=2):
                    read += 1
                    try:
                        record = clean_row(raw_row, sensor, source_file, source_row)
                    except (InvalidDetection, ValueError) as exc:
                        invalid += 1
                        if len(invalid_samples) < 5:
                            invalid_samples.append({"row": source_row, "reason": str(exc)})
                        continue

                    batch.append(to_params(record))
                    if len(batch) >= 2000:
                        cur.executemany(INSERT_SQL, batch)
                        inserted += max(cur.rowcount, 0)
                        batch.clear()
                if batch:
                    cur.executemany(INSERT_SQL, batch)
                    inserted += max(cur.rowcount, 0)

            cur.execute(
                """
                INSERT INTO fireprint.ingestion_files
                    (source_file, file_sha256, sensor, rows_read, rows_inserted,
                     rows_invalid, invalid_samples, status, processed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'completed', NOW())
                ON CONFLICT (source_file) DO UPDATE SET
                    file_sha256 = EXCLUDED.file_sha256,
                    sensor = EXCLUDED.sensor,
                    rows_read = EXCLUDED.rows_read,
                    rows_inserted = EXCLUDED.rows_inserted,
                    rows_invalid = EXCLUDED.rows_invalid,
                    invalid_samples = EXCLUDED.invalid_samples,
                    status = EXCLUDED.status,
                    processed_at = NOW()
                """,
                (source_file, digest, sensor, read, inserted, invalid, Jsonb(invalid_samples)),
            )
            # Commit automático al salir del contexto de conexión.
            return {
                "file": source_file, "sensor": sensor, "status": "completed",
                "read": read, "inserted": inserted, "invalid": invalid,
                "duplicates": read - invalid - inserted,
                "invalid_samples": invalid_samples,
            }


class ScanManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._state = {
            "running": False, "started_at": None, "completed_at": None,
            "results": [], "error": None,
        }

    def status(self) -> dict:
        with self._state_lock:
            return dict(self._state)

    def start_scan(self) -> bool:
        if not self._lock.acquire(blocking=False):
            return False
        with self._state_lock:
            self._state = {
                "running": True,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "results": [], "error": None,
            }
        thread = threading.Thread(target=self._scan, name="fireprint-csv-scan", daemon=True)
        thread.start()
        return True

    def _scan(self):
        try:
            if not DATA_DIR.exists():
                raise FileNotFoundError(f"No existe el directorio de datos: {DATA_DIR}")
            paths = sorted(p for p in DATA_DIR.rglob("*") if is_csv(p))
            for path in paths:
                try:
                    result = ingest_file(path)
                except Exception as exc:
                    logger.exception("Error importando %s", path)
                    result = {"file": str(path.relative_to(DATA_DIR)), "status": "error", "error": str(exc)}
                with self._state_lock:
                    self._state["results"].append(result)
        except Exception as exc:
            logger.exception("Error escaneando la carpeta de datos")
            with self._state_lock:
                self._state["error"] = str(exc)
        finally:
            with self._state_lock:
                self._state["running"] = False
                self._state["completed_at"] = datetime.now(timezone.utc).isoformat()
            self._lock.release()


scan_manager = ScanManager()
