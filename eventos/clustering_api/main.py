"""API de reconstrucciones: trabajos en segundo plano y resultados temporales en memoria."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import RLock
from typing import Literal
from uuid import uuid4
import os
import requests

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from .client import DATA_API_URL, TooManyDetections, fetch_detections
from .engine import reconstruct, event_timeline, historical_calendar

app = FastAPI(title='Fireprint Clustering API', version='0.1.0')
_executor = ThreadPoolExecutor(max_workers=1)
_lock = RLock()
_jobs: dict[str, dict] = {}
MAX_RECORDS = int(os.getenv('MAX_DETECTIONS', '100000'))
MAX_JOBS = 3


class Parameters(BaseModel):
    spatial_eps_m: float = Field(default=1200, gt=0, le=25000)
    min_samples: int = Field(default=1, ge=1, le=50)
    tracking_distance_m: float = Field(default=1500, gt=0, le=50000)
    max_gap_hours: float = Field(default=48, gt=0, le=240)


class ReconstructionRequest(BaseModel):
    start: datetime
    end: datetime
    bbox: tuple[float, float, float, float]
    sensor: Literal['ALL', 'MODIS', 'VIIRS'] = 'ALL'
    type_code: Literal['0', '1', '2', '3', 'all'] = '0'
    parameters: Parameters = Field(default_factory=Parameters)

    @model_validator(mode='after')
    def validate_request(self):
        start = self.start.replace(tzinfo=timezone.utc) if self.start.tzinfo is None else self.start.astimezone(timezone.utc)
        end = self.end.replace(tzinfo=timezone.utc) if self.end.tzinfo is None else self.end.astimezone(timezone.utc)
        if start >= end:
            raise ValueError('start debe ser anterior a end (end exclusivo)')
        west, south, east, north = self.bbox
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError('bbox inválido: usa [oeste, sur, este, norte]')
        if (east - west) > 15 or (north - south) > 15:
            raise ValueError('Para evitar distorsión, utiliza regiones de hasta 15 grados por eje.')
        self.start, self.end = start, end
        return self


def job_public(job):
    return {k: job.get(k) for k in ('job_id', 'status', 'created_at', 'completed_at',
                                   'error', 'detection_count', 'event_count', 'excluded_count')}


def _worker(job_id, payload: ReconstructionRequest):
    with _lock:
        _jobs[job_id]['status'] = 'running'
    try:
        raw = fetch_detections(
            start=payload.start, end=payload.end, bbox=payload.bbox,
            sensor=payload.sensor, type_code=payload.type_code,
            max_detections=MAX_RECORDS
        )
        events, records, excluded = reconstruct(raw, **payload.parameters.model_dump())
        result = {
            'events': events, 'records': records, 'calendar': historical_calendar(events, records),
        }
        with _lock:
            _jobs[job_id].update(result)
            _jobs[job_id].update(
                status='completed', detection_count=len(raw), event_count=len(events),
                excluded_count=excluded,
                completed_at=datetime.now(timezone.utc).isoformat()
            )
    except (TooManyDetections, requests.RequestException, ValueError, KeyError, TypeError) as exc:
        with _lock:
            _jobs[job_id].update(status='failed', error=str(exc),
                                 completed_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:
        # No registrar datos ni trazas sensibles en el cliente.
        import logging
        logging.getLogger(__name__).exception('Error de reconstrucción %s', job_id)
        with _lock:
            _jobs[job_id].update(status='failed', error=f'Error interno: {type(exc).__name__}',
                                 completed_at=datetime.now(timezone.utc).isoformat())


def _get_job(job_id: str, complete: bool = False):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, 'Reconstrucción no encontrada (o se reinició la API)')
    if complete and job['status'] != 'completed':
        raise HTTPException(409, 'Reconstrucción aún no completada')
    return job


@app.get('/health')
def health():
    try:
        response = requests.get(f'{DATA_API_URL}/health', timeout=4)
        response.raise_for_status()
        return {'status': 'ok', 'data_api': 'ok'}
    except requests.RequestException:
        raise HTTPException(503, 'No es posible acceder a la Data API')


@app.post('/v1/reconstructions', status_code=202)
def create_reconstruction(payload: ReconstructionRequest):
    with _lock:
        active = sum(j['status'] in ('queued', 'running') for j in _jobs.values())
        if active >= 2:
            raise HTTPException(429, 'Ya hay dos reconstrucciones en proceso')
        if len(_jobs) >= MAX_JOBS:
            completed = [(k, j) for k, j in _jobs.items() if j['status'] in ('completed', 'failed')]
            if not completed:
                raise HTTPException(429, 'Capacidad temporal ocupada')
            oldest = min(completed, key=lambda entry: entry[1]['created_at'])[0]
            del _jobs[oldest]
        job_id = uuid4().hex[:12]
        _jobs[job_id] = {
            'job_id': job_id, 'status': 'queued',
            'created_at': datetime.now(timezone.utc).isoformat(),
            'completed_at': None, 'error': None,
            'detection_count': None, 'event_count': None,
            'excluded_count': None,
        }
    _executor.submit(_worker, job_id, payload)
    return {'job_id': job_id, 'status': 'queued',
            'status_url': f'/v1/reconstructions/{job_id}'}


@app.get('/v1/reconstructions/{job_id}')
def get_reconstruction(job_id: str):
    return job_public(_get_job(job_id))


@app.get('/v1/reconstructions/{job_id}/events')
def get_events(job_id: str, min_detections: int = Query(1, ge=1),
               min_active_days: int = Query(1, ge=1)):
    job = _get_job(job_id, complete=True)
    return {'job_id': job_id, 'events': [e for e in job['events']
            if e['detections'] >= min_detections and e['active_days'] >= min_active_days]}


@app.get('/v1/reconstructions/{job_id}/events/{event_id}')
def get_event(job_id: str, event_id: str):
    job = _get_job(job_id, complete=True)
    return next((e for e in job['events'] if e['event_id'] == event_id), None) or _event_not_found()


def _event_not_found():
    raise HTTPException(404, 'Evento no encontrado')


@app.get('/v1/reconstructions/{job_id}/events/{event_id}/timeline')
def get_timeline(job_id: str, event_id: str,
                 max_points_per_frame: int = Query(2000, ge=50, le=5000)):
    job = _get_job(job_id, complete=True)
    timeline = event_timeline(job['records'], event_id, max_points_per_frame)
    if timeline is None:
        raise HTTPException(404, 'Evento no encontrado')
    return timeline


@app.get('/v1/reconstructions/{job_id}/calendar')
def get_calendar(job_id: str):
    job = _get_job(job_id, complete=True)
    return {'job_id': job_id, 'periods': job['calendar']}
