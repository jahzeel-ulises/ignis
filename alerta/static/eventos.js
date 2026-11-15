// IGNIS · Incendios reconstruidos.
// Usa el motor de clustering del equipo (DBSCAN por día + unión entre días) a través de /api/eventos/*
// y lo muestra con el lenguaje visual de IGNIS: lista animada, mapa y reproducción día por día.
(() => {
  const $ = s => document.querySelector(s), RM = WOW.RM;
  const COL = { MODIS: '#ffb020', VIIRS: '#ff5a1f', previo: '#8f8178' };
  const E = { job: null, eventos: [], sel: null, frames: [], dia: 0, play: null, vel: 1, bbox: null, modo: 'vista', dibujada: null, metrica: 'det', lineas: {} };
  const fmt = n => Math.round(n).toLocaleString('es-MX');
  const fecha = (d, op = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('es-MX', op);
  const espera = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------- mapa
  const mapa = L.map('mapa', { zoomControl: false }).setView([18.15, -100.75], 9);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  IG.tema(mapa, IG.mapaBase(mapa, 'Oscuro (Esri)'));
  const rend = L.canvas({ padding: .4 });
  const capaEventos = L.layerGroup().addTo(mapa), capaPrevios = L.layerGroup().addTo(mapa), capaHoy = L.layerGroup().addTo(mapa);
  let marco = null, analizada = null, envolvente = null;

  function area() {
    if (E.modo === 'dibujar' && E.dibujada) {
      const d = E.dibujada; return [d.getWest(), d.getSouth(), d.getEast(), d.getNorth()].map(v => +v.toFixed(4));
    }
    const b = mapa.getBounds(), dx = (b.getEast() - b.getWest()) * .06, dy = (b.getNorth() - b.getSouth()) * .06;
    let w = b.getWest() + dx, e = b.getEast() - dx, s = b.getSouth() + dy, n = b.getNorth() - dy;
    const cx = (w + e) / 2, cy = (s + n) / 2;   // el motor acepta hasta 15° por eje
    if (e - w > 14.9) { w = cx - 7.45; e = cx + 7.45; }
    if (n - s > 14.9) { s = cy - 7.45; n = cy + 7.45; }
    return [w, s, e, n].map(v => +v.toFixed(4));
  }
  function pintarMarco() {
    const [w, s, e, n] = area();
    if (marco) marco.setBounds([[s, w], [n, e]]);
    else marco = L.rectangle([[s, w], [n, e]], { color: '#ffb020', weight: 1.5, dashArray: '6 4', fill: false, interactive: false, className: 'ev-marco' }).addTo(mapa);
    const km = (e - w) * 111.32 * Math.cos((s + n) / 2 * Math.PI / 180), kmN = (n - s) * 110.57;
    $('#ev-area').textContent = `Área: ${(e - w).toFixed(2)}° × ${(n - s).toFixed(2)}° · ≈ ${fmt(km)} × ${fmt(kmN)} km`;
  }
  mapa.on('moveend', () => { if (E.modo === 'vista') pintarMarco(); }); pintarMarco();

  // ---------------------------------------------------------------- segmentos: lo visible o dibujar el área
  function modo(m) {
    E.modo = m;
    document.querySelectorAll('#ev-modos button').forEach(b => { b.classList.toggle('sel', b.dataset.modo === m); b.setAttribute('aria-selected', b.dataset.modo === m); });
    $('#ev-ayuda').textContent = m === 'vista' ? 'Mueve y acerca el mapa: se analiza el recuadro punteado.' : 'Arrastra sobre el mapa para dibujar el área. Esc cancela.';
    if (m === 'vista') { E.dibujada = null; pintarMarco(); }
  }
  $('#ev-modos').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    modo(b.dataset.modo);
    if (b.dataset.modo !== 'dibujar') return;
    if (innerWidth < 900) scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
    if (marco) { mapa.removeLayer(marco); marco = null; }
    const d = await IG.dibujarArea(mapa);
    if (!d) { modo('vista'); return; }
    E.dibujada = d;
    marco = L.rectangle(d, { color: '#ffb020', weight: 2, dashArray: '6 4', fillColor: '#ffb020', fillOpacity: .06, interactive: false, className: 'ev-marco' }).addTo(mapa);
    const [w, s, e2, n] = area();
    $('#ev-area').textContent = `Área dibujada: ${(e2 - w).toFixed(2)}° × ${(n - s).toFixed(2)}° · ≈ ${fmt((e2 - w) * 111.32 * Math.cos((s + n) / 2 * Math.PI / 180))} × ${fmt((n - s) * 110.57)} km`;
    $('#ev-ayuda').innerHTML = 'Área lista. <button type="button" class="ex-link" id="ev-redibujar">Dibujar otra</button>';
    $('#ev-redibujar').onclick = () => $('#ev-modos button[data-modo=dibujar]').click();
    mapa.fitBounds(d, { padding: [30, 30], maxZoom: 12 });
  };

  // ---------------------------------------------------------------- ejemplos rápidos
  const PRESETS = [
    { t: 'Tierra Caliente · abr 2024', c: [18.15, -100.75], z: 9, d: ['2024-04-01', '2024-04-30'] },
    { t: 'Chimalapas · may 2024', c: [16.95, -94.25], z: 9, d: ['2024-04-20', '2024-05-31'] },
    { t: 'Calakmul · abr 2019', c: [18.25, -89.85], z: 9, d: ['2019-04-01', '2019-05-15'] },
    { t: 'Sierra Madre Occ. · may 2021', c: [24.4, -105.6], z: 9, d: ['2021-05-01', '2021-05-31'] },
  ];
  $('#presets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}">${p.t}</button>`).join('');
  $('#presets').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = PRESETS[+b.dataset.i];
    document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('sel', x === b));
    $('#ev-desde').value = p.d[0]; $('#ev-hasta').value = p.d[1];
    mapa.flyTo(p.c, p.z, { duration: RM ? 0 : 1.2 });
  };

  // ---------------------------------------------------------------- estado del servicio
  async function estadoServicio() {
    try {
      const s = await (await fetch('/api/eventos/estado')).json();
      $('#lab').href = s.laboratorio || '/laboratorio/';
      const el = $('#servicio'), txt = $('#servicio-txt');
      if (!s.disponible) {
        el.className = 'ev-servicio mal'; txt.textContent = s.motivo || 'Motor de eventos no disponible';
        $('#btn-reconstruir').disabled = true;
        $('#ev-error').textContent = 'Este servidor no tiene activo el motor de eventos. Con Docker Compose se levanta junto con IGNIS.';
        return;
      }
      el.className = 'ev-servicio ok';
      txt.textContent = s.detecciones != null
        ? `${fmt(s.detecciones)} detecciones en la base · ${s.periodo ? s.periodo[0].slice(0, 4) + '–' + s.periodo[1].slice(0, 4) : ''}${s.ingesta_en_curso ? ' · cargando más…' : ''}`
        : 'Motor de eventos en línea';
      if (s.periodo) { $('#ev-desde').min = $('#ev-hasta').min = s.periodo[0].slice(0, 10); $('#ev-desde').max = $('#ev-hasta').max = s.periodo[1].slice(0, 10); }
      if (s.ingesta_en_curso) setTimeout(estadoServicio, 15000);
    } catch (e) {
      $('#servicio').className = 'ev-servicio mal'; $('#servicio-txt').textContent = 'Sin conexión con el servidor';
    }
  }
  estadoServicio();

  // ---------------------------------------------------------------- reconstrucción
  const etapas = [...document.querySelectorAll('.ev-etapas li')];
  function etapa(k) { etapas.forEach((li, j) => { li.classList.toggle('ok', j < k); li.classList.toggle('va', j === k); }); }
  const mensaje = d => typeof d === 'string' ? d : Array.isArray(d) ? (d[0]?.msg || 'Datos no válidos').replace(/^Value error, /, '') : (d?.error || d?.detail || 'Error inesperado');

  $('#btn-reconstruir').onclick = async () => {
    const desde = $('#ev-desde').value, hasta = $('#ev-hasta').value;
    $('#ev-error').textContent = '';
    if (!desde || !hasta || hasta < desde) { $('#ev-error').textContent = 'Revisa las fechas: "Hasta" debe ser igual o posterior a "Desde".'; return; }
    const fin = new Date(hasta + 'T00:00:00Z'); fin.setUTCDate(fin.getUTCDate() + 1);
    E.bbox = area();
    const cuerpo = { start: desde + 'T00:00:00Z', end: fin.toISOString().replace('.000', ''), bbox: E.bbox, sensor: $('#ev-sensor').value, type_code: '0',
      parameters: { spatial_eps_m: +$('#p-eps').value, tracking_distance_m: +$('#p-dist').value, max_gap_hours: +$('#p-gap').value, min_samples: +$('#p-min').value } };
    cerrarRepro(); capaEventos.clearLayers();
    $('#paso-res').classList.add('oculto'); $('#carga').classList.remove('oculto'); $('#btn-reconstruir').disabled = true; etapa(0);
    if (analizada) mapa.removeLayer(analizada);
    analizada = L.rectangle([[E.bbox[1], E.bbox[0]], [E.bbox[3], E.bbox[2]]], { color: '#ff6a2b', weight: 1, fillOpacity: .04, interactive: false }).addTo(mapa);
    const t0 = performance.now();
    const pasoVisual = setInterval(() => etapa(Math.min(2, Math.floor((performance.now() - t0) / 2200))), 400);
    try {
      const r = await fetch('/api/eventos/reconstrucciones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json(); if (!r.ok) throw new Error(mensaje(j.detail ?? j));
      E.job = j.job_id;
      let st = j;
      for (let k = 0; k < 400 && ['queued', 'running'].includes(st.status); k++) {
        await espera(900);
        st = await (await fetch(`/api/eventos/reconstrucciones/${E.job}`)).json();
      }
      if (st.status !== 'completed') throw new Error(st.error || 'La reconstrucción tardó demasiado. Prueba un área o periodo más pequeño.');
      const [ev, cal] = await Promise.all([
        fetch(`/api/eventos/reconstrucciones/${E.job}/eventos?min_detections=${$('#ev-min').value}`).then(r => r.json()),
        fetch(`/api/eventos/reconstrucciones/${E.job}/calendario`).then(r => r.json()),
      ]);
      clearInterval(pasoVisual); etapa(3); await espera(RM ? 0 : 350);
      mostrar(st, ev.events || [], cal.periods || []);
    } catch (err) {
      clearInterval(pasoVisual);
      $('#ev-error').textContent = err.message;
      $('#paso-area').classList.remove('sacude'); void $('#paso-area').offsetWidth; $('#paso-area').classList.add('sacude');
    } finally {
      $('#carga').classList.add('oculto'); $('#btn-reconstruir').disabled = false;
    }
  };

  function mostrar(st, eventos, cal) {
    E.eventos = eventos;
    $('#paso-res').classList.remove('oculto');
    WOW.correr($('#r-det'), st.detection_count || 0); WOW.correr($('#r-ev'), st.event_count || 0);
    // actividad mensual
    const max = Math.max(1, ...cal.map(p => p.active_events));
    $('#r-meses').innerHTML = cal.length ? cal.map((p, k) => `<i style="--k:${k};height:${Math.max(4, 100 * p.active_events / max)}%" title="${p.period}: ${p.active_events} incendios activos, ${fmt(p.detections)} detecciones">${cal.length <= 8 || k % Math.ceil(cal.length / 6) === 0 ? `<span>${p.period.slice(2).replace('-', '/')}</span>` : ''}</i>`).join('')
      : '<p class="nota">Sin actividad</p>';
    $('#r-vis').textContent = eventos.length ? `${fmt(eventos.length)} con el filtro elegido` : '';
    if (!eventos.length) {
      $('#r-lista').innerHTML = `<div class="ev-vacio">${st.detection_count ? 'Ningún incendio pasa el filtro. Baja el mínimo de detecciones.' : 'No hay detecciones en esta área y periodo. Prueba otras fechas, un área más grande o uno de los ejemplos.'}</div>`;
      return;
    }
    const top = eventos.slice(0, 40);
    $('#r-lista').innerHTML = top.map((e, k) => {
      const m = e.sensors.MODIS || 0, v = e.sensors.VIIRS || 0, t = Math.max(1, m + v);
      return `<button class="ev-card" data-id="${e.event_id}" style="--k:${k}">
        <span class="ev-rank">#${k + 1}</span>
        <span><b>${fecha(e.first_detection.slice(0, 10), { day: 'numeric', month: 'short' })} → ${fecha(e.last_detection.slice(0, 10))}</b>
        <small>${e.active_days} ${e.active_days === 1 ? 'día' : 'días'} con fuego${e.max_frp_mw ? ` · FRP máx ${fmt(e.max_frp_mw)} MW` : ''}</small></span>
        <span class="ev-num"><b>${fmt(e.detections)}</b><small>detecciones</small></span>
        <span class="ev-sensores" aria-hidden="true"><i class="m" style="width:${100 * m / t}%"></i><i class="v" style="width:${100 * v / t}%"></i></span></button>`;
    }).join('');
    // marcadores: tamaño por detecciones, aparecen escalonados
    const maxDet = Math.max(...top.map(e => e.detections));
    top.slice().reverse().forEach((e, k) => setTimeout(() => {
      const m = L.circleMarker([e.center.latitude, e.center.longitude], {
        radius: 5 + 17 * Math.sqrt(e.detections / maxDet), color: '#fff3c4', weight: 1.5, fillColor: '#ff6a2b', fillOpacity: .75, className: 'ev-punto-nuevo',
      }).bindTooltip(`<b>${fmt(e.detections)} detecciones</b><br>${fecha(e.first_detection.slice(0, 10))} · ${e.active_days} días`).addTo(capaEventos);
      m.on('click', () => elegir(e.event_id)); m._evId = e.event_id;
    }, RM ? 0 : k * 30));
    $('#paso-res').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
    if (innerWidth >= 900) setTimeout(() => elegir(top[0].event_id), RM ? 0 : 900);
  }
  $('#r-lista').onclick = e => { const c = e.target.closest('.ev-card'); if (c) elegir(c.dataset.id); };

  // ---------------------------------------------------------------- reproducción día por día
  async function elegir(id) {
    pausa();
    E.sel = E.eventos.find(e => e.event_id === id); if (!E.sel) return;
    document.querySelectorAll('.ev-card').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
    capaEventos.eachLayer(m => m.setStyle({ fillOpacity: m._evId === id ? 0 : .35, opacity: m._evId === id ? 0 : .5 }));
    let t;
    try { t = await (await fetch(`/api/eventos/reconstrucciones/${E.job}/eventos/${id}/linea`)).json(); }
    catch (err) { IG.toast('No se pudo cargar la evolución del incendio', 'aviso'); return; }
    E.frames = t.frames || []; if (!E.frames.length) return;
    E.frames.forEach(f => { f.frp = f.points.reduce((a, p) => a + (p.frp_mw || 0), 0); });
    E.lineas[id] = E.frames;
    const pts = E.frames.flatMap(f => f.points);
    const b = L.latLngBounds(pts.map(p => [p.latitude, p.longitude])).pad(.35);
    const abajo = innerWidth < 900 ? 150 : 230;
    mapa.flyToBounds(b, { paddingTopLeft: [30, 30], paddingBottomRight: [30, abajo], duration: RM ? 0 : 1.2, maxZoom: 13 });
    $('#repro').classList.remove('oculto');
    $('#rp-id').textContent = `${fmt(E.sel.detections)} detecciones · ${E.sel.active_days} días con fuego · ${E.frames.length} días en total`;
    $('#rp-dia').max = E.frames.length - 1;
    chispa();
    ir(0, true);
    if (!RM) setTimeout(reproducir, 1300);
  }
  function ir(k, reconstruir = false) {
    const ant = E.dia; E.dia = k; $('#rp-dia').value = k;
    if (reconstruir || k !== ant + 1) {   // salto: se redibuja todo hasta el día k
      capaPrevios.clearLayers(); capaHoy.clearLayers();
      E.frames.slice(0, k).forEach(f => f.points.forEach(p => previo(p)));
    } else {                               // avance normal: lo de ayer se apaga a brasa
      capaHoy.eachLayer(m => m._p && previo(m._p)); capaHoy.clearLayers();
    }
    const f = E.frames[k];
    f.points.forEach(p => {
      const c = COL[p.sensor] || COL.VIIRS;
      L.circleMarker([p.latitude, p.longitude], { renderer: rend, radius: 9, stroke: false, fillColor: c, fillOpacity: .18, interactive: false }).addTo(capaHoy);
      const m = L.circleMarker([p.latitude, p.longitude], { radius: 4.5, color: '#fff6ef', weight: 1, fillColor: c, fillOpacity: 1, className: 'ev-punto-nuevo' })
        .bindTooltip(`${p.sensor} · ${p.detected_at.slice(11, 16)} UTC${p.frp_mw != null ? ` · ${p.frp_mw} MW` : ''}`);
      m._p = p; m.addTo(capaHoy);
    });
    if (envolvente) mapa.removeLayer(envolvente);
    envolvente = f.observed_envelope ? L.geoJSON(f.observed_envelope, { style: { color: '#ff3b30', weight: 2, fillColor: '#ff3b30', fillOpacity: .06, className: 'ev-env' }, interactive: false }).addTo(mapa) : null;
    $('#rp-fecha').textContent = fecha(f.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    $('#rp-nuevas').textContent = fmt(f.new_detections_count);
    $('#rp-acum').textContent = fmt(f.cumulative_detections_count);
    $('#rp-frp').textContent = fmt(f.frp);
    if (f.new_detections_count) WOW.bump($('#rp-nuevas'));
    chispa();
  }
  function previo(p) {
    L.circleMarker([p.latitude, p.longitude], { renderer: rend, radius: 2.6, stroke: false, fillColor: COL.previo, fillOpacity: .45, interactive: false }).addTo(capaPrevios);
  }
  function chispa() {
    const cv = $('#rp-chispa'), dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const val = f => E.metrica === 'frp' ? f.frp : f.new_detections_count;
    const n = E.frames.length, max = Math.max(1, ...E.frames.map(val)), bw = w / n, base = E.metrica === 'frp' ? '#ff5a1f' : '#e8561f';
    E.frames.forEach((f, k) => {
      const v = val(f), bh = v ? Math.max(2, (h - 4) * Math.sqrt(v / max)) : 1;
      c.fillStyle = k === E.dia ? '#ffd27a' : k < E.dia ? base : base + '55';
      c.beginPath(); c.roundRect(k * bw + Math.min(1, bw * .15), h - bh, Math.max(1, bw - Math.min(2, bw * .3)), bh, 2); c.fill();
    });
    c.fillStyle = '#fff6ef'; c.fillRect((E.dia + .5) * bw - 1, 0, 2, h);
  }
  $('#rp-chispa').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); pausa(); ir(Math.min(E.frames.length - 1, Math.floor((e.clientX - r.left) / r.width * E.frames.length))); };
  $('#rp-dia').oninput = e => { pausa(); ir(+e.target.value); };
  $('#rp-metrica').onclick = e => { const b = e.target.closest('button'); if (!b) return; E.metrica = b.dataset.m;
    document.querySelectorAll('#rp-metrica button').forEach(x => x.classList.toggle('sel', x === b)); chispa(); };
  // pasar el cursor sobre la gráfica diaria muestra el día
  $('#rp-chispa').onpointermove = e => {
    if (!E.frames.length) return;
    const r = e.currentTarget.getBoundingClientRect(), k = Math.min(E.frames.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * E.frames.length))), f = E.frames[k];
    IG.graf.tip(`<b>${fecha(f.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b><span><i style="background:#e8561f"></i>${fmt(f.new_detections_count)} detecciones nuevas</span><span><i style="background:#ff5a1f"></i>${fmt(f.frp)} MW de intensidad</span><span class="tenue">toca para ir a este día</span>`, e.clientX, e.clientY);
  };
  $('#rp-chispa').onpointerleave = () => IG.graf.tip(null);
  // pasar el cursor sobre un incendio de la lista: mini gráfica de su evolución
  const miniDias = fr => {
    const W = 200, H = 50, n = fr.length, bw = W / n, md = Math.max(1, ...fr.map(f => f.new_detections_count)), mf = Math.max(1, ...fr.map(f => f.frp));
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${fr.map((f, i) => `<rect x="${(i * bw + .5).toFixed(1)}" y="${(H - 4 - (H - 8) * f.new_detections_count / md).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${((H - 8) * f.new_detections_count / md).toFixed(1)}" fill="#ffb020" opacity=".6"/>`).join('')}<polyline points="${fr.map((f, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - 4 - (H - 8) * f.frp / mf).toFixed(1)}`).join(' ')}" fill="none" stroke="#ff5a1f" stroke-width="2"/></svg><span class="mini-ley"><i style="background:#ffb020"></i>detecciones <i style="background:#ff5a1f"></i>intensidad FRP</span>`;
  };
  $('#r-lista').addEventListener('pointerover', async e => {
    const c = e.target.closest('.ev-card'); if (!c || e.pointerType === 'touch' || c._tip) return;
    c._tip = true;
    const ev = E.eventos.find(x => x.event_id === c.dataset.id);
    const mostrar = fr => { if (c.matches(':hover')) { const r = c.getBoundingClientRect(); IG.graf.tip(`<b>${fmt(ev.detections)} detecciones · ${ev.active_days} días</b>${miniDias(fr)}<span class="tenue">FRP máx. de una detección: ${fmt(ev.max_frp_mw)} MW</span>`, r.right, r.top + 20); } };
    if (E.lineas[ev.event_id]) mostrar(E.lineas[ev.event_id]);
    else fetch(`/api/eventos/reconstrucciones/${E.job}/eventos/${ev.event_id}/linea`).then(r => r.json()).then(t => {
      const fr = t.frames || []; fr.forEach(f => { f.frp = f.points.reduce((a, p) => a + (p.frp_mw || 0), 0); }); E.lineas[ev.event_id] = fr; mostrar(fr);
    }).catch(() => {});
  });
  $('#r-lista').addEventListener('pointerout', e => { const c = e.target.closest('.ev-card'); if (c && !c.contains(e.relatedTarget)) { c._tip = false; IG.graf.tip(null); } });
  function reproducir() {
    if (!E.frames.length) return;
    if (E.dia >= E.frames.length - 1) ir(0, true);
    $('#rp-play').textContent = '❚❚'; $('#rp-play').setAttribute('aria-label', 'Pausar');
    clearInterval(E.play);
    E.play = setInterval(() => { if (E.dia >= E.frames.length - 1) return pausa(); ir(E.dia + 1); }, 800 / E.vel);
  }
  function pausa() { clearInterval(E.play); E.play = null; $('#rp-play').textContent = '▶'; $('#rp-play').setAttribute('aria-label', 'Reproducir'); }
  $('#rp-play').onclick = () => E.play ? pausa() : reproducir();
  $('#rp-vel').onclick = () => { E.vel = E.vel === 1 ? 2 : E.vel === 2 ? 4 : 1; $('#rp-vel').textContent = E.vel + '×'; if (E.play) reproducir(); };
  function cerrarRepro() {
    pausa(); $('#repro').classList.add('oculto'); capaPrevios.clearLayers(); capaHoy.clearLayers();
    if (envolvente) { mapa.removeLayer(envolvente); envolvente = null; }
    capaEventos.eachLayer(m => m.setStyle({ fillOpacity: .75, opacity: 1 }));
    document.querySelectorAll('.ev-card').forEach(c => c.classList.remove('sel'));
  }
  $('#rp-cerrar').onclick = cerrarRepro;
  addEventListener('keydown', e => {
    if (!E.frames.length || $('#repro').classList.contains('oculto') || e.target.matches('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); E.play ? pausa() : reproducir(); }
    if (e.key === 'ArrowRight') { pausa(); ir(Math.min(E.frames.length - 1, E.dia + 1)); }
    if (e.key === 'ArrowLeft') { pausa(); ir(Math.max(0, E.dia - 1), true); }
  });
  addEventListener('resize', () => { if (E.frames.length) chispa(); });
  window.addEventListener('ignis-tema', () => { if (E.frames.length) chispa(); });
  WOW.revelar($('.ev-panel h1'));
})();
