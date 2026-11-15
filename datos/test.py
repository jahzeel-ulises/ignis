"""Ejemplo para el FUTURO servicio de clustering (sin ejecutarlo aquí).

Requiere requests (pip install requests) en el proyecto del clustering.
La API de datos debe ser accesible en DATA_API_URL.
"""
import os
import json

import requests

DATA_API_URL = os.getenv("DATA_API_URL", "http://localhost:8011")


def iter_clean_detections(*, start: str, end: str, bbox: str, sensor: str | None = None):
    params = {"start": start, "end": end, "bbox": bbox}
    if sensor:
        params["sensor"] = sensor
    with requests.get(
        f"{DATA_API_URL}/v1/detections/export",
        params=params,
        stream=True,
        timeout=(10, 300),
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines(decode_unicode=True):
            if line:
                yield json.loads(line)


if __name__ == "__main__":
    for detection in iter_clean_detections(
        start="2020-01-01T00:00:00Z",
        end="2021-02-01T00:00:00Z",
        bbox="-100,18,-98,20",
    ):
        # Reemplazar por escritura de lotes para ST-DBSCAN.
        print(detection["id"], detection["sensor"], detection["latitude"], detection["longitude"])