"""IGNIS · Plan de control de incendios (orientativo) para personal especializado.

Cuando el centro de control lanza un incendio, se propone un plan de ataque inicial al estilo del
Sistema de Comando de Incidentes (SCI): sectores, brecha cortafuego con maquinaria (como cuando se ara
la tierra con tractor para que el fuego no pase), ataque directo por flancos desde un punto de anclaje,
contrafuego y apoyo aéreo cuando aplica, zona segura y rutas de escape (LACES), recursos y asignación
de cada brigadista conectado a un sector.

Todos los valores son orientativos para simulación y entrenamiento; no sustituyen el juicio del
comandante del incidente ni un modelo operativo de comportamiento del fuego.
"""
import math

RENDIMIENTO_KMH = {'tractor': 1.2, 'brigada': 0.35}   # km de línea construida por hora (orientativo)
DESPLIEGUE_MIN = 45                                    # llegada y despliegue de los recursos
SECTORES = ['brecha', 'flanco_izq', 'flanco_der', 'anclaje', 'vigia']


def mover(lat, lon, rumbo, km):
    return [lat + km * math.cos(math.radians(rumbo)) / 110.57,
            lon + km * math.sin(math.radians(rumbo)) / (111.32 * math.cos(math.radians(lat)))]


def dist(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def rumbo(a, b):
    y = math.sin(math.radians(b[1] - a[1])) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(math.radians(b[1] - a[1]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def largo(puntos):
    return sum(dist(puntos[i], puntos[i + 1]) for i in range(len(puntos) - 1))


def generar(f, frp_tipico=None):
    """Plan inicial a partir del incendio (posición, rumbo, velocidad, viento, pendiente) e intensidad típica."""
    lat, lon, r = f['lat'], f['lon'], f['prop']['rumbo']
    v_cabeza = max(.3, f['prop']['vel_kmh'] * 1.5)          # la cabeza avanza más rápido que el centro
    ctx = f.get('ctx') or {}
    viento, pendiente = ctx.get('viento_kmh') or 0, ctx.get('pendiente_pct') or 0
    frente = max(.2, f.get('frente_km', .2))

    # nivel del incidente (1 local, 2 regional, 3 mayor)
    puntaje = v_cabeza + pendiente / 25 + f.get('radio_km', 10) / 20 + ((frp_tipico or 0) > 500) + ((frp_tipico or 0) > 3000)
    nivel = 1 if puntaje < 2.2 else 2 if puntaje < 3.6 else 3

    # brecha cortafuego: perpendicular al avance, donde se alcance a terminar antes de que llegue la cabeza
    ancho = round(max(1.2, 2 * math.tan(math.radians(32)) * (frente + v_cabeza * 2)), 2)
    tractores = {1: 1, 2: 2, 3: 3}[nivel]
    construccion_min = round(ancho / (RENDIMIENTO_KMH['tractor'] * tractores) * 60)
    d_brecha = round(frente + v_cabeza * (DESPLIEGUE_MIN + construccion_min) / 60 + .6, 2)
    centro_b = mover(lat, lon, r, d_brecha)
    brecha = [mover(*centro_b, r - 90, ancho / 2), mover(*centro_b, r + 90, ancho / 2)]
    llegada_min = round((d_brecha - frente) / v_cabeza * 60)
    margen_min = llegada_min - (DESPLIEGUE_MIN + construccion_min)

    # anclaje en la cola y flancos hasta los extremos de la brecha
    anclaje = mover(lat, lon, r + 180, .35)
    flanco_izq = [anclaje, mover(lat, lon, r - 70, frente * .9 + .3), mover(lat, lon, r - 35, d_brecha * .55), brecha[0]]
    flanco_der = [anclaje, mover(lat, lon, r + 70, frente * .9 + .3), mover(lat, lon, r + 35, d_brecha * .55), brecha[1]]
    flanco_min = round(largo(flanco_izq) / RENDIMIENTO_KMH['brigada'] * 60)

    # contrafuego desde la brecha hacia el fuego: solo con viento moderado y estable
    contrafuego_apto = viento <= 20
    contrafuego = [mover(*brecha[0], r + 180, .12), mover(*brecha[1], r + 180, .12)]
    aereo_apto = v_cabeza > 1.6 or pendiente > 30 or nivel == 3
    zona = mover(lat, lon, r + 180, max(1.5, frente + 1.2))
    rutas = [[flanco_izq[1], zona], [flanco_der[1], zona], [brecha[0], mover(*brecha[0], r - 90, .8)], [brecha[1], mover(*brecha[1], r + 90, .8)]]

    fin_brecha = DESPLIEGUE_MIN + construccion_min
    tacticas = [
        {'id': 'reconocimiento', 'nombre': 'Reconocimiento y LACES', 'tipo': 'seguridad', 'recurso': 'Jefe de brigada',
         'desc': 'Vigía, comunicaciones, rutas de escape y zona segura definidas antes de entrar.', 'inicio': 0, 'fin': 15},
        {'id': 'anclaje', 'nombre': 'Punto de anclaje en la cola', 'tipo': 'manual', 'recurso': '1 brigada',
         'desc': 'Asegurar la cola (zona ya quemada o sin combustible) para que el ataque no quede rodeado.', 'inicio': 15, 'fin': DESPLIEGUE_MIN},
        {'id': 'brecha', 'nombre': 'Brecha cortafuego con maquinaria', 'tipo': 'maquinaria', 'recurso': f'{tractores} tractor{"es" if tractores > 1 else ""} con arado o rastra',
         'desc': f'Abrir una franja de suelo mineral de {ancho:.1f} km frente a la cabeza, a {d_brecha:.1f} km del foco: el fuego se detiene al no encontrar combustible.',
         'inicio': DESPLIEGUE_MIN, 'fin': fin_brecha},
        {'id': 'flanco_izq', 'nombre': 'Ataque directo · flanco izquierdo', 'tipo': 'manual', 'recurso': 'Brigada con herramienta manual y bombas de mochila',
         'desc': 'Línea de control pegada al borde del fuego, desde el anclaje hacia la cabeza.', 'inicio': DESPLIEGUE_MIN, 'fin': DESPLIEGUE_MIN + flanco_min},
        {'id': 'flanco_der', 'nombre': 'Ataque directo · flanco derecho', 'tipo': 'manual', 'recurso': 'Brigada con herramienta manual y bombas de mochila',
         'desc': 'Línea de control pegada al borde del fuego, desde el anclaje hacia la cabeza.', 'inicio': DESPLIEGUE_MIN, 'fin': DESPLIEGUE_MIN + flanco_min},
    ]
    if aereo_apto:
        tacticas.append({'id': 'aereo', 'nombre': 'Apoyo aéreo sobre la cabeza', 'tipo': 'aereo', 'recurso': 'Helicóptero con helibalde',
                         'desc': 'Descargas de agua para bajar la intensidad de la cabeza mientras se termina la brecha.', 'inicio': 30, 'fin': fin_brecha + 30})
    if contrafuego_apto:
        tacticas.append({'id': 'contrafuego', 'nombre': 'Quema de ensanche (contrafuego)', 'tipo': 'fuego', 'recurso': 'Personal certificado',
                         'desc': 'Desde la brecha hacia el fuego, para ensancharla. Solo con viento estable y mando de incidente.', 'inicio': fin_brecha, 'fin': fin_brecha + 30})
    recursos = [{'tipo': 'Brigadas terrestres', 'cantidad': {1: 2, 2: 4, 3: 6}[nivel]},
                {'tipo': 'Tractores (arado / rastra)', 'cantidad': tractores},
                {'tipo': 'Motobombas', 'cantidad': {1: 0, 2: 1, 3: 2}[nivel]},
                {'tipo': 'Helicóptero', 'cantidad': 1 if aereo_apto else 0}]
    plan = {
        'version': 1, 'nivel': nivel, 'nivel_txt': {1: 'Nivel 1 · local', 2: 'Nivel 2 · regional', 3: 'Nivel 3 · mayor'}[nivel],
        'brecha': {'puntos': brecha, 'largo_km': ancho, 'dist_km': d_brecha, 'construccion_min': construccion_min,
                   'llegada_fuego_min': llegada_min, 'margen_min': margen_min, 'a_tiempo': margen_min >= 0},
        'flancos': {'izq': flanco_izq, 'der': flanco_der}, 'anclaje': anclaje,
        'contrafuego': {'apto': contrafuego_apto, 'puntos': contrafuego, 'motivo': 'viento estable' if contrafuego_apto else f'viento de {viento:.0f} km/h: no recomendado'},
        'aereo': {'apto': aereo_apto, 'punto': mover(lat, lon, r, frente)},
        'zona_segura': {'punto': zona, 'radio_m': 350, 'rutas': rutas},
        'tacticas': tacticas, 'recursos': recursos, 'frp_tipico': frp_tipico,
        'contenido': False, 'estado': 'en curso', 'asignaciones': [],
    }
    actualizar(plan, f)
    return plan


def actualizar(plan, f):
    """Avance de cada táctica según el tiempo simulado y si la cabeza ya llegó a la brecha."""
    t = f.get('avance_min', 0)
    for k in plan['tacticas']:
        k['progreso'] = round(max(0.0, min(1.0, (t - k['inicio']) / max(1, k['fin'] - k['inicio']))), 2)
    r = f['prop']['rumbo']
    cabeza = mover(f['lat'], f['lon'], r, f.get('frente_km', .2))
    b = plan['brecha']['puntos']
    centro = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
    # distancia de la cabeza a la brecha medida en la dirección del avance
    faltan = dist(cabeza, centro) * math.cos(math.radians(rumbo(cabeza, centro) - r))
    plan['brecha']['faltan_km'] = round(faltan, 2)
    brecha_lista = next(k for k in plan['tacticas'] if k['id'] == 'brecha')['progreso'] >= 1
    if faltan <= .15:
        if brecha_lista:
            plan['contenido'], plan['estado'] = True, 'contenido'
        else:
            plan['estado'] = 'cruzó la brecha'
    else:
        plan['estado'] = 'en riesgo' if plan['brecha']['margen_min'] < 0 and not brecha_lista else 'en curso'
    return plan


def asignar(plan, brigadistas):
    """Reparte a los brigadistas conectados por sectores, empezando por la brecha y los flancos.
    brigadistas: lista de dicts con id, name, lat, lon."""
    puntos = {'brecha': plan['brecha']['puntos'][0], 'flanco_izq': plan['flancos']['izq'][0], 'flanco_der': plan['flancos']['der'][0],
              'anclaje': plan['anclaje'], 'vigia': plan['zona_segura']['punto']}
    nombres = {'brecha': 'Brecha cortafuego (maquinaria)', 'flanco_izq': 'Flanco izquierdo', 'flanco_der': 'Flanco derecho',
               'anclaje': 'Punto de anclaje', 'vigia': 'Vigía y zona segura'}
    tareas = {k['id']: k for k in plan['tacticas']}
    # por rondas: cada sector, en orden de prioridad, recibe al brigadista libre más cercano
    pendientes, orden = list(brigadistas), []
    while pendientes:
        for s in SECTORES:
            if not pendientes:
                break
            b = min(pendientes, key=lambda x: dist([x['lat'], x['lon']], puntos[s]) if x.get('lat') is not None else 1e9)
            pendientes.remove(b); orden.append((b, s))
    salida = []
    for b, s in orden:
        t = tareas.get(s) or tareas['reconocimiento']
        d = dist([b['lat'], b['lon']], puntos[s]) if b.get('lat') is not None else None
        salida.append({'id': b['id'], 'nombre': b['name'], 'sector': s, 'sector_txt': nombres[s], 'punto': puntos[s],
                       'tarea': t['desc'] if s != 'vigia' else 'Vigilar el comportamiento del fuego, mantener comunicación y la ruta a la zona segura.',
                       'recurso': t['recurso'] if s != 'vigia' else 'Radio y binoculares',
                       'dist_km': round(d, 1) if d is not None else None,
                       'rumbo': round(rumbo([b['lat'], b['lon']], puntos[s])) if d is not None else None,
                       'inicio': t['inicio'], 'fin': t['fin']})
    plan['asignaciones'] = [{k: a[k] for k in ('id', 'nombre', 'sector', 'sector_txt')} for a in salida]
    return salida
