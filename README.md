# IGNIS · alerta temprana de incendios · versión con plan de control

> **Esta es la versión experimental con el plan de control para personal especializado.**
> La versión estable, sin estos cambios, está en el repositorio `ignis-plataforma`.


Proyecto para el **NASA Space Apps Challenge 2026**. Una sola plataforma con tres partes que se ven y se sienten como un mismo producto.

## Empieza aquí (Mac, Windows o Linux)

1. Instala **Docker Desktop** (Mac/Windows) o **Docker** (Linux): https://www.docker.com/products/docker-desktop/
2. Abre **`GUIA-IGNIS.html`** con doble clic: es una guía paso a paso con casillas, que cambia según tu sistema operativo.
3. Arranca IGNIS:

| Sistema | Forma más fácil | Desde la terminal (dentro de la carpeta) |
|---|---|---|
| **macOS** | `bash scripts/ignis.sh iniciar` en Terminal (o doble clic en `IGNIS-Mac.command`) | `bash scripts/ignis.sh iniciar` |
| **Windows** | doble clic en `IGNIS-Windows.bat` | `powershell -ExecutionPolicy Bypass -File .\scripts\ignis.ps1 iniciar` |
| **Linux / servidor** | — | `bash scripts/ignis.sh iniciar` |

Se abre el centro de control; los celulares escanean el QR (misma Wi-Fi). Para un enlace público con HTTPS usa `publico` en lugar de `iniciar`.

## Qué hay dentro

| Parte | Carpeta | Qué hace | Dónde se ve |
|---|---|---|---|
| **IGNIS Alerta** | `alerta/` | Simulación en vivo: los celulares escanean el QR y reciben la alerta como onda sísmica. Centro de control con pared de asistentes y marcador para el proyector. Explorador de 24 años de fuego armonizado MODIS→VIIRS, vista 3D y tarjeta para compartir. | `/` · `/control` · `/static/3d.html` |
| **Intensidad del fuego (FRP)** | `alerta/herramientas/armonizar_frp.py` → `alerta/data/frp_celdas.parquet` | FRP de MODIS convertido a escala VIIRS (ajuste log-log 2012–2025, R² 0.979 nacional mensual): año típico, serie, correlación con los eventos armonizados y gráficas al pasar el cursor. | Explorar · Mi zona · login |
| **Incendios reconstruidos** | `alerta/static/eventos.*` | Vista animada: elige un área en el mapa, reconstruye los incendios y míralos avanzar día por día. | `/eventos` |
| **Motor de eventos** | `eventos/clustering_api` | Agrupa detecciones por día (DBSCAN/Haversine) y une días en eventos. | interno |
| **Laboratorio** | `eventos/streamlit_app` | Análisis avanzado en Streamlit: parámetros del agrupamiento, calendario y evolución de cada evento. | `/laboratorio/` |
| **Datos FIRMS** | `datos/` | Ingesta de CSV MODIS/VIIRS de NASA FIRMS a PostgreSQL y API de consulta. | interno |

```
Internet ──► proxy (Caddy, HTTPS automático)
              ├── /               ► alerta
              └── /laboratorio/   ► laboratorio
Red privada (sin puertos expuestos):
              alerta / laboratorio ─► motor ─► datos ─► postgres
```

## Arrancar en un clic (Mac o Windows)

Con **Docker Desktop** abierto:

- **Mac:** doble clic en `IGNIS-Mac.command`
- **Windows:** doble clic en `IGNIS-Windows.bat`

Eliges **1** para la red Wi-Fi de la sala o **2** para un enlace público HTTPS en el que cualquiera entra desde su celular. Todo el detalle, incluido cómo subirlo a un servidor con dominio propio, está en **[DESPLIEGUE.md](DESPLIEGUE.md)**.

## Subir a un servidor (Docker Compose)

Requisitos: un servidor Linux con Docker y Docker Compose, puertos 80 y 443 abiertos y, para HTTPS, un dominio que apunte a su IP.

```bash
cp .env.example .env
nano .env          # SITE_ADDRESS=tu-dominio.mx  y una POSTGRES_PASSWORD larga
docker compose up -d --build
docker compose logs -f datos     # la primera vez carga 3.6 millones de detecciones (unos minutos)
```

- Con un dominio en `SITE_ADDRESS`, Caddy obtiene el certificado HTTPS solo. **HTTPS hace que funcione el GPS real de los celulares**, el botón Compartir y que la pantalla no se apague.
- Sin dominio (red local), deja `SITE_ADDRESS=:80` y entra con `http://IP-del-servidor`.
- El QR del centro de control detecta solo la dirección pública. Si quieres forzarla, usa `PUBLIC_URL`.
- PostgreSQL, la API de datos y el motor **no publican puertos**: solo el proxy da la cara a internet.
- Los datos de IGNIS Alerta (`alerta/data/*.parquet`) y los CSV comprimidos (`datos/data/**/*.csv.gz`) se montan como volúmenes de solo lectura.
- Con `CONTROL_CLAVE` en `.env`, el centro de control pide contraseña. Úsala siempre en un dominio público.

Comandos útiles:

```bash
docker compose ps                        # estado y salud de cada servicio
docker compose logs -f alerta            # registros de un servicio
docker compose up -d --build alerta      # reconstruir solo una parte tras un cambio
docker compose down                      # detener (los datos de PostgreSQL se conservan)
```

> `docker compose down -v` borra la base de datos y hay que volver a cargar los CSV.

## Correr en una laptop sin Docker (demo en la sala)

IGNIS Alerta funciona solo, sin las otras partes:

```bash
cd alerta
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

Celulares: `http://IP-de-la-laptop:8000` · Control: `http://localhost:8000/control`.
Para activar los incendios reconstruidos, levanta `datos/` y `eventos/` y define `CLUSTER_API_URL`, `DATA_API_URL` y `LAB_URL` al arrancar `server.py`.

## Plan de control (personal especializado)

Cuando el centro de control lanza un incendio, `alerta/plan_control.py` propone un plan de ataque inicial con el formato del Sistema de Comando de Incidentes (SCI):

- **Brecha cortafuego con maquinaria** (tractores con arado o rastra) perpendicular al avance, a la distancia justa para terminarla antes de que llegue la cabeza del incendio.
- **Ataque directo por los flancos** desde un **punto de anclaje** en la cola.
- **Apoyo aéreo** si el fuego es rápido o hay mucha pendiente; **contrafuego** solo con viento estable.
- **Zona segura y rutas de escape** (LACES), nivel del incidente (1–3) y recursos sugeridos.
- **Asignación en vivo**: cada brigadista conectado (celular o computadora) recibe su sector, su tarea, la distancia y "Cómo llegar".

Con "Avanzar 30 min" el plan avanza; si la brecha está lista cuando llega la cabeza, el incendio queda **contenido** y deja de avanzar; si el fuego la cruza, el plan se replantea más adelante. "Simular ataque" anima el plan completo (tractor abriendo la brecha, brigadas por los flancos, helicóptero, fuego que se detiene) y "Hoja SCI-201" genera el resumen imprimible del incidente. Los ciudadanos no reciben el plan.

Valores orientativos para entrenamiento: rendimiento de 1.2 km/h de línea por tractor y 0.35 km/h por brigada, 45 min de despliegue.

## Intensidad del fuego (FRP) armonizada

El FRP (*Fire Radiative Power*, MW) mide la potencia radiada por cada detección. MODIS (1 km) y VIIRS (375 m) no son comparables directamente, así que, igual que la serie de eventos armonizados, se ajusta la relación entre ambos en los años en que vuelan juntos:

```
log(FRP_VIIRS) = a + b · log(FRP_MODIS)        (FRP total por celda de 0.1° y mes, 2012–2025)
```

Resultado actual: `FRP_VIIRS ≈ 3.31 · FRP_MODIS^0.73`, R² = 0.979 a escala nacional mensual. La serie armonizada usa VIIRS desde 2012 y MODIS convertido antes. Para regenerarla: `cd alerta && python herramientas/armonizar_frp.py`.

API: `/api/frp?w&s&e&n&desde&hasta` (serie mensual, año típico con banda p10–p90, correlación FRP↔eventos, meses de temporada), `/api/frp.csv` y `/api/celda?lat&lon&y` (12 meses de una celda).

## Sistema visual

Todo comparte el mismo lenguaje: tipografía **IBM Plex** (Sans, Condensed y Mono), un solo acento **brasa** `#e8561f`, rojo solo para peligro, mapa base **Esri gris oscuro** y modo día/noche. Las animaciones están hechas en CSS y JS puro (sin librerías) y respetan "reducir movimiento" del sistema. La vista 3D usa deck.gl 9.4.1, guardado en `alerta/static/vendor` para funcionar sin internet.

## Créditos

- IGNIS Alerta, explorador, 3D, vista animada de eventos y plataforma: equipo IGNIS.
- Ingesta FIRMS (`datos/`), motor de eventos y laboratorio (`eventos/`): módulo Fireprint del equipo, integrado y adaptado al sistema visual de IGNIS.
- Datos: NASA FIRMS (MODIS C6.1 y VIIRS 375 m). Costas: Natural Earth (dominio público). Mapas base: OpenStreetMap, Esri.
- Uso de IA declarado en `alerta/AI_USAGE.md`.
