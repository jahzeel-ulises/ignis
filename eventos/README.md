# FIREPRINT Explorer — Clustering + Streamlit

**Requiere que Fireprint Data API ya esté iniciada y con la ingesta terminada.**

## Arquitectura

- `clustering-api`: FastAPI, clustering espacial por día (DBSCAN/Haversine), asociación entre días y cronología de eventos. **Solo consulta** a Fireprint Data API mediante HTTP; no accede directamente a PostgreSQL.
- `streamlit`: dibuja un rectángulo, elige fechas, construye un calendario de eventos y reproduce su evolución diaria.
- Resultados guardados **en memoria del proceso** de clustering, hasta tres reconstrucciones. Al reiniciar ese contenedor se pierden; los datos originales en PostgreSQL **no** se modifican.

## Opción 1: Docker (sin cambiar el Compose anterior)

1. Desde `fireprint-explorer`, copia el ejemplo: `cp .env.example .env`.
2. Obtén el nombre real de la red de la Data API:
   `docker network ls --format '{{.Name}}' | grep fireprint_private`
3. Pon ese nombre como `DATA_NETWORK=...` en `.env`.
4. Inicia los nuevos servicios: `docker compose up -d --build`.
5. Abre `http://localhost:8501`. Documentación API: `http://localhost:8012/docs`.

Docker añade **dos servicios nuevos**, sin modificar el Compose de datos. La Data API ya existe en la red externa y el clustering la consulta por `http://data-api:8000`.

## Opción 2: ejecutar localmente (sin añadir contenedores)

Requiere Python 3.11+ y la Data API accesible en `http://localhost:8011`.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-clustering.txt -r requirements-streamlit.txt
DATA_API_URL=http://localhost:8011 uvicorn clustering_api.main:app --host 127.0.0.1 --port 8012
```

En otra terminal, activa el mismo entorno y ejecuta:

```bash
CLUSTER_API_URL=http://localhost:8012 streamlit run streamlit_app/app.py
```

## Endpoints del clustering

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/health` | Verifica comunicación con Data API |
| POST | `/v1/reconstructions` | `{job_id, status, status_url}`; trabajo asíncrono |
| GET | `/v1/reconstructions/{job_id}` | Estado, cantidades, errores |
| GET | `/v1/reconstructions/{job_id}/events` | Eventos (filtros `min_detections`, `min_active_days`) |
| GET | `/v1/reconstructions/{job_id}/events/{event_id}` | Métricas del evento |
| GET | `/v1/reconstructions/{job_id}/events/{event_id}/timeline` | Frames diarios con detecciones nuevas y acumuladas |
| GET | `/v1/reconstructions/{job_id}/calendar` | Actividad histórica mensual |

Petición de reconstrucción:

```json
{
  "start": "2010-03-01T00:00:00Z",
  "end": "2010-04-01T00:00:00Z",
  "bbox": [-99.5, 18.4, -98.7, 19.2],
  "sensor": "ALL",
  "type_code": "0",
  "parameters": {
    "spatial_eps_m": 1200,
    "min_samples": 1,
    "tracking_distance_m": 1500,
    "max_gap_hours": 48
  }
}
```

`end` es exclusivo, las fechas se interpretan en UTC y bbox = `[oeste, sur, este, norte]`.

## Alcances y límites

- Se reconstruyen **candidatos de eventos térmicos**, no incendios validados.
- La actividad diaria observada depende de las pasadas MODIS/VIIRS. La falta de registros en un día no implica extinción.
- El algoritmo hace DBSCAN por día UTC y enlaza regiones de días distintos si existe un par de detecciones suficientemente cercano **en distancia y tiempo**. Uniones espurias son posibles y se deben validar.
- `min_samples=1` conserva observaciones aisladas; aumenta el umbral para reducir eventos pequeños o ruido.
- `type_code=0` filtra detecciones etiquetadas por FIRMS como vegetación. Cambia a `all` si quieres incluir todas las clases térmicas.
- No combina cantidades MODIS y VIIRS como si fueran observaciones equivalentes, aunque sí permite encontrarlas en un evento común. La fusión por huella de píxel y las puntuaciones ajustadas por sensor quedan para una versión posterior.
- Un trabajo admite un máximo de `MAX_DETECTIONS` detecciones (100 000 predeterminadas). Reduce la región o el periodo si se supera. El área debe medir menos de 15° por eje.
- La interfaz permite dibujar la **envolvente convexa de los centros observados**; NO es área quemada ni perímetro validado.
- La visualización puede **muestrear puntos** de eventos grandes; las métricas usan todas las detecciones procesadas.
- La reconstrucción se ejecuta en segundo plano y queda en memoria hasta reinicio o hasta superar los tres trabajos retenidos. No se recomienda usar el MVP como sistema operacional de emergencias.
- El mapa requiere conexión a Internet para descargar los mosaicos de OpenStreetMap.

## Pruebas

Desde la raíz: `python -m pytest -q tests/`.
