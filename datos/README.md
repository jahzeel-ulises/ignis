# Fireprint Data API (MVP)

**Alcance actual:** ingesta de CSV FIRMS MODIS/VIIRS, normalización, PostgreSQL y API de lectura. **No ejecuta clustering ni fusión de píxeles**. No modifica otros Docker Compose ni bases de datos existentes.

## Estructura

```
fireprint-data-api/
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── .env.example
├── postgres/init/001_schema.sql
├── src/app/
│   ├── main.py         # HTTP FastAPI
│   ├── cleaning.py     # validación/normalización de FIRMS
│   ├── ingestion.py    # importación CSV por lotes e idempotencia
│   ├── db.py           # consultas, filtros y exportación NDJSON
│   └── settings.py
├── data/
│   ├── modis/          # coloca aquí CSV MODIS
│   ├── virs/           # coloca aquí CSV VIIRS (también se acepta viirs/)
│   └── viirs/
├── tests/
└── examples_clustering_client.py
```

**No se adjuntan datos FIRMS reales:** copia tus CSV a las subcarpetas correspondientes antes de iniciar.

## Inicio rápido

```bash
cp .env.example .env
# Edita POSTGRES_PASSWORD antes del primer arranque.
docker compose up -d --build
```

- Documentación Swagger: **http://localhost:8011/docs**
- Salud del servicio: **http://localhost:8011/health**
- Estado de la ingesta automática: **http://localhost:8011/v1/ingestions/status**
- Estado del contenedor: `docker compose logs -f data-api`

Por defecto `AUTO_INGEST=true`: al iniciar la API se ejecuta **un escaneo en un hilo**, mientras la API puede responder consultas. Es normal que el número de filas crezca mientras la ingesta sigue corriendo. Espera `"running": false` antes de usar el histórico completo.

Reescanear archivos manualmente:

```bash
curl -X POST http://localhost:8011/v1/ingestions/scan
curl http://localhost:8011/v1/ingestions/status
curl http://localhost:8011/v1/detections/summary
```

El escáner es **idempotente**: los archivos sin cambios se omiten mediante SHA256; las filas repetidas (aun entre archivos) se omiten mediante una huella de la observación. Los archivos que cambian se vuelven a leer, **pero no se eliminan las detecciones ya importadas que desaparecieron del archivo** (modo append-only). Cada CSV es una transacción: si su importación falla, se revierte ese CSV; otros archivos continúan.

### APIs de ingesta

| Método | Endpoint | Resultado |
|---|---|---|
| `GET` | `/health` | Estado de la base |
| `POST` | `/v1/ingestions/scan` | HTTP 202, arranca escaneo de `data/` |
| `GET` | `/v1/ingestions/status` | `running`, tiempos, errores y resultados por CSV |
| `GET` | `/v1/ingestions/files` | Archivos importados, totales y ejemplos de filas inválidas |

**No hay subida por HTTP:** para este MVP los CSV se leen desde el volumen `./data:/data:ro`, que es exactamente la carpeta local que ya usas.

### APIs para el clustering (consulta)

| Método | Endpoint | Respuesta |
|---|---|---|
| `GET` | `/v1/detections/summary` | Conteo, fechas y área total por sensor |
| `GET` | `/v1/detections` | JSON paginado: `items`, `count`, `next_cursor` |
| `GET` | `/v1/detections/{id}` | Un registro con los campos originales `raw_record` |
| `GET` | `/v1/detections/export` | NDJSON en streaming, una fila JSON por línea |

Filtros en `/v1/detections` y `/v1/detections/export`:

| Parámetro | Ejemplo | Notas |
|---|---|---|
| `start` | `2026-01-01T00:00:00Z` | Inclusivo, timestamp UTC |
| `end` | `2026-02-01T00:00:00Z` | Exclusivo, timestamp UTC |
| `sensor` | `MODIS` o `VIIRS` | Opcional |
| `bbox` | `-99.4,18.5,-98.8,19.1` | `min_lon,min_lat,max_lon,max_lat` (no cruza antimeridiano) |
| `type_code` | `0` | Opcional; FIRMS suele identificar actividad de vegetación con 0 cuando el campo existe |
| `cursor` | `15200` | Sólo `/v1/detections`, `id` del cursor anterior |
| `limit` | `1000` | Sólo `/v1/detections`, de 1 a 5000 |

Ejemplos:

```bash
# Últimos registros disponibles de la región (primera página por id)
curl -G http://localhost:8011/v1/detections \
  --data-urlencode 'bbox=-99.4,18.5,-98.8,19.1' \
  --data-urlencode 'start=2026-01-01T00:00:00Z' \
  --data-urlencode 'end=2027-01-01T00:00:00Z' \
  --data-urlencode 'limit=1000'

# Exportación para el microservicio de clustering (flujo NDJSON)
curl -G http://localhost:8011/v1/detections/export \
  --data-urlencode 'bbox=-99.4,18.5,-98.8,19.1' \
  --data-urlencode 'start=2026-01-01T00:00:00Z' \
  --data-urlencode 'end=2027-01-01T00:00:00Z' \
  -o detections.ndjson
```

Formato de fila normalizada:

```json
{
  "id": 845,
  "sensor": "VIIRS",
  "satellite": "N20",
  "instrument": "VIIRS",
  "detected_at": "2026-11-14T06:31:00Z",
  "latitude": 18.85,
  "longitude": -99.22,
  "brightness_k": 340.4,
  "background_brightness_k": 302.1,
  "frp_mw": 23.8,
  "scan_km": 0.39,
  "track_km": 0.37,
  "confidence_raw": "n",
  "confidence_pct": null,
  "daynight": "D",
  "type_code": "0",
  "version": "2.0NRT"
}
```

**Importante:** `confidence_pct` sólo se rellena para MODIS si viene un valor numérico válido. VIIRS conserva su confianza categórica en `confidence_raw`. `brightness_k` guarda MODIS `brightness` o VIIRS `bright_ti4`, **pero no deben compararse como si midieran el mismo canal**. `background_brightness_k` almacena MODIS `bright_t31` o VIIRS `bright_ti5`, también sin asumir equivalencia. `frp_mw` está en megavatios, `scan_km` y `track_km` en kilómetros, y la fecha/hora de `acq_date`/`acq_time` se interpreta en UTC.

No convertimos píxeles en círculos, no unimos detecciones y no inferimos el perímetro quemado. La API de clustering hará después la fusión geométrica/temporal.

### Siguiente microservicio: Fireprint Clustering API (contrato previsto)

Se construirá **aparte**; no se incluye su contenedor ahora.

| Método | Endpoint previsto | Acción |
|---|---|---|
| `POST` | `/v1/reconstructions` | Solicitar reconstrucción a partir de `start`, `end`, `bbox` y parámetros de agrupamiento |
| `GET` | `/v1/reconstructions/{job_id}` | Consultar estado y resultados del proceso |
| `GET` | `/v1/events` | Obtener eventos por región y periodo (GeoJSON) |
| `GET` | `/v1/events/{event_id}` | Características de un evento |
| `GET` | `/v1/events/{event_id}/timeline` | Frames para la animación de Streamlit |

Ejemplo de `POST /v1/reconstructions` **futuro**:

```json
{
  "start": "2026-01-01T00:00:00Z",
  "end": "2026-02-01T00:00:00Z",
  "bbox": [-99.4, 18.5, -98.8, 19.1],
  "parameters": {
    "spatial_eps_m": 1000,
    "temporal_eps_hours": 24,
    "min_samples": 3,
    "tracking_distance_m": 1500,
    "tracking_max_gap_hours": 48
  }
}
```

Los valores son **ilustrativos**, no umbrales científicos validados.

## Base de datos

Se crea una base `fireprint` con esquema `fireprint` y dos tablas:

- `fireprint.detections`: una fila por observación normalizada; guarda también el JSON original en `raw_record`.
- `fireprint.ingestion_files`: manifiesto de archivos y estadísticas de cada importación.

PostgreSQL **no tiene puerto publicado en el host**. Su almacenamiento persiste en el volumen `fireprint_pg_data`. Se usa una red privada propia, sin tocar las redes de otros proyectos.

**Precaución:** el SQL de `postgres/init` sólo se ejecuta al crear por primera vez el volumen. `docker compose down -v` elimina los datos permanentemente; no lo uses salvo que quieras reiniciar desde cero.

**Seguridad:** el puerto HTTP de la API está limitado a `127.0.0.1` para desarrollo. No se incluye autenticación; evita publicarla en Internet sin un gateway y controles de acceso. Si el microservicio de clustering se despliega en otro contenedor, habrá que decidir cómo comunicar ambos servicios mediante una red compartida o un endpoint interno. No se requiere hacerlo ahora.

## Pruebas unitarias

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt pytest
PYTHONPATH=src pytest -q
```

Las pruebas incluidas cubren normalización, UTC, detecciones inválidas, deduplicación determinista (fingerprint) y validación de bbox. Para comprobar la ingesta completa contra PostgreSQL se necesita levantar Docker en el equipo donde se ejecutará.
