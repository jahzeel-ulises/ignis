"""Solo HTTP: Streamlit no conoce los algoritmos ni consulta PostgreSQL."""
import os
import requests

CLUSTER_API_URL = os.getenv('CLUSTER_API_URL', 'http://localhost:8012').rstrip('/')


def api_get(route: str, **params):
    response = requests.get(f'{CLUSTER_API_URL}{route}', params=params or None, timeout=60)
    response.raise_for_status()
    return response.json()


def reconstruct(payload: dict):
    response = requests.post(f'{CLUSTER_API_URL}/v1/reconstructions', json=payload, timeout=20)
    response.raise_for_status()
    return response.json()


def get_job(job_id):
    return api_get(f'/v1/reconstructions/{job_id}')


def get_events(job_id, min_detections=1, min_active_days=1):
    return api_get(f'/v1/reconstructions/{job_id}/events',
                   min_detections=min_detections, min_active_days=min_active_days)['events']


def get_timeline(job_id, event_id):
    return api_get(f'/v1/reconstructions/{job_id}/events/{event_id}/timeline')


def get_calendar(job_id):
    return api_get(f'/v1/reconstructions/{job_id}/calendar')['periods']
