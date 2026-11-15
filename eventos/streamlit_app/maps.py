"""Mapas Folium: dibujo de área, catálogo de eventos y animación temporal."""
import folium
from folium.plugins import Draw

# Mismo mapa base y colores que IGNIS Alerta (Esri gris oscuro, sin clave de API).
ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_{}/MapServer/tile/{{z}}/{{y}}/{{x}}'
ATTR = 'Tiles © Esri, HERE, Garmin, © OpenStreetMap'
MODIS, VIIRS, PREVIO, BRASA, AMBAR = '#ffb020', '#ff5a1f', '#8f8178', '#e8561f', '#ffb020'


CLARO = False   # lo fija app.py según el tema día/noche


def base_map(location, zoom):
    m = folium.Map(location=location, zoom_start=zoom, tiles=None, control_scale=True, max_zoom=18)
    if CLARO:   # de día: calles (OpenStreetMap), como IGNIS Alerta
        folium.TileLayer('OpenStreetMap', name='Calles', max_zoom=18).add_to(m)
    else:       # de noche: Esri gris oscuro con etiquetas
        folium.TileLayer(ESRI.format('Base'), attr=ATTR, name='Oscuro', max_zoom=16).add_to(m)
        folium.TileLayer(ESRI.format('Reference'), attr=ATTR, name='Etiquetas', overlay=True, control=False, max_zoom=16).add_to(m)
    return m


def bbox_from_drawing(feature):
    """Obtiene bbox de rectángulo o polígono GeoJSON (incluidos MultiPolygon)."""
    if not feature:
        return None
    geometry = feature.get('geometry') or {}
    kind = geometry.get('type')
    coordinates = geometry.get('coordinates') or []
    if kind == 'Polygon':
        rings = coordinates
    elif kind == 'MultiPolygon':
        rings = [ring for poly in coordinates for ring in poly]
    else:
        return None
    points = [p for ring in rings for p in ring]
    if not points:
        return None
    lons, lats = [float(p[0]) for p in points], [float(p[1]) for p in points]
    return [round(min(lons), 5), round(min(lats), 5),
            round(max(lons), 5), round(max(lats), 5)]


def draw_area_map(bbox):
    west, south, east, north = bbox
    m = base_map([(south + north) / 2, (west + east) / 2], 8)
    folium.Rectangle(bounds=[[south, west], [north, east]],
                     color=AMBAR, weight=2, dash_array='6,4', fill=True, fill_color=BRASA, fill_opacity=0.08,
                     tooltip='Área actual').add_to(m)
    Draw(export=False, draw_options={
        'polyline': False, 'polygon': False, 'rectangle': True,
        'circle': False, 'circlemarker': False, 'marker': False
    }, edit_options={'edit': False, 'remove': True}).add_to(m)
    m.fit_bounds([[south, west], [north, east]])
    return m


def events_map(bbox, events, selected_id=None):
    west, south, east, north = bbox
    m = base_map([(south + north) / 2, (west + east) / 2], 8)
    folium.Rectangle(bounds=[[south, west], [north, east]],
                     color=AMBAR, weight=1, dash_array='6,4', fill=False).add_to(m)
    for e in events[:1500]:
        is_selected = e['event_id'] == selected_id
        folium.CircleMarker(
            [e['center']['latitude'], e['center']['longitude']],
            radius=9 if is_selected else 5, weight=2 if is_selected else 1,
            color='#fff3c4' if is_selected else '#7a2408',
            fill=True, fill_color='#ff3b30' if is_selected else BRASA,
            fill_opacity=0.9,
            tooltip=(f"{e['event_id']} · {e['detections']} detecciones · "
                     f"{e['active_days']} días activos")
        ).add_to(m)
    m.fit_bounds([[south, west], [north, east]])
    return m


def timeline_map(event, previous_points, new_points, observed_envelope=None):
    center = event['center']
    m = base_map([center['latitude'], center['longitude']], 10)
    if observed_envelope:
        folium.GeoJson(observed_envelope, style_function=lambda _: {
            'color': '#ff3b30', 'weight': 2, 'dashArray': '6,5',
            'fillColor': '#ff3b30', 'fillOpacity': 0.06,
        }, tooltip='Envolvente de centros observados (NO es área quemada)').add_to(m)
    # Priorizar puntos recientes y limitar la representación acumulada.
    for r in previous_points[-2500:]:
        folium.CircleMarker(
            [r['latitude'], r['longitude']], radius=3, color=PREVIO,
            weight=0, fill=True, fill_color=PREVIO, fill_opacity=0.4,
            tooltip=f"Anterior · {r['sensor']}"
        ).add_to(m)
    for r in new_points:
        color = MODIS if r['sensor'] == 'MODIS' else VIIRS
        folium.CircleMarker(
            [r['latitude'], r['longitude']], radius=4, color=color,
            weight=1, fill=True, fill_color=color, fill_opacity=0.85,
            tooltip=f"{r['sensor']} · {r['detected_at']} · FRP: {r['frp_mw']} MW"
        ).add_to(m)
    visible = previous_points[-2500:] + new_points
    if visible:
        lats = [r['latitude'] for r in visible]
        lons = [r['longitude'] for r in visible]
        # Para eventos muy localizados, fit_bounds puede acercarse demasiado.
        pad = 0.02
        m.fit_bounds([[min(lats) - pad, min(lons) - pad],
                      [max(lats) + pad, max(lons) + pad]])
    return m
