"""Reconstrucción exploratoria de eventos observados MODIS/VIIRS.

1) Agrupamientos espaciales por día UTC (DBSCAN/Haversine).
2) Asociación entre días, según proximidad de detecciones y horas transcurridas.

No estima perímetros quemados, ignición real ni propagación física.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import cos, radians

import numpy as np
from sklearn.cluster import DBSCAN
from scipy.spatial import cKDTree, ConvexHull, QhullError

EARTH_RADIUS_M = 6_371_008.8


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, a: int, b: int) -> None:
        a, b = self.find(a), self.find(b)
        if a == b:
            return
        if self.rank[a] < self.rank[b]:
            a, b = b, a
        self.parent[b] = a
        if self.rank[a] == self.rank[b]:
            self.rank[a] += 1


def normalize_records(raw_records: list[dict]) -> list[dict]:
    """Adapta exactamente las columnas que entrega Fireprint Data API."""
    result = []
    for row in raw_records:
        when = datetime.fromisoformat(row['detected_at'].replace('Z', '+00:00'))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        when = when.astimezone(timezone.utc)
        lat, lon = float(row['latitude']), float(row['longitude'])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        result.append({
            'id': row['id'], 'detected_at': when, 'latitude': lat,
            'longitude': lon, 'sensor': row['sensor'], 'frp_mw': row.get('frp_mw'),
            'scan_km': row.get('scan_km'), 'track_km': row.get('track_km'),
            'day': when.date(),
        })
    result.sort(key=lambda x: (x['detected_at'], x['id']))
    return result


def _spatial_clusters(records: list[dict], eps_m: float, min_samples: int):
    """DBSCAN por día, con Haversine en metros, sin unir fechas todavía."""
    indices_by_day = defaultdict(list)
    for i, row in enumerate(records):
        indices_by_day[row['day']].append(i)

    cluster_members: list[np.ndarray] = []
    cluster_day = []
    cluster_for_record = np.full(len(records), -1, dtype=np.int32)
    for day, indices in sorted(indices_by_day.items()):
        coords = np.radians(np.array([[records[i]['latitude'], records[i]['longitude']] for i in indices]))
        labels = DBSCAN(
            eps=eps_m / EARTH_RADIUS_M,
            min_samples=min_samples,
            metric='haversine', algorithm='ball_tree'
        ).fit_predict(coords)
        for label in sorted(set(labels)):
            if label < 0:
                continue
            members = np.array([indices[j] for j in np.flatnonzero(labels == label)], dtype=np.int32)
            cluster_id = len(cluster_members)
            cluster_members.append(members)
            cluster_day.append(day)
            cluster_for_record[members] = cluster_id
    return cluster_members, cluster_day, cluster_for_record


def _xy_meters(records: list[dict]):
    """Proyección equirectangular local, solo para prefiltrado de pares cercanos.
    Se limita en la API el bbox del usuario para evitar distorsión a gran escala.
    """
    lat0 = float(np.mean([r['latitude'] for r in records]))
    coslat = max(cos(radians(lat0)), 0.01)
    return np.array([
        [r['longitude'] * 111_320 * coslat, r['latitude'] * 111_320]
        for r in records
    ], dtype=float)


def _link_temporally(records, clusters, cluster_days, tracking_distance_m, max_gap_hours):
    """Une clusters de días distintos si hay observaciones cercanas en espacio y tiempo.

    Compara el punto más cercano entre regiones y verifica la diferencia temporal
    del par; evita conectar clusters solo por cercanía de sus centroides.
    """
    uf = UnionFind(len(clusters))
    if not clusters:
        return uf
    coords = _xy_meters(records)
    by_day = defaultdict(list)
    bounds = []
    for cid, idx in enumerate(clusters):
        by_day[cluster_days[cid]].append(cid)
        xy = coords[idx]
        bounds.append((xy.min(axis=0), xy.max(axis=0)))

    days = sorted(by_day)
    max_day_diff = int(np.ceil(max_gap_hours / 24)) + 1
    for p, day1 in enumerate(days):
        for day2 in days[p + 1:]:
            if (day2 - day1).days > max_day_diff:
                break
            # En el caso de max_gap_hours <24, verificamos igualmente
            # la diferencia exacta de timestamps por cada par candidato.
            for cid1 in by_day[day1]:
                low1, high1 = bounds[cid1]
                for cid2 in by_day[day2]:
                    low2, high2 = bounds[cid2]
                    if np.any(low1 > high2 + tracking_distance_m) or np.any(low2 > high1 + tracking_distance_m):
                        continue
                    idx1, idx2 = clusters[cid1], clusters[cid2]
                    tree = cKDTree(coords[idx2])
                    neighborhoods = tree.query_ball_point(coords[idx1], r=tracking_distance_m)
                    linked = False
                    for a, b_candidates in zip(idx1, neighborhoods):
                        for bi in b_candidates:
                            b = idx2[bi]
                            gap = (records[int(b)]['detected_at'] - records[int(a)]['detected_at']).total_seconds()
                            if 0 < gap <= max_gap_hours * 3600:
                                # Verificación Haversine exacta para el par cercano.
                                phi1, phi2 = radians(records[int(a)]['latitude']), radians(records[int(b)]['latitude'])
                                dphi = phi2 - phi1
                                dlambda = radians(records[int(b)]['longitude'] - records[int(a)]['longitude'])
                                h = np.sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * np.sin(dlambda / 2) ** 2
                                dist = 2 * EARTH_RADIUS_M * np.arcsin(min(1, np.sqrt(h)))
                                if dist <= tracking_distance_m:
                                    uf.union(cid1, cid2)
                                    linked = True
                                    break
                        if linked:
                            break
    return uf


def event_statistics(event_id: str, rows: list[dict]) -> dict:
    stamps = [r['detected_at'] for r in rows]
    first, last = min(stamps), max(stamps)
    frps = [float(r['frp_mw']) for r in rows if r['frp_mw'] is not None]
    sensor_counts = {
        'MODIS': sum(r['sensor'] == 'MODIS' for r in rows),
        'VIIRS': sum(r['sensor'] == 'VIIRS' for r in rows),
    }
    return {
        'event_id': event_id,
        'first_detection': first.isoformat().replace('+00:00', 'Z'),
        'last_detection': last.isoformat().replace('+00:00', 'Z'),
        'observed_duration_hours': round((last - first).total_seconds() / 3600, 2),
        'active_days': len({r['day'] for r in rows}),
        'detections': len(rows),
        'sensors': sensor_counts,
        'center': {
            'latitude': round(float(np.mean([r['latitude'] for r in rows])), 6),
            'longitude': round(float(np.mean([r['longitude'] for r in rows])), 6),
        },
        'max_frp_mw': round(max(frps), 2) if frps else None,
    }


def reconstruct(raw_rows: list[dict], *, spatial_eps_m=1200., min_samples=1,
                tracking_distance_m=1500., max_gap_hours=48.):
    """Devuelve eventos, registros con event_id y número de detecciones excluidas.

    Los eventos son candidatos reconstruidos, NO incendios confirmados.
    """
    records = normalize_records(raw_rows)
    if not records:
        return [], [], 0
    clusters, days, cluster_ids = _spatial_clusters(records, spatial_eps_m, min_samples)
    uf = _link_temporally(records, clusters, days, tracking_distance_m, max_gap_hours)

    component_rows = defaultdict(list)
    excluded = 0
    for ridx, cid in enumerate(cluster_ids):
        if cid < 0:
            excluded += 1
            continue
        component_rows[uf.find(int(cid))].append(records[ridx])

    components = sorted(component_rows.values(), key=lambda rows: (
        rows[0]['detected_at'], str(rows[0]['id'])))
    events = []
    event_rows = []
    for event_number, rows in enumerate(components, start=1):
        eid = f'EVT-{event_number:05d}'
        events.append(event_statistics(eid, rows))
        for row in rows:
            event_rows.append({**row, 'event_id': eid})
    events.sort(key=lambda row: (-row['detections'], row['event_id']))
    return events, event_rows, excluded


def _observed_envelope(rows):
    """Envolvente convexa de centros detectados: NO representa área quemada."""
    xy = np.unique(np.array([[r['longitude'], r['latitude']] for r in rows]), axis=0)
    if len(xy) < 3:
        return None
    try:
        hull = ConvexHull(xy)
    except QhullError:
        return None
    polygon = xy[hull.vertices].tolist()
    polygon.append(polygon[0])
    return {'type': 'Polygon', 'coordinates': [polygon]}


def event_timeline(records: list[dict], event_id: str, max_points_per_frame: int = 3000):
    """Un frame por día calendario, incluso cuando no hubo detecciones."""
    event_rows = sorted((r for r in records if r['event_id'] == event_id),
                        key=lambda r: (r['detected_at'], r['id']))
    if not event_rows:
        return None
    by_date = defaultdict(list)
    for row in event_rows:
        by_date[row['day']].append(row)
    frames = []
    d = event_rows[0]['day']
    last = event_rows[-1]['day']
    accumulated = 0
    cumulative_rows = []
    while d <= last:
        actual = by_date[d]
        cumulative_rows.extend(actual)
        accumulated += len(actual)
        if len(actual) > max_points_per_frame:
            take = np.linspace(0, len(actual) - 1, max_points_per_frame, dtype=int)
            visible = [actual[i] for i in take]
        else:
            visible = actual
        frames.append({
            'date': d.isoformat(),
            'new_detections_count': len(actual),
            'cumulative_detections_count': accumulated,
            'displayed_detections_count': len(visible),
            'sampled': len(visible) < len(actual),
            'observed_envelope': _observed_envelope(cumulative_rows),
            'points': [
                {'id': r['id'], 'latitude': r['latitude'], 'longitude': r['longitude'],
                 'sensor': r['sensor'], 'frp_mw': r['frp_mw'],
                 'detected_at': r['detected_at'].isoformat().replace('+00:00', 'Z')}
                for r in visible
            ]
        })
        d += timedelta(days=1)
    return {'event_id': event_id, 'interval': 'day', 'frames': frames}


def historical_calendar(events: list[dict], records: list[dict]):
    """Eventos iniciados vs activos, contando actividad real por mes."""
    started = defaultdict(int)
    active = defaultdict(set)
    detections = defaultdict(int)
    for e in events:
        started[e['first_detection'][:7]] += 1
    for r in records:
        period = r['day'].strftime('%Y-%m')
        active[period].add(r['event_id'])
        detections[period] += 1
    periods = sorted(set(started) | set(active) | set(detections))
    return [{'period': p, 'events_started': started[p],
             'active_events': len(active[p]), 'detections': detections[p]}
            for p in periods]
