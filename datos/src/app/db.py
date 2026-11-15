"""Consultas de lectura para la API de clustering y visualización."""

from datetime import datetime, timezone
import json

import psycopg
from psycopg.rows import dict_row

from .settings import pg_connect_kwargs

PUBLIC_COLUMNS = (
    "id", "sensor", "satellite", "instrument", "detected_at", "latitude", "longitude",
    "brightness_k", "background_brightness_k", "frp_mw", "scan_km", "track_km",
    "confidence_raw", "confidence_pct", "daynight", "type_code", "version"
)


def open_db():
    return psycopg.connect(**pg_connect_kwargs(), row_factory=dict_row)


def utc_iso(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def public_record(record: dict) -> dict:
    return {k: utc_iso(v) for k, v in record.items()}


def bbox_values(value: str | None):
    if value is None:
        return None
    try:
        parts = [float(x.strip()) for x in value.split(",")]
    except ValueError as exc:
        raise ValueError("bbox requiere cuatro coordenadas numéricas") from exc
    if len(parts) != 4:
        raise ValueError("bbox=min_lon,min_lat,max_lon,max_lat")
    west, south, east, north = parts
    if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
        raise ValueError("bbox fuera de rango o invertido")
    return west, south, east, north


def make_filter_sql(start=None, end=None, sensor=None, bbox=None, after_id=None, type_code=None):
    clauses = []
    params = []
    if start is not None:
        clauses.append("detected_at >= %s")
        params.append(start)
    if end is not None:
        clauses.append("detected_at < %s")
        params.append(end)
    if sensor is not None:
        clauses.append("sensor = %s")
        params.append(sensor)
    if bbox is not None:
        west, south, east, north = bbox_values(bbox)
        clauses.append("longitude BETWEEN %s AND %s AND latitude BETWEEN %s AND %s")
        params.extend([west, east, south, north])
    if after_id is not None:
        clauses.append("id > %s")
        params.append(after_id)
    if type_code is not None:
        clauses.append("type_code = %s")
        params.append(type_code)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    return where, params


def get_detections(*, start, end, sensor, bbox, cursor, type_code, limit):
    where, params = make_filter_sql(start, end, sensor, bbox, cursor, type_code)
    query = (
        "SELECT " + ", ".join(PUBLIC_COLUMNS) + " FROM fireprint.detections"
        + where + " ORDER BY id LIMIT %s"
    )
    with open_db() as conn, conn.cursor() as cur:
        cur.execute(query, [*params, limit + 1])
        records = cur.fetchall()
    more = len(records) > limit
    items = [public_record(r) for r in records[:limit]]
    return {"items": items, "count": len(items), "next_cursor": items[-1]["id"] if items and more else None}


def stream_detections(*, start, end, sensor, bbox, type_code):
    """Una línea JSON por detección; cursor del servidor, sin cargar todo en RAM."""
    where, params = make_filter_sql(start, end, sensor, bbox, None, type_code)
    query = (
        "SELECT " + ", ".join(PUBLIC_COLUMNS) + " FROM fireprint.detections"
        + where + " ORDER BY id"
    )
    with open_db() as conn:
        with conn.cursor(name="fireprint_export") as cur:
            cur.execute(query, params)
            while True:
                batch = cur.fetchmany(1000)
                if not batch:
                    break
                for record in batch:
                    yield json.dumps(public_record(record), ensure_ascii=False, allow_nan=False) + "\n"


def get_detection(detection_id: int):
    with open_db() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM fireprint.detections WHERE id = %s", (detection_id,))
        record = cur.fetchone()
    return public_record(record) if record else None


def get_summary():
    with open_db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS count,
                   MIN(detected_at) AS first_detection,
                   MAX(detected_at) AS last_detection,
                   MIN(latitude) AS min_lat, MAX(latitude) AS max_lat,
                   MIN(longitude) AS min_lon, MAX(longitude) AS max_lon
            FROM fireprint.detections
            """
        )
        totals = cur.fetchone()
        cur.execute("SELECT sensor, COUNT(*) AS count FROM fireprint.detections GROUP BY sensor ORDER BY sensor")
        by_sensor = cur.fetchall()
    return {"total": public_record(totals), "by_sensor": by_sensor}


def get_ingestion_files():
    with open_db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_file, sensor, rows_read, rows_inserted, rows_invalid,
                   invalid_samples, status, processed_at
            FROM fireprint.ingestion_files ORDER BY source_file
            """
        )
        return [public_record(r) for r in cur.fetchall()]
