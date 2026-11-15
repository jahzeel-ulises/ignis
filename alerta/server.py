"""IGNIS Alerta — servidor de la simulación en vivo.

Arranque:
    pip install fastapi "uvicorn[standard]" httpx pandas pyarrow
    python server.py
Celulares:  http://<IP-de-la-laptop>:8000      (misma red Wi-Fi)
Control:    http://localhost:8000/control
"""
import asyncio, hashlib, hmac, json, math, os, re, secrets, socket, time, uuid
from pathlib import Path

import httpx
import numpy as np
import plan_control as PC
import pandas as pd
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
# Servicios del equipo (opcionales): reconstrucción de eventos (clustering) y base de detecciones.
CLUSTER = os.environ.get('CLUSTER_API_URL', '').rstrip('/')
DATOS = os.environ.get('DATA_API_URL', '').rstrip('/')
LAB_URL = os.environ.get('LAB_URL', '/laboratorio/')
# Contraseña del centro de control (recomendada en un dominio público: sin ella cualquiera podría lanzar alertas).
CONTROL_CLAVE = os.environ.get('CONTROL_CLAVE', '')
_SAL = secrets.token_hex(16)


def _token_control() -> str:
    return hmac.new(_SAL.encode(), CONTROL_CLAVE.encode(), hashlib.sha256).hexdigest()


def control_ok(cookies) -> bool:
    return not CONTROL_CLAVE or hmac.compare_digest(cookies.get('ignis_control', ''), _token_control())
CAL = ROOT / 'data' / 'calendario_celdas.parquet'
app = FastAPI(title='IGNIS Alerta')
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')

cal = pd.read_parquet(CAL) if CAL.exists() else None
if cal is not None:  # celdas de 0.25° para la capa animada del mapa
    cal['lat_q'] = (cal.lat_c // 0.25 * 0.25 + 0.125).round(3)
    cal['lon_q'] = (cal.lon_c // 0.25 * 0.25 + 0.125).round(3)
    MAPA = {k: g[['lat_q', 'lon_q', 'armonizado']].groupby(['lat_q', 'lon_q']).armonizado.sum()
            for k, g in cal[cal.armonizado > 0].groupby(['year', 'month'])}
    ULTIMO = max(MAPA)

# Intensidad del fuego (FRP) armonizada MODIS→VIIRS por celda de 0.1° y mes (herramientas/armonizar_frp.py)
FRP_P, FRP_AJ = ROOT / 'data' / 'frp_celdas.parquet', ROOT / 'data' / 'frp_ajuste.json'
frp = pd.read_parquet(FRP_P) if FRP_P.exists() else None
FRP_AJUSTE = json.loads(FRP_AJ.read_text(encoding='utf-8')) if FRP_AJ.exists() else None
FUENTE_FRP = 'NASA FIRMS · FRP armonizado a escala VIIRS (MODIS convertido antes de 2012)'


def _corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 4 or a.std() == 0 or b.std() == 0:
        return None
    return round(float(np.corrcoef(a, b)[0, 1]), 2)


def _frp_caja(w, s, e, n, desde=2002, hasta=2026):
    return frp[frp.lat_c.between(s, n) & frp.lon_c.between(w, e) & frp.year.between(desde, hasta)]

# ---------------------------------------------------------------- estado en memoria
clientes: dict[str, dict] = {}       # id -> {ws, role, name, lat, lon, alerted}
controles: set[WebSocket] = set()
estado = {'fire': None, 'mes_simulado': 4}


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80)); return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


# ---------------------------------------------------------------- historia (calendario armonizado)
@app.get('/api/historia')
def historia(lat: float, lon: float, mes: int | None = None, r: float = 0.15):
    if cal is None:
        return {'available': False, 'reason': 'Falta data/calendario_celdas.parquet'}
    mes = mes or estado['mes_simulado']
    d = cal[cal.lat_c.between(lat - r, lat + r) & cal.lon_c.between(lon - r, lon + r)]
    if d.empty:
        return {'available': False, 'reason': 'Sin registros de fuego en esta zona'}
    m = d.groupby(['year', 'month']).armonizado.sum().unstack(fill_value=0)
    m = m.reindex(index=range(2002, 2027), columns=range(1, 13), fill_value=0)
    completos = m.loc[2003:2025]
    serie_mes = completos[mes]
    media_mes = float(serie_mes.mean())
    clim = completos.mean()
    pico = int(clim.idxmax())
    anios_fuertes = int((serie_mes >= max(1.0, 2 * media_mes)).sum())
    return {
        'available': True, 'mes': mes, 'radio_grados': r,
        'media_mes': round(media_mes, 1),
        'max_mes': {'anio': int(serie_mes.idxmax()), 'valor': round(float(serie_mes.max()), 1)},
        'mes_pico': pico,
        'pct_anual_en_mes': round(100 * float(clim[mes] / clim.sum()) if clim.sum() else 0, 1),
        'anios_fuertes': anios_fuertes,
        'cada_cuantos_anios': round(23 / anios_fuertes, 1) if anios_fuertes else None,
        'matriz': {'anios': list(m.index), 'valores': m.round(1).values.tolist()},
        'fuente': 'NASA FIRMS · serie armonizada MODIS→VIIRS (eventos ≥20 MW)',
        **_frp_zona(lat, lon, r),
    }


def _frp_zona(lat, lon, r):
    """Intensidad típica (FRP armonizado, MW) de cada mes en la zona: cómo arde a lo largo del año."""
    if frp is None:
        return {}
    d = _frp_caja(lon - r, lat - r, lon + r, lat + r, 2003, 2025)
    if d.empty:
        return {}
    mm = d.groupby(['year', 'month']).frp_armonizado.sum().unstack(fill_value=0).reindex(index=range(2003, 2026), columns=range(1, 13), fill_value=0)
    clim = mm.mean()
    return {'frp_mes': [round(float(v), 1) for v in clim], 'frp_pico': int(clim.idxmax()),
            'frp_max': {'anio': int(mm.max(axis=1).idxmax()), 'mes': int(mm.max().idxmax()), 'valor': round(float(mm.values.max()), 1)}}


# ---------------------------------------------------------------- viento y terreno (Open-Meteo, sin clave)
async def contexto(lat, lon):
    out = {'viento_kmh': 12.0, 'viento_desde': 90.0, 'viento_real': False,
           'pendiente_pct': None, 'cuesta_arriba': None, 'elevacion_m': None}
    try:
        async with httpx.AsyncClient(timeout=4) as c:
            w = (await c.get('https://api.open-meteo.com/v1/forecast',
                             params={'latitude': lat, 'longitude': lon,
                                     'current': 'wind_speed_10m,wind_direction_10m'})).json()['current']
            out.update(viento_kmh=w['wind_speed_10m'], viento_desde=w['wind_direction_10m'], viento_real=True)
            dk = 0.5  # km
            dlat = dk / 110.57; dlon = dk / (111.32 * math.cos(math.radians(lat)))
            pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
            e = (await c.get('https://api.open-meteo.com/v1/elevation',
                             params={'latitude': ','.join(f'{p[0]:.5f}' for p in pts),
                                     'longitude': ','.join(f'{p[1]:.5f}' for p in pts)})).json()['elevation']
            gn = (e[1] - e[2]) / (2 * dk * 1000); ge = (e[3] - e[4]) / (2 * dk * 1000)
            out.update(elevacion_m=round(e[0]), pendiente_pct=round(100 * math.hypot(gn, ge), 1),
                       cuesta_arriba=round((math.degrees(math.atan2(ge, gn)) + 360) % 360))
    except Exception as exc:  # sin internet: se queda el respaldo
        out['nota'] = f'contexto sin conexión ({type(exc).__name__})'
    return out


def propagacion(ctx):
    """Dirección y velocidad orientativas: viento + pendiente. No es un modelo operativo."""
    hacia_viento = (ctx['viento_desde'] + 180) % 360
    vx = math.sin(math.radians(hacia_viento)) * ctx['viento_kmh'] / 10
    vy = math.cos(math.radians(hacia_viento)) * ctx['viento_kmh'] / 10
    if ctx.get('pendiente_pct'):
        k = min(ctx['pendiente_pct'], 60) / 20
        vx += math.sin(math.radians(ctx['cuesta_arriba'])) * k
        vy += math.cos(math.radians(ctx['cuesta_arriba'])) * k
    rumbo = (math.degrees(math.atan2(vx, vy)) + 360) % 360
    vel = round(0.3 + 0.08 * ctx['viento_kmh'] + 0.03 * (ctx.get('pendiente_pct') or 0), 2)  # km/h
    return {'rumbo': round(rumbo), 'vel_kmh': vel}


# ---------------------------------------------------------------- difusión
async def enviar(ws, msg):
    try:
        await ws.send_text(json.dumps(msg))
    except Exception:
        pass


def lista_usuarios():
    return [{k: v for k, v in c.items() if k != 'ws'} | {'id': i} for i, c in clientes.items()]


async def avisar_controles():
    msg = {'type': 'users', 'users': lista_usuarios(), 'fire': estado['fire']}
    await asyncio.gather(*(enviar(w, msg) for w in list(controles)))
    brig = [c['ws'] for c in clientes.values() if c.get('role') == 'brigadista']
    await asyncio.gather(*(enviar(w, msg) for w in brig))


def _sin_plan(fire):
    return {k: v for k, v in fire.items() if k != 'plan'} if fire else fire


async def difundir(msg):
    """Envía a todos; el plan de control solo viaja a personal especializado."""
    if msg.get('fire') and 'plan' in msg['fire']:
        publico = {**msg, 'fire': _sin_plan(msg['fire'])}
        await asyncio.gather(*(enviar(c['ws'], msg if c.get('role') == 'brigadista' else publico) for c in list(clientes.values())))
        return
    await asyncio.gather(*(enviar(c['ws'], msg) for c in list(clientes.values())))


@app.websocket('/ws')
async def ws_cliente(ws: WebSocket):
    await ws.accept()
    cid = uuid.uuid4().hex[:8]
    clientes[cid] = {'ws': ws, 'role': 'usuario', 'name': 'Anónimo', 'lat': None, 'lon': None, 'alerted': False}
    await enviar(ws, {'type': 'welcome', 'id': cid, 'fire': _sin_plan(estado['fire']), 'mes': estado['mes_simulado']})
    try:
        while True:
            m = json.loads(await ws.receive_text())
            c = clientes[cid]
            if m['type'] == 'hello':
                ses = sesiones.get(m.get('token') or '')
                if ses:
                    c.update(role=ses['rol'], name=ses['nombre'], verificado=ses['verificado'])
                else:  # sin sesión: solo usuario
                    c.update(role='usuario', name=(m.get('name') or 'Anónimo')[:24])
            elif m['type'] == 'pos':
                c.update(lat=m['lat'], lon=m['lon'])
            if m['type'] in ('hello', 'pos') and c.get('role') == 'brigadista' and estado['fire'] and estado['fire'].get('plan'):
                await asignar_brigadas()
            if m['type'] == 'alerted':
                c.update(alerted=True, dist_km=m.get('dist_km'))
            elif m['type'] == 'safe':
                c.update(alerted=True, safe=True)
            await avisar_controles()
    except (WebSocketDisconnect, RuntimeError, KeyError, ValueError):
        pass
    finally:
        clientes.pop(cid, None)
        await avisar_controles()


@app.websocket('/ws/control')
async def ws_control(ws: WebSocket):
    if not control_ok(ws.cookies):
        await ws.close(code=1008); return
    await ws.accept(); controles.add(ws)
    await enviar(ws, {'type': 'users', 'users': lista_usuarios(), 'fire': estado['fire']})
    try:
        while True:
            m = json.loads(await ws.receive_text())
            if m['type'] == 'fire':
                ctx = await contexto(m['lat'], m['lon'])
                estado['fire'] = {'id': uuid.uuid4().hex[:6], 'lat': m['lat'], 'lon': m['lon'],
                                  'radio_km': m.get('radio_km', 10), 'onda_kms': m.get('onda_kms', 2.0),
                                  't0': time.time(), 'ctx': ctx, 'prop': propagacion(ctx),
                                  'avance_min': 0, 'frente_km': 0.2}
                estado['fire']['plan'] = PC.generar(estado['fire'], _frp_tipico(m['lat'], m['lon']))
                for c in clientes.values():
                    c['alerted'] = False; c['safe'] = False
                await difundir({'type': 'fire', 'fire': estado['fire']})
                await asignar_brigadas()
            elif m['type'] == 'avanzar' and estado['fire']:
                f = estado['fire']; minutos = m.get('min', 30)
                contenido = bool(f.get('plan') and f['plan'].get('contenido'))
                d = 0 if contenido else f['prop']['vel_kmh'] * minutos / 60   # contenido en la brecha: ya no avanza
                f['lat'] += d * math.cos(math.radians(f['prop']['rumbo'])) / 110.57
                f['lon'] += d * math.sin(math.radians(f['prop']['rumbo'])) / (111.32 * math.cos(math.radians(f['lat'])))
                f['avance_min'] += minutos; f['frente_km'] = round(f['frente_km'] + d / 2, 2)
                if f.get('plan'):
                    PC.actualizar(f['plan'], f)
                    if f['plan']['estado'] == 'cruzó la brecha':   # se replantea más adelante
                        v = f['plan']['version'] + 1
                        f['plan'] = PC.generar({**f, 'avance_min': 0}, _frp_tipico(f['lat'], f['lon']))
                        f['plan']['version'], f['plan']['replanteado'] = v, True
                        for k in f['plan']['tacticas']:
                            k['inicio'] += f['avance_min']; k['fin'] += f['avance_min']
                        PC.actualizar(f['plan'], f)
                await difundir({'type': 'update', 'fire': f})
                await asignar_brigadas()
            elif m['type'] == 'fin':
                estado['fire'] = None
                for c in clientes.values():
                    c['alerted'] = False; c['safe'] = False
                await difundir({'type': 'clear'})
            elif m['type'] == 'mes':
                estado['mes_simulado'] = int(m['mes'])
                await difundir({'type': 'mes', 'mes': estado['mes_simulado']})
            await avisar_controles()
    except (WebSocketDisconnect, RuntimeError, KeyError, ValueError):
        pass
    finally:
        controles.discard(ws)


def _frp_tipico(lat, lon):
    """Intensidad típica (MW) de la zona en el mes simulado, para dimensionar el plan."""
    z = _frp_zona(lat, lon, .15)
    return z['frp_mes'][estado['mes_simulado'] - 1] if z.get('frp_mes') else None


async def asignar_brigadas():
    """Asigna sector y tarea a cada brigadista conectado (celular o computadora) y se la envía."""
    f = estado['fire']
    if not f or not f.get('plan'):
        return
    brig = [{'id': i, 'name': c['name'], 'lat': c.get('lat'), 'lon': c.get('lon')} for i, c in clientes.items() if c.get('role') == 'brigadista']
    for a in PC.asignar(f['plan'], brig):
        c = clientes.get(a['id'])
        if c:
            await enviar(c['ws'], {'type': 'asignacion', 'tarea': a, 'plan_version': f['plan']['version'], 'estado': f['plan']['estado']})
    await avisar_controles()


# ---------------------------------------------------------------- portada: timelapse compacto (celdas de 0.25°)
TL = None
@app.get('/api/timelapse')
def timelapse():
    global TL
    if TL is None and cal is not None:
        meses = sorted(MAPA)
        celdas = sorted({k for c in MAPA.values() for k in c.index})
        idx = {k: i for i, k in enumerate(celdas)}
        TL = {'meses': [list(m) for m in meses], 'celdas': [list(c) for c in celdas],
              'datos': [[[idx[k], round(float(v))] for k, v in MAPA[m].items() if v >= 1] for m in meses],
              'bbox': [-118.5, 14.5, -86.5, 32.8]}
    return TL or {'meses': []}


# ---------------------------------------------------------------- login (demo)
CODIGO_DEMO = os.environ.get('IGNIS_CODIGO', 'CONAFOR-2026')
sesiones: dict[str, dict] = {}

@app.post('/api/login')
async def login(datos: dict):
    nombre = (datos.get('nombre') or '').strip()[:24]
    rol = 'brigadista' if datos.get('rol') == 'brigadista' else 'usuario'
    if not nombre:
        return JSONResponse({'error': 'Escribe tu nombre'}, 400)
    if rol == 'brigadista' and (datos.get('codigo') or '').strip().upper() != CODIGO_DEMO:
        return JSONResponse({'error': 'Código de credencial no válido'}, 401)
    token = uuid.uuid4().hex
    sesiones[token] = {'nombre': nombre, 'rol': rol, 'verificado': rol == 'brigadista'}
    return {'token': token, **sesiones[token]}


# ---------------------------------------------------------------- explorador (requisitos del reto)
@app.get('/api/mapa')
def capa_mapa(y: int, m: int):
    c = MAPA.get((y, m))
    if c is None:
        return {'y': y, 'm': m, 'celdas': []}
    return {'y': y, 'm': m, 'celdas': [[a, b, round(float(v), 1)] for (a, b), v in c.items()]}


@app.get('/api/frp')
def frp_area(w: float, s: float, e: float, n: float, desde: int = 2002, hasta: int = 2026):
    """Intensidad del fuego del área: serie mensual, año típico, correlación con los eventos armonizados."""
    if frp is None:
        return {'available': False, 'reason': 'Falta data/frp_celdas.parquet (corre herramientas/armonizar_frp.py)'}
    d = _frp_caja(w, s, e, n, desde, hasta)
    if d.empty:
        return {'available': False, 'reason': 'Sin detecciones con FRP en esta área y periodo'}
    idx = pd.MultiIndex.from_tuples([(y, m) for y in range(desde, hasta + 1) for m in range(1, 13)
                                     if (y, m) >= (2002, 7) and (cal is None or (y, m) <= tuple(ULTIMO))], names=['year', 'month'])
    g = d.groupby(['year', 'month']).agg(frp=('frp_armonizado', 'sum'), frp_max=('frp_max_armonizado', 'max'),
                                         det=('detecciones', 'sum')).reindex(idx, fill_value=0)
    ev = _aoi(w, s, e, n, desde, hasta).armonizado.reindex(idx, fill_value=0) if cal is not None else pd.Series(0, index=idx)
    completos = g[g.index.get_level_values(0) <= 2025]
    tabla = completos.frp.unstack(fill_value=0)
    clim = tabla.mean() if len(tabla) else pd.Series(0.0, index=range(1, 13))
    clim = clim.reindex(range(1, 13), fill_value=0)
    p10, p90 = (tabla.quantile(.1), tabla.quantile(.9)) if len(tabla) > 2 else (clim, clim)
    anual = g.frp.groupby(level=0).sum()
    top = g.frp.sort_values(ascending=False).head(3)
    orden = clim.sort_values(ascending=False)
    activos = ev > 0
    return {
        'available': True, 'desde': desde, 'hasta': hasta,
        'mensual': [{'y': int(y), 'm': int(m), 'frp': round(float(r.frp), 1), 'max': round(float(r.frp_max), 1),
                     'det': int(r.det), 'ev': round(float(ev.loc[(y, m)]), 1)} for (y, m), r in g.iterrows()],
        'clima': {'media': [round(float(v), 1) for v in clim], 'p10': [round(float(v), 1) for v in p10.reindex(range(1, 13), fill_value=0)],
                  'p90': [round(float(v), 1) for v in p90.reindex(range(1, 13), fill_value=0)]},
        'anual': {'anios': [int(a) for a in anual.index], 'valores': [round(float(v), 1) for v in anual]},
        'total': round(float(g.frp.sum())), 'max_det': round(float(g.frp_max.max()), 1),
        'mes_pico': int(clim.idxmax()) if clim.sum() else None,
        'pct_temporada': round(100 * float(orden.head(3).sum() / clim.sum()), 0) if clim.sum() else None,
        'meses_temporada': [int(m) for m in orden.head(3).index],
        'top': [{'y': int(y), 'm': int(m), 'frp': round(float(v), 1)} for (y, m), v in top.items() if v > 0],
        'correlacion': {'frp_eventos': _corr(g.frp, ev), 'frp_detecciones': _corr(g.frp, g.det),
                        'intensidad_por_evento': round(float(g.frp[activos].sum() / ev[activos].sum()), 1) if ev[activos].sum() else None},
        'matriz': {'anios': list(range(desde, hasta + 1)), 'valores': g.frp.unstack().reindex(index=range(desde, hasta + 1), columns=range(1, 13)).fillna(0).round(0).values.tolist()},
        'ajuste': FRP_AJUSTE, 'fuente': FUENTE_FRP,
    }


@app.get('/api/frp.csv')
def frp_csv(w: float, s: float, e: float, n: float, desde: int = 2002, hasta: int = 2026):
    r = frp_area(w, s, e, n, desde, hasta)
    if not r.get('available'):
        return JSONResponse({'error': r.get('reason')}, 404)
    df = pd.DataFrame(r['mensual']).rename(columns={'y': 'year', 'm': 'month', 'frp': 'frp_armonizado_mw', 'max': 'frp_max_mw',
                                                    'det': 'detecciones', 'ev': 'eventos_armonizados'})
    hdr = f'# IGNIS · intensidad FRP armonizada (escala VIIRS) · area W{w:.3f} S{s:.3f} E{e:.3f} N{n:.3f} · {desde}-{hasta}\n'
    return Response(hdr + df.to_csv(index=False), media_type='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=ignis_intensidad_frp.csv'})


@app.get('/api/celda')
def celda(lat: float, lon: float, y: int, r: float = 0.125):
    """12 meses de una celda del mapa (eventos armonizados + FRP) para la gráfica al pasar el cursor."""
    out = {'y': y, 'eventos': [0.0] * 12, 'frp': [0.0] * 12}
    if cal is not None:
        d = cal[cal.lat_c.between(lat - r, lat + r) & cal.lon_c.between(lon - r, lon + r) & (cal.year == y)]
        for m, v in d.groupby('month').armonizado.sum().items():
            out['eventos'][int(m) - 1] = round(float(v), 1)
    if frp is not None:
        d = _frp_caja(lon - r, lat - r, lon + r, lat + r, y, y)
        for m, v in d.groupby('month').frp_armonizado.sum().items():
            out['frp'][int(m) - 1] = round(float(v), 1)
    return out


def _aoi(w, s, e, n, desde, hasta):
    d = cal[cal.lat_c.between(s, n) & cal.lon_c.between(w, e) & cal.year.between(desde, hasta)]
    return d.groupby(['year', 'month'])[['armonizado', 'pixeles_modis', 'pixeles_viirs', 'eventos_viirs_todos']].sum()


@app.get('/api/aoi')
def aoi(w: float, s: float, e: float, n: float, desde: int = 2002, hasta: int = 2026, y: int | None = None, m: int | None = None):
    g = _aoi(w, s, e, n, desde, hasta)
    if g.empty:
        return {'available': False, 'reason': 'Sin detecciones en esta área y periodo'}
    mat = g.armonizado.unstack(fill_value=0).reindex(index=range(desde, hasta + 1), columns=range(1, 13), fill_value=0)
    y, m = y or ULTIMO[0], m or ULTIMO[1]
    hist = mat.loc[[a for a in mat.index if a != y and a <= 2025], m]
    actual = float(mat.loc[y, m]) if y in mat.index else 0.0
    med = float(hist.median()) if len(hist) else 0.0
    anual = mat.loc[[a for a in mat.index if a <= 2025]].sum(axis=1)
    return {'available': True, 'y': y, 'm': m, 'actual': round(actual, 1), 'mediana': round(med, 1),
            'anomalia_pct': round(100 * (actual - med) / med, 0) if med else None,
            'percentil': round(100 * float((hist < actual).mean()), 0) if len(hist) else None,
            'total': round(float(mat.values.sum())), 'anio_max': int(anual.idxmax()),
            'anual': {'anios': [int(a) for a in anual.index], 'valores': [round(float(v), 1) for v in anual]},
            'matriz': {'anios': list(mat.index), 'valores': mat.round(1).values.tolist()},
            'fuente': 'NASA FIRMS · serie armonizada MODIS→VIIRS (eventos ≥20 MW)'}


@app.get('/api/aoi.csv')
def aoi_csv(w: float, s: float, e: float, n: float, desde: int = 2002, hasta: int = 2026):
    g = _aoi(w, s, e, n, desde, hasta).reset_index()
    g.insert(2, 'sensor_base', ['MODIS convertido' if a < 2012 else 'VIIRS' for a in g.year])
    hdr = f'# IGNIS · calendario armonizado · area W{w:.3f} S{s:.3f} E{e:.3f} N{n:.3f} · {desde}-{hasta}\n'
    return Response(hdr + g.round(2).to_csv(index=False), media_type='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=ignis_calendario_area.csv'})


@app.get('/api/hotspots.csv')
def hotspots(w: float, s: float, e: float, n: float, desde: int = 2025, hasta: int = 2026):
    """Detecciones crudas del área (requiere data/modis.parquet y data/viirs.parquet)."""
    partes = []
    for f in ('modis', 'viirs'):
        p = ROOT / 'data' / f'{f}.parquet'
        if p.exists():
            filtros = [('latitude', '>=', s), ('latitude', '<=', n), ('longitude', '>=', w), ('longitude', '<=', e),
                       ('year', '>=', desde), ('year', '<=', hasta)]
            partes.append(pd.read_parquet(p, filters=filtros, columns=['latitude', 'longitude', 't', 'daynight', 'sensor',
                                                                       'satellite', 'frp', 'conf']))
    if not partes:
        return JSONResponse({'error': 'Copia modis.parquet y viirs.parquet en data/ para descargar detecciones'}, 404)
    d = pd.concat(partes).sort_values('t').head(200_000)
    return Response(d.to_csv(index=False), media_type='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=ignis_hotspots_area.csv'})


# ---------------------------------------------------------------- eventos reconstruidos (servicio de clustering del equipo)
ID_JOB, ID_EVT = re.compile(r'^[0-9a-f]{12}$'), re.compile(r'^EVT-\d{5}$')


async def _cluster(method: str, ruta: str, **kw):
    if not CLUSTER:
        return JSONResponse({'error': 'El servicio de eventos no está configurado (CLUSTER_API_URL).'}, 503)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=4)) as c:
            r = await c.request(method, CLUSTER + ruta, **kw)
    except httpx.HTTPError:
        return JSONResponse({'error': 'El servicio de eventos no responde.'}, 503)
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get('content-type', 'application/json'))


def _ids(job: str, evt: str | None = None):
    if not ID_JOB.match(job) or (evt is not None and not ID_EVT.match(evt)):
        return JSONResponse({'error': 'Identificador no válido'}, 400)


_resumen = {'t': 0.0, 'v': None}   # el conteo de millones de filas es caro: se guarda 2 min


@app.get('/api/eventos/estado')
async def eventos_estado():
    out = {'disponible': False, 'laboratorio': LAB_URL, 'detecciones': None, 'ingesta_en_curso': None}
    if not CLUSTER:
        out['motivo'] = 'Servicio de eventos no configurado'
        return out
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            out['disponible'] = (await c.get(CLUSTER + '/health')).status_code == 200
            if DATOS:
                out['ingesta_en_curso'] = (await c.get(DATOS + '/v1/ingestions/status')).json().get('running')
                if time.time() - _resumen['t'] > 120 or _resumen['v'] is None:
                    s = (await c.get(DATOS + '/v1/detections/summary', timeout=30)).json()['total']
                    _resumen.update(t=time.time(), v=s)
                s = _resumen['v']
                out['detecciones'] = s['count']
                out['periodo'] = [s['first_detection'], s['last_detection']]
    except (httpx.HTTPError, KeyError, ValueError):
        out['motivo'] = out.get('motivo') or 'El servicio de eventos no responde'
    return out


@app.post('/api/eventos/reconstrucciones')
async def eventos_crear(datos: dict):
    return await _cluster('POST', '/v1/reconstructions', json=datos)


@app.get('/api/eventos/reconstrucciones/{job}')
async def eventos_job(job: str):
    return _ids(job) or await _cluster('GET', f'/v1/reconstructions/{job}')


@app.get('/api/eventos/reconstrucciones/{job}/eventos')
async def eventos_lista(job: str, min_detections: int = 1, min_active_days: int = 1):
    return _ids(job) or await _cluster('GET', f'/v1/reconstructions/{job}/events',
                                       params={'min_detections': max(1, min_detections), 'min_active_days': max(1, min_active_days)})


@app.get('/api/eventos/reconstrucciones/{job}/eventos/{evt}/linea')
async def eventos_linea(job: str, evt: str):
    return _ids(job, evt) or await _cluster('GET', f'/v1/reconstructions/{job}/events/{evt}/timeline', params={'max_points_per_frame': 1500})


@app.get('/api/eventos/reconstrucciones/{job}/calendario')
async def eventos_calendario(job: str):
    return _ids(job) or await _cluster('GET', f'/v1/reconstructions/{job}/calendar')


def _pagina(nombre: str, request: Request):
    """Sirve la página con la imagen de vista previa en URL absoluta (WhatsApp/redes la exigen)."""
    html = (ROOT / 'static' / nombre).read_text(encoding='utf-8')
    html = html.replace('content="/static/og.png"', f'content="{url_publica(request)}/static/og.png"')
    return Response(html, media_type='text/html; charset=utf-8', headers={'Cache-Control': 'no-cache'})


@app.get('/eventos')
def pagina_eventos(request: Request):
    return _pagina('eventos.html', request)


@app.get('/api/salud')
def salud():
    return {'status': 'ok', 'calendario': cal is not None, 'conectados': len(clientes)}


def url_publica(request: Request | None = None) -> str:
    """URL del QR: PUBLIC_URL si existe; detrás del proxy, el dominio con el que entraron; en la laptop, la IP local."""
    if os.environ.get('PUBLIC_URL'):
        return os.environ['PUBLIC_URL'].rstrip('/')
    port = int(os.environ.get('PORT', 8000))
    if request is not None:
        host = request.headers.get('x-forwarded-host') or request.headers.get('host', '')
        nombre = host.rsplit(':', 1)[0] if host.count(':') == 1 else host
        if nombre and nombre not in ('localhost', '127.0.0.1', '0.0.0.0') and not nombre.startswith('['):
            return f"{request.headers.get('x-forwarded-proto', request.url.scheme)}://{host}"
    return f'http://{ip_local()}:{port}'


@app.get('/api/info')
def info(request: Request = None):
    return {'url': url_publica(request), 'mes': estado['mes_simulado'], 'ultimo': list(ULTIMO) if cal is not None else None,
            'conectados': len(clientes), 'laboratorio': LAB_URL, 'eventos': bool(CLUSTER),
            'hotspots': all((ROOT / 'data' / f'{f}.parquet').exists() for f in ('modis', 'viirs'))}


@app.get('/api/qr.svg')
def qr(request: Request, url: str | None = None):
    import io, qrcode, qrcode.image.svg
    destino = url if url and re.match(r'^https?://[\w.\-\[\]:]{1,120}/?$', url) else url_publica(request)
    buf = io.BytesIO()
    qrcode.make(destino, image_factory=qrcode.image.svg.SvgPathImage).save(buf)
    return Response(buf.getvalue(), media_type='image/svg+xml')


@app.get('/')
def index(request: Request):
    return _pagina('index.html', request)


@app.get('/control')
def control(request: Request):
    if not control_ok(request.cookies):
        return FileResponse(ROOT / 'static' / 'acceso.html', headers={'Cache-Control': 'no-store'})
    return FileResponse(ROOT / 'static' / 'control.html', headers={'Cache-Control': 'no-store'})


@app.post('/api/control/acceso')
async def control_acceso(datos: dict, request: Request):
    clave = str(datos.get('clave') or '')
    if not CONTROL_CLAVE or not hmac.compare_digest(clave.encode(), CONTROL_CLAVE.encode()):
        await asyncio.sleep(1.2)   # frena intentos por fuerza bruta
        return JSONResponse({'error': 'Contraseña incorrecta'}, 401)
    r = JSONResponse({'ok': True})
    seguro = request.headers.get('x-forwarded-proto', request.url.scheme) == 'https'
    r.set_cookie('ignis_control', _token_control(), max_age=12 * 3600, httponly=True, samesite='lax', secure=seguro)
    return r


if __name__ == '__main__':
    import uvicorn
    port = int(os.environ.get('PORT', 8000))
    print(f'\n  Celulares:  http://{ip_local()}:{port}\n  Control:    http://localhost:{port}/control\n')
    uvicorn.run(app, host='0.0.0.0', port=port, log_level='warning')
