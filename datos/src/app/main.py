"""Fireprint Data API: ingesta y consulta. No ejecuta clustering."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
import psycopg

from . import db
from .ingestion import scan_manager
from .settings import AUTO_INGEST, pg_connect_kwargs

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if AUTO_INGEST:
        scan_manager.start_scan()
    yield


app = FastAPI(
    title="Fireprint Data API",
    version="0.1.0",
    description="Importa FIRMS MODIS/VIIRS en PostgreSQL y expone observaciones normalizadas.",
    lifespan=lifespan,
)


def validated_dates(start: datetime | None, end: datetime | None):
    def as_utc(value):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    start, end = as_utc(start), as_utc(end)
    if start is not None and end is not None and start >= end:
        raise HTTPException(status_code=422, detail="start debe ser anterior a end (end exclusivo)")
    return start, end


def validated_bbox(bbox: str | None):
    try:
        db.bbox_values(bbox)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return bbox


@app.get("/health")
def health():
    try:
        with psycopg.connect(**pg_connect_kwargs()) as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return {"status": "ok", "database": "ok"}
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="database unavailable")


@app.post("/v1/ingestions/scan", status_code=202)
def start_ingestion_scan():
    if not scan_manager.start_scan():
        raise HTTPException(status_code=409, detail="Ya hay una ingesta en ejecución")
    return {"status": "started", "status_url": "/v1/ingestions/status"}


@app.get("/v1/ingestions/status")
def ingestion_status():
    return scan_manager.status()


@app.get("/v1/ingestions/files")
def ingestion_files():
    return {"files": db.get_ingestion_files()}


@app.get("/v1/detections/summary")
def detections_summary():
    return db.get_summary()


@app.get("/v1/detections/export")
def export_detections(
    start: datetime | None = None,
    end: datetime | None = None,
    sensor: Literal["MODIS", "VIIRS"] | None = None,
    bbox: str | None = None,
    type_code: str | None = None,
):
    start, end = validated_dates(start, end)
    bbox = validated_bbox(bbox)
    generator = db.stream_detections(start=start, end=end, sensor=sensor, bbox=bbox, type_code=type_code)
    return StreamingResponse(generator, media_type="application/x-ndjson")


@app.get("/v1/detections")
def detections(
    start: datetime | None = None,
    end: datetime | None = None,
    sensor: Literal["MODIS", "VIIRS"] | None = None,
    bbox: str | None = None,
    type_code: str | None = None,
    cursor: int | None = Query(default=None, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
):
    start, end = validated_dates(start, end)
    bbox = validated_bbox(bbox)
    return db.get_detections(
        start=start, end=end, sensor=sensor, bbox=bbox, type_code=type_code,
        cursor=cursor, limit=limit
    )


@app.get("/v1/detections/{detection_id}")
def detection(detection_id: int):
    record = db.get_detection(detection_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Detección no encontrada")
    return record
