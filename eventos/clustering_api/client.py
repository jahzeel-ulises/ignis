"""Cliente de Fireprint Data API: no accede a PostgreSQL directamente."""
import json
import os

import requests

DATA_API_URL = os.environ.get('DATA_API_URL', 'http://localhost:8011').rstrip('/')


class TooManyDetections(Exception):
    pass


def fetch_detections(*, start, end, bbox, sensor, type_code, max_detections):
    params = {
        'start': start.isoformat(), 'end': end.isoformat(),
        'bbox': ','.join(str(v) for v in bbox),
    }
    if sensor != 'ALL':
        params['sensor'] = sensor
    if type_code != 'all':
        params['type_code'] = type_code
    rows = []
    with requests.get(f'{DATA_API_URL}/v1/detections/export',
                      params=params, stream=True, timeout=(10, 300)) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                rows.append(json.loads(line))
                if len(rows) > max_detections:
                    raise TooManyDetections(
                        f'Se superó el límite de {max_detections:,} detecciones. '
                        'Reduce el área o el periodo de análisis.'
                    )
    return rows
