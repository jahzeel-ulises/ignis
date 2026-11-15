"""IGNIS · Laboratorio de eventos (motor Fireprint): área, periodo, eventos e historia temporal."""
from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import time
import requests
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

from streamlit_app import services
from streamlit_app import maps
from streamlit_app.maps import bbox_from_drawing, draw_area_map, events_map, timeline_map

IGNIS_URL = os.getenv('IGNIS_URL', '/').rstrip('/') or ''
st.set_page_config(page_title='IGNIS · Laboratorio', page_icon=str(Path(__file__).with_name('icono.png')), layout='wide')
# Mismo sistema visual que IGNIS Alerta: IBM Plex, brasa como único acento, superficies cálidas.
# Estilo IGNIS que se adapta solo al tema (día/noche) que elija el usuario en ⋮ → Settings:
# no fija colores de fondo ni de texto, solo acentos y transparencias que funcionan en ambos.
try:
    CLARO = st.context.theme.type == 'light'
except Exception:
    CLARO = False
PALETA = {'__SUP__': 'rgba(128,128,128,.07)', '__SUP2__': 'rgba(128,128,128,.09)', '__BORDE__': 'rgba(128,128,128,.28)'}
CSS_IGNIS = '''<style>
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap");
html, body, [data-testid="stApp"], [data-testid="stSidebar"], button, input, select, textarea { font-family: "IBM Plex Sans", system-ui, sans-serif !important; }
[data-testid="stApp"] { background-image: radial-gradient(60% 40% at 100% 0%, #ff6a2b1f, transparent 70%); }
[data-testid="stSidebar"] { border-right: 1px solid __BORDE__; }
[data-testid="stHeader"] { background: transparent; }
.block-container { padding-top: 1.6rem; max-width: 1200px; }
h1, h2, h3, [data-testid="stMetricValue"] { font-family: "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif !important; letter-spacing: -.01em; }
h2, h3 { font-size: 1.05rem !important; font-family: "IBM Plex Mono", monospace !important; font-weight: 500 !important; letter-spacing: .06em; text-transform: uppercase; color: #e8561f; margin-top: 1.2rem; }
[data-testid="stMetric"] { background: __SUP2__; border: 1px solid __BORDE__; border-radius: 10px; padding: 12px 14px; }
[data-testid="stMetricValue"] { font-size: 2.1rem; font-variant-numeric: tabular-nums; }
[data-testid="stMetricLabel"] { opacity: .7; }
.stButton > button { border-radius: 10px; font-weight: 600; min-height: 44px; transition: transform .15s, box-shadow .25s; }
.stButton > button:active { transform: scale(.97); }
.stButton > button[kind="primary"] { box-shadow: 0 8px 26px #e8561f44; }
iframe { border-radius: 12px; border: 1px solid __BORDE__ !important; }
.ig-cab { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: .2rem; }
.ig-cab svg { width: 34px; height: 34px; color: #e8561f; filter: drop-shadow(0 0 10px #ff6a2b88); animation: ig-llama 1.1s ease-in-out infinite alternate; transform-origin: 50% 90%; }
.ig-cab h1 { margin: 0; padding: 0; font-size: 2.3rem; }
.ig-cab h1 small { font: 500 .95rem "IBM Plex Mono", monospace; opacity: .6; margin-left: .5rem; letter-spacing: .04em; }
.ig-nav { margin-left: auto; display: flex; gap: 8px; }
.ig-nav a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid __BORDE__; background: __SUP__;
  color: inherit !important; text-decoration: none !important; font-size: .9rem; transition: border-color .2s, transform .2s; }
.ig-nav a:hover { border-color: #e8561f; transform: translateY(-1px); }
.ig-nav a.ig-prim { background: #e8561f; border-color: #e8561f; color: #fff !important; }
.ig-sub { opacity: .85; margin: .2rem 0 1rem; max-width: 70ch; }
@keyframes ig-llama { to { transform: scale(.94, 1.08) rotate(2deg); } }
@media (prefers-reduced-motion: reduce) { .ig-cab svg { animation: none; } }
@media (max-width: 640px) { .ig-cab h1 { font-size: 1.8rem; } .ig-nav { margin-left: 0; } }
</style>'''
for clave, valor in PALETA.items():
    CSS_IGNIS = CSS_IGNIS.replace(clave, valor)
st.markdown(CSS_IGNIS, unsafe_allow_html=True)
maps.CLARO = CLARO

st.markdown(f'''<div class="ig-cab">
<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.3 2.2c.9 3.2-1.7 4.7-1.7 7.4 0 1.6 1.2 2.8 2.7 2.8 2 0 2.8-1.8 2.3-3.7 2.3 1.9 3.6 4.2 3.6 6.6A7.2 7.2 0 0 1 4.8 15.3c0-4.3 3.9-6.3 7.5-13.1z"/></svg>
<h1>IGNIS <small>laboratorio de eventos</small></h1>
<nav class="ig-nav"><a href="{IGNIS_URL}/" target="_self">← IGNIS Alerta</a><a class="ig-prim" href="{IGNIS_URL}/eventos" target="_self">Vista animada</a></nav></div>
<p class="ig-sub">Reconstrucción exploratoria de incendios a partir de detecciones MODIS y VIIRS de NASA FIRMS: agrupamiento por día (DBSCAN) y unión entre días. Ajusta los parámetros y revisa cada evento.</p>''', unsafe_allow_html=True)

if 'bbox' not in st.session_state:
    st.session_state['bbox'] = [-99.5, 18.4, -98.7, 19.2]
if 'job_id' not in st.session_state:
    st.session_state['job_id'] = None
if 'last_area_drawing' not in st.session_state:
    st.session_state['last_area_drawing'] = None
if 'area_key_version' not in st.session_state:
    st.session_state['area_key_version'] = 0

with st.sidebar:
    st.header('Parámetros')
    start_date = st.date_input('Desde', value=date(2010, 3, 1))
    end_date = st.date_input('Hasta (incluido)', value=date(2010, 3, 31))
    sensor = st.selectbox('Sensor', ['ALL', 'MODIS', 'VIIRS'],
                          format_func=lambda s: 'Ambos' if s == 'ALL' else s)
    type_code = st.selectbox('Tipo de fuente térmica', ['0', 'all'],
                             format_func=lambda s: 'Vegetación (0)' if s == '0' else 'Todos los tipos')
    with st.expander('Ajustes del clustering'):
        spatial_eps_m = st.number_input('Agrupamiento espacial (m)', 100., 25000., 1200., step=100.)
        tracking_distance_m = st.number_input('Distancia entre días (m)', 100., 50000., 1500., step=100.)
        max_gap_hours = st.number_input('Máximo intervalo entre observaciones (h)', 1., 240., 48., step=12.)
        min_samples = st.number_input('Mínimo de detecciones por grupo', 1, 50, 1)
    min_event_detections = st.number_input('Detecciones mínimas por evento para mostrar', 1, 99999, 2)
    min_event_days = st.number_input('Días activos mínimos para mostrar', 1, 99, 1)

st.subheader('1 · Seleccionar región')
st.caption('Dibuja un rectángulo. También puedes ajustar los límites manualmente.')

with st.expander('Coordenadas de la región'):
    a, b, c, d = st.columns(4)
    west = a.number_input('Oeste', -180., 180., float(st.session_state['bbox'][0]), format='%.4f', key='coord_w')
    south = b.number_input('Sur', -90., 90., float(st.session_state['bbox'][1]), format='%.4f', key='coord_s')
    east = c.number_input('Este', -180., 180., float(st.session_state['bbox'][2]), format='%.4f', key='coord_e')
    north = d.number_input('Norte', -90., 90., float(st.session_state['bbox'][3]), format='%.4f', key='coord_n')
    if st.button('Usar estas coordenadas'):
        st.session_state['bbox'] = [west, south, east, north]
        st.session_state['last_area_drawing'] = None
        st.session_state['area_key_version'] += 1
        st.rerun()

area_data = st_folium(draw_area_map(st.session_state['bbox']),
                      width=None, height=350, key=f"area_picker_{st.session_state['area_key_version']}",
                      returned_objects=['all_drawings'])
drawings = area_data.get('all_drawings') if area_data else None
if drawings:
    candidate = drawings[-1]
    geometry_sig = str(candidate.get('geometry', {}))
    new_bbox = bbox_from_drawing(candidate)
    if new_bbox and geometry_sig != st.session_state['last_area_drawing']:
        st.session_state['last_area_drawing'] = geometry_sig
        st.session_state['bbox'] = new_bbox

bbox = st.session_state['bbox']
st.caption(f'Área seleccionada: **{bbox[0]}, {bbox[1]}, {bbox[2]}, {bbox[3]}** (O, S, E, N)')

if st.button('Reconstruir eventos del periodo', type='primary'):
    if end_date < start_date:
        st.error('La fecha final debe ser igual o posterior a la inicial.')
    elif not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
        st.error('Las coordenadas del rectángulo no son válidas.')
    else:
        payload = {
            'start': datetime.combine(start_date, datetime.min.time(), timezone.utc).isoformat(),
            'end': datetime.combine(end_date + timedelta(days=1), datetime.min.time(), timezone.utc).isoformat(),
            'bbox': bbox, 'sensor': sensor, 'type_code': type_code,
            'parameters': {
                'spatial_eps_m': spatial_eps_m,
                'tracking_distance_m': tracking_distance_m,
                'max_gap_hours': max_gap_hours,
                'min_samples': min_samples,
            }
        }
        try:
            result = services.reconstruct(payload)
            st.session_state['job_id'] = result['job_id']
        except requests.RequestException as exc:
            st.error(f'No se pudo iniciar la reconstrucción: {exc}')

job_id = st.session_state.get('job_id')
if not job_id:
    st.info('Selecciona una región, elige fechas y pulsa **Reconstruir eventos del periodo**.')
    st.stop()

try:
    status = services.get_job(job_id)
except requests.RequestException as exc:
    st.error(f'No se pudo consultar la reconstrucción: {exc}')
    st.stop()

if status['status'] in ('queued', 'running'):
    info = st.empty()
    info.info('Procesando detecciones y reconstruyendo eventos…')
    # Espera acotada para evitar bloquear indefinidamente la sesión.
    for _ in range(240):
        time.sleep(1)
        try:
            status = services.get_job(job_id)
        except requests.RequestException as exc:
            st.error(f'La API no respondió: {exc}')
            st.stop()
        if status['status'] not in ('queued', 'running'):
            break
    info.empty()
    if status['status'] in ('queued', 'running'):
        st.warning('La reconstrucción continúa. Pulsa «Actualizar resultados».')
        if st.button('Actualizar resultados'):
            st.rerun()
        st.stop()

if status['status'] == 'failed':
    st.error(f"No se pudo reconstruir: {status.get('error')}")
    st.stop()

try:
    events = services.get_events(job_id, min_event_detections, min_event_days)
    calendar = services.get_calendar(job_id)
except requests.RequestException as exc:
    st.error(f'Error consultando resultados: {exc}')
    st.stop()

st.caption('Los resultados corresponden a la última reconstrucción ejecutada.')
st.subheader('2 · Resumen histórico')
c1, c2, c3 = st.columns(3)
c1.metric('Detecciones analizadas', f"{status['detection_count']:,}")
c2.metric('Eventos reconstruidos', f"{status['event_count']:,}")
c3.metric('Eventos visibles tras filtros', f'{len(events):,}')
if status.get('excluded_count'):
    st.caption(f"Detecciones excluidas por densidad mínima: {status['excluded_count']:,}.")
st.caption('Los eventos son agrupamientos espacio-temporales candidatos, no incendios confirmados.')

if calendar:
    calendar_df = pd.DataFrame(calendar).set_index('period')
    st.bar_chart(calendar_df[['events_started', 'active_events']].rename(columns={'events_started': 'Iniciados', 'active_events': 'Activos'}),
                 color=['#ffb020', '#e8561f'])
    st.caption('Eventos iniciados: primera detección en el mes. Activos: con al menos una detección en ese mes.')
    calendar_df = calendar_df.reset_index()
    calendar_df['year'] = calendar_df['period'].str[:4]
    calendar_df['month'] = calendar_df['period'].str[-2:]
    heatmap = calendar_df.pivot(index='year', columns='month', values='active_events').fillna(0)
    st.dataframe(heatmap.style.background_gradient(cmap='Oranges').format('{:.0f}'))
else:
    st.info('No hay detecciones en el área y periodo seleccionados.')

if not events:
    st.info('No hay eventos con los filtros elegidos. Prueba reducir los mínimos.')
    st.stop()

st.subheader('3 · Eventos encontrados')
options = {f"{e['event_id']} · {e['detections']} detecciones · {e['active_days']} días": e
           for e in events}
selected_name = st.selectbox('Selecciona un evento para examinar su evolución', list(options))
event = options[selected_name]
st_folium(events_map(bbox, events, selected_id=event['event_id']), height=420, use_container_width=True,
          returned_objects=[], key=f"eventos_{event['event_id']}")
st.caption('Los marcadores representan el centro promedio de las detecciones del evento, no su perímetro.')

st.subheader('4 · Evolución temporal del evento')
@st.cache_data(ttl=900, show_spinner=False)
def load_timeline(job_id_arg, event_id_arg):
    return services.get_timeline(job_id_arg, event_id_arg)

try:
    timeline = load_timeline(job_id, event['event_id'])
except requests.RequestException as exc:
    st.error(f'No se pudo obtener la evolución: {exc}')
    st.stop()

frames = timeline['frames']
if not frames:
    st.info('Este evento no contiene observaciones.')
    st.stop()

m1, m2, m3 = st.columns(3)
m1.metric('Duración observada', f"{event['observed_duration_hours']:,.1f} h")
m2.metric('Días con detección', event['active_days'])
m3.metric('FRP máxima observada', f"{event['max_frp_mw']} MW" if event['max_frp_mw'] is not None else 'N/D')

index = (st.slider('Día de la evolución', min_value=0, max_value=len(frames)-1,
                  value=0, format='%d') if len(frames) > 1 else 0)
st.caption(f"Fecha seleccionada: **{frames[index]['date']}** (UTC)")
show_envelope = st.checkbox('Mostrar envolvente aproximada de las detecciones acumuladas', value=False)

previous = []
parts = []
for frame in frames:
    parts.append(list(previous))
    previous += frame['points']

holder = st.empty()

def render_frame(i):
    frame = frames[i]
    with holder.container():
        st.write(f"**{frame['date']}** · Nuevas: {frame['new_detections_count']} · Acumuladas: {frame['cumulative_detections_count']}")
        st_folium(timeline_map(
            event, parts[i], frame['points'],
            frame.get('observed_envelope') if show_envelope else None
        ), height=460, use_container_width=True, returned_objects=[], key=f"linea_{event['event_id']}_{i}_{play}")
        if frame['sampled']:
            st.caption('La visualización de este día muestra una muestra de puntos; las métricas usan todos los registros.')

play = st.button('Reproducir evolución')
if play:
    for i in range(len(frames)):
        render_frame(i)
        time.sleep(0.5)
else:
    render_frame(index)

counts = pd.DataFrame([{'date': f['date'], 'detections': f['new_detections_count']}
                       for f in frames]).set_index('date')
st.area_chart(counts.rename(columns={'detections': 'Detecciones nuevas'}), color='#e8561f')
st.caption('MODIS = ámbar · VIIRS = brasa · días anteriores = gris. La envolvente es geométrica, NO representa área quemada ni propagación real.')
