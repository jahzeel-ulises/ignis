// Explorador: línea de tiempo del mapa, selección del área (vista, dibujo o coordenadas) y análisis
// del área en orden de lectura: anomalía → intensidad FRP → calendario → años (rango arrastrable) → datos → descargas.
(() => {
  const $ = s => document.querySelector(s);
  const G = IG.graf, fmt = G.fmt, MES = IG.MESES, MES_L = IG.MESES_L;
  const E = { meses: [], i: 0, play: null, capa: null, cache: {}, celdas: {}, ultimo: [2026, 11], modo: 'vista', dibujada: null, marcoDib: null,
    area: null, res: null, frp: null, vistaFrp: 'clima', vistaCal: 'ev' };
  const RAMPA = ['#fde3cf', '#fdbf8f', '#fd9a5b', '#f26b2a', '#d4471a', '#a5310f', '#6f1f08'];
  const color = (v, max) => RAMPA[Math.min(6, Math.floor(Math.log(1 + v) / Math.log(1 + max) * 7))];
  const mesCorto = (y, m) => `${MES[m - 1].toLowerCase()} ${String(y).slice(2)}`;
  const cap = t => t[0].toUpperCase() + t.slice(1);

  // ---------------------------------------------------------------- pestañas y hoja
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('sel', x === b));
    const ex = b.dataset.tab === 'explorar';
    $('#tab-zona').classList.toggle('oculto', ex); $('#tab-explorar').classList.toggle('oculto', !ex);
    if (ex) { iniciar(); E.capa && E.capa.addTo(mapa); } else { pausa(); E.capa && mapa.removeLayer(E.capa); }
  });
  $('.asa').onclick = () => $('#hoja').classList.toggle('plegada');

  async function iniciar() {
    if (E.meses.length) return;
    const info = await (await fetch('/api/info')).json();
    if (info.ultimo) E.ultimo = info.ultimo; E.hot = info.hotspots;
    for (let y = 2002; y <= E.ultimo[0]; y++) for (let m = 1; m <= 12; m++) if ((y > 2002 || m >= 7) && (y < E.ultimo[0] || m <= E.ultimo[1])) E.meses.push([y, m]);
    const r = $('#tl-rango'); r.max = E.meses.length - 1;
    E.i = E.meses.findIndex(([y, m]) => y === 2019 && m === 5); r.value = E.i;
    r.oninput = () => { pausa(); E.i = +r.value; pintar(); };
    for (let y = 2002; y <= E.ultimo[0]; y++) { $('#ex-desde').add(new Option(y, y)); $('#ex-hasta').add(new Option(y, y)); }
    $('#ex-desde').value = 2002; $('#ex-hasta').value = E.ultimo[0];
    $('#ex-mesc').options[0].text = `El más reciente (${MES_L[E.ultimo[1] - 1]} ${E.ultimo[0]})`;
    E.capa = L.layerGroup().addTo(mapa); E.rend = L.canvas({ padding: .3 });
    pintar();
  }

  // ---------------------------------------------------------------- capa del mapa con gráfica al pasar el cursor
  async function datos(y, m) {
    const k = y * 100 + m;
    if (!E.cache[k]) E.cache[k] = fetch(`/api/mapa?y=${y}&m=${m}`).then(r => r.json());
    return E.cache[k];
  }
  async function celda(la, lo, y) {
    const k = `${la},${lo},${y}`;
    if (!E.celdas[k]) E.celdas[k] = fetch(`/api/celda?lat=${la}&lon=${lo}&y=${y}`).then(r => r.json());
    return E.celdas[k];
  }
  async function pintar() {
    const [y, m] = E.meses[E.i];
    $('#tl-fecha').textContent = `${cap(MES_L[m - 1])} ${y}`;
    $('#tl-sensor').textContent = y < 2012 ? 'MODIS convertido' : 'VIIRS';
    $('#tl-sensor').className = 'sensor ' + (y < 2012 ? 'modis' : 'viirs');
    $('#ex-mesc').options[1].text = `El de la línea de tiempo (${MES_L[m - 1]} ${y})`;
    const d = await datos(y, m);
    if (E.meses[E.i][0] !== y || E.meses[E.i][1] !== m) return;   // llegó tarde
    E.capa.clearLayers();
    d.celdas.forEach(([la, lo, v]) => {
      const r = L.rectangle([[la - .125, lo - .125], [la + .125, lo + .125]], { renderer: E.rend, stroke: false, fillColor: color(v, 120), fillOpacity: .55 })
        .bindTooltip(`<b>${fmt(v, 1)} eventos</b> · ${MES_L[m - 1]} ${y}<br><span class="tip-carga">Cargando su año…</span>`, { className: 'tip-celda', sticky: true, direction: 'top', offset: [0, -8] })
        .addTo(E.capa);
      r.on('mouseover', async () => {
        const c = await celda(la, lo, y);
        r.setTooltipContent(`<b>${fmt(v, 1)} eventos</b> · ${MES_L[m - 1]} ${y}<br>${G.mini(c.eventos, c.frp, m)}
          <span class="mini-ley">Año ${y} · intensidad máx. ${cap(MES_L[c.frp.indexOf(Math.max(...c.frp))])}: ${fmt(Math.max(...c.frp))} MW</span>`);
      });
    });
    datos(...(E.meses[E.i + 1] || [y, m]));   // precarga el siguiente
  }
  function pausa() { clearInterval(E.play); E.play = null; $('#tl-play').textContent = '▶'; }
  $('#tl-play').onclick = () => {
    if (E.play) return pausa();
    $('#tl-play').textContent = '❚❚';
    E.play = setInterval(() => { E.i = (E.i + 1) % E.meses.length; $('#tl-rango').value = E.i; pintar(); }, 420);
  };

  // ---------------------------------------------------------------- 1 · selección del área (segmentos)
  const AYUDA = {
    vista: 'Mueve y acerca el mapa: se analiza exactamente lo que ves.',
    dibujar: 'Arrastra sobre el mapa para dibujar el rectángulo. Esc cancela.',
    coords: 'Escribe el centro y el radio; el mapa se acerca solo.',
  };
  function modo(m) {
    E.modo = m;
    document.querySelectorAll('#ex-modos button').forEach(b => { b.classList.toggle('sel', b.dataset.modo === m); b.setAttribute('aria-selected', b.dataset.modo === m); });
    $('#ex-ayuda').textContent = AYUDA[m];
    $('#ex-coords-caja').classList.toggle('oculto', m !== 'coords');
    if (m !== 'dibujar' && E.marcoDib) { mapa.removeLayer(E.marcoDib); E.marcoDib = null; E.dibujada = null; }
  }
  $('#ex-modos').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    modo(b.dataset.modo);
    if (b.dataset.modo === 'dibujar') dibujar();
  };
  async function dibujar() {
    if (E.marcoDib) { mapa.removeLayer(E.marcoDib); E.marcoDib = null; }
    const movil = innerWidth < 900;
    if (movil) $('#hoja').classList.add('plegada');
    IG.toast('Arrastra sobre el mapa para dibujar el área', 'aviso');
    const b = await IG.dibujarArea(mapa);
    if (movil) $('#hoja').classList.remove('plegada');
    if (!b) { modo('vista'); return; }
    E.dibujada = b;
    E.marcoDib = L.rectangle(b, { color: '#ffb020', weight: 2, fillColor: '#ffb020', fillOpacity: .07, className: 'ev-marco', interactive: false }).addTo(mapa);
    mapa.fitBounds(b, { paddingTopLeft: [20, 70], paddingBottomRight: [20, innerWidth < 900 ? $('#hoja').offsetHeight + 20 : 20], maxZoom: 12 });
    $('#ex-ayuda').innerHTML = 'Área dibujada. <button type="button" class="ex-link" id="ex-redibujar">Dibujar otra</button>';
    $('#ex-redibujar').onclick = dibujar;
    analizar(b);
  }
  // En celular la hoja tapa la parte de abajo del mapa: "lo que ves" excluye esa franja.
  function visibles() {
    if (innerWidth >= 900) return mapa.getBounds();
    const m = $('#mapa').getBoundingClientRect(), arriba = 64, abajo = Math.max(arriba + 80, $('#hoja').getBoundingClientRect().top - m.top);
    return L.latLngBounds(mapa.containerPointToLatLng([0, arriba]), mapa.containerPointToLatLng([m.width, abajo]));
  }
  function areaElegida() {
    if (E.modo === 'dibujar' && E.dibujada) return E.dibujada;
    if (E.modo === 'coords') {
      const c = { lat: +$('#ex-lat').value, lon: +$('#ex-lon').value }, r = Math.max(1, +$('#ex-rad').value);
      const ne = IG.mover(IG.mover(c, 0, r), 90, r), so = IG.mover(IG.mover(c, 180, r), 270, r);
      const b = L.latLngBounds([so.lat, so.lon], [ne.lat, ne.lon]);
      mapa.fitBounds(b, { paddingTopLeft: [10, 64], paddingBottomRight: [10, innerWidth < 900 ? $('#hoja').offsetHeight + 10 : 10] });
      return b;
    }
    return visibles();
  }
  $('#ex-analizar').onclick = () => { iniciar(); if (E.modo === 'dibujar' && !E.dibujada) return dibujar(); analizar(areaElegida()); };

  // ---------------------------------------------------------------- análisis
  async function analizar(b) {
    E.area = b;
    const q = `w=${b.getWest().toFixed(3)}&s=${b.getSouth().toFixed(3)}&e=${b.getEast().toFixed(3)}&n=${b.getNorth().toFixed(3)}`;
    const desde = +$('#ex-desde').value, hasta = Math.max(desde, +$('#ex-hasta').value);
    const [y, m] = $('#ex-mesc').value === 'linea' ? E.meses[E.i] : E.ultimo;
    $('#ex-analizar').textContent = 'Analizando…'; $('#ex-analizar').classList.add('cargando');
    const [h, f] = await Promise.all([
      fetch(`/api/aoi?${q}&desde=${desde}&hasta=${hasta}&y=${y}&m=${m}`).then(r => r.json()),
      fetch(`/api/frp?${q}&desde=${desde}&hasta=${hasta}`).then(r => r.json()).catch(() => ({ available: false })),
    ]);
    $('#ex-analizar').textContent = 'Analizar el área'; $('#ex-analizar').classList.remove('cargando');
    if (E.marco) mapa.removeLayer(E.marco);
    if (!E.marcoDib) E.marco = L.rectangle(b, { color: '#ffb020', weight: 2, fill: false, dashArray: '6 6', interactive: false }).addTo(mapa);
    $('#ex-res').classList.remove('oculto');
    if (!h.available) { $('#ex-anom').textContent = '—'; $('#ex-anom-txt').textContent = h.reason; $('#ex-res').classList.add('vacio'); return; }
    $('#ex-res').classList.remove('vacio');
    E.res = h; E.frp = f.available ? f : null; E.q = q; E.desde = desde; E.hasta = hasta;

    // anomalía del mes elegido
    $('#ex-mes').textContent = `${MES_L[h.m - 1]} ${h.y} contra la mediana de ${MES_L[h.m - 1]} ${desde}–${Math.min(hasta, 2025)}`;
    const a = h.anomalia_pct;
    if (a == null) $('#ex-anom').textContent = h.actual > 0 ? 'Inusual' : 'Sin fuego'; else IG.contar($('#ex-anom'), a, '%');
    $('#ex-anom').className = a == null ? (h.actual > 0 ? 'alto' : 'normal') : a >= 50 ? 'alto' : a <= -30 ? 'bajo' : 'normal';
    $('#ex-anom-txt').textContent = a == null ? (h.actual > 0 ? `${h.actual} eventos en un mes que normalmente no tiene fuego` : 'Este mes normalmente no tiene fuego en esta área') : a >= 50 ? 'Mucho más fuego de lo normal' : a <= -30 ? 'Menos fuego de lo normal' : 'Dentro de lo normal';

    pintarFrp(); pintarCal(); pintarAnios();
    $('#ex-datos').innerHTML = `<div><small>Este mes</small><b>${h.actual}</b></div><div><small>Mediana histórica</small><b>${h.mediana}</b></div>
      <div><small>Año con más fuego</small><b>${h.anio_max}</b></div><div><small>Más alto que</small><b>${h.percentil ?? '–'}% de los años</b></div>`;
    $('#ex-csv').href = `/api/aoi.csv?${q}&desde=${desde}&hasta=${hasta}`;
    $('#ex-frpcsv').href = `/api/frp.csv?${q}&desde=${desde}&hasta=${hasta}`;
    $('#ex-frpcsv').classList.toggle('deshab', !E.frp);
    $('#ex-hot').href = `/api/hotspots.csv?${q}&desde=${Math.max(desde, hasta - 1)}&hasta=${hasta}`;
    $('#ex-hot').classList.toggle('deshab', !E.hot); $('#ex-hot').title = E.hot ? '' : 'Copia modis.parquet y viirs.parquet en data/';
    $('#ex-fuente').textContent = h.fuente + ' · detecciones crudas: últimos 2 años del rango';
    const resumen = { area: { oeste: +b.getWest().toFixed(3), sur: +b.getSouth().toFixed(3), este: +b.getEast().toFixed(3), norte: +b.getNorth().toFixed(3) },
      periodo: [desde, hasta], mes_evaluado: `${h.y}-${String(h.m).padStart(2, '0')}`, eventos_mes: h.actual, mediana_historica: h.mediana,
      anomalia_pct: h.anomalia_pct, percentil: h.percentil, anio_con_mas_fuego: h.anio_max, total_eventos: h.total, unidad: 'eventos ≥20 MW, unidades VIIRS',
      intensidad_frp: E.frp ? { frp_acumulado_mw: E.frp.total, mes_pico: E.frp.mes_pico, temporada: E.frp.meses_temporada, pct_temporada: E.frp.pct_temporada,
        correlacion_frp_eventos: E.frp.correlacion.frp_eventos, intensidad_por_evento_mw: E.frp.correlacion.intensidad_por_evento, ajuste_modis_viirs: E.frp.ajuste } : null,
      fuente: h.fuente };
    $('#ex-json').href = URL.createObjectURL(new Blob([JSON.stringify(resumen, null, 2)], { type: 'application/json' }));
    $('#hoja').scrollTo({ top: $('#ex-res').offsetTop - 20, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- intensidad FRP
  const fuerza = r => r == null ? '' : Math.abs(r) >= .8 ? 'muy fuerte' : Math.abs(r) >= .6 ? 'fuerte' : Math.abs(r) >= .4 ? 'moderada' : 'débil';
  function pintarFrp() {
    const f = E.frp, cv = $('#ex-frp');
    document.querySelectorAll('#ex-frp-vista button').forEach(b => b.classList.toggle('sel', b.dataset.vista === E.vistaFrp));
    if (!f) { $('#ex-frp-frase').textContent = 'Sin datos de intensidad en esta área.'; cv.style.display = 'none'; $('#ex-frp-datos').innerHTML = ''; $('#ex-frp-nota').textContent = ''; return; }
    cv.style.display = 'block';
    const temp = f.meses_temporada.slice().sort((a, b) => a - b).map(m => MES_L[m - 1]), lista = temp.length > 1 ? temp.slice(0, -1).join(', ') + ' y ' + temp[temp.length - 1] : temp.join('');
    $('#ex-frp-frase').innerHTML = f.mes_pico
      ? `El fuego arde con más fuerza en <b>${MES_L[f.mes_pico - 1]}</b>; ${lista} concentran el <b>${f.pct_temporada}%</b> de la potencia radiada (FRP) del año.`
      : 'Casi no hay potencia radiada (FRP) registrada en esta área.';
    if (E.vistaFrp === 'clima') {
      G.serie(cv, {
        etiquetas: MES, alto: 190, marcar: E.res ? E.res.m - 1 : null,
        series: [{ nombre: 'FRP típico (MW)', valores: f.clima.media, color: '#ff5a1f', tipo: 'area', banda: { bajo: f.clima.p10, alto: f.clima.p90 } }],
        formato: i => `<b>${cap(MES_L[i])} típico</b><span><i style="background:#ff5a1f"></i>${fmt(f.clima.media[i])} MW de intensidad media</span><span class="tenue">8 de cada 10 años: ${fmt(f.clima.p10[i])}–${fmt(f.clima.p90[i])} MW</span>`,
      });
    } else {
      const s = f.mensual, et = s.map(r => mesCorto(r.y, r.m));
      G.serie(cv, {
        etiquetas: et, alto: 200,
        series: [{ nombre: 'FRP (MW)', valores: s.map(r => r.frp), color: '#ff5a1f', tipo: 'area' },
                 { nombre: 'Eventos armonizados', valores: s.map(r => r.ev), color: '#ffb020', tipo: 'linea', eje: 1 }],
        formato: i => `<b>${cap(MES_L[s[i].m - 1])} ${s[i].y}</b><span><i style="background:#ff5a1f"></i>${fmt(s[i].frp)} MW de intensidad</span><span><i style="background:#ffb020"></i>${fmt(s[i].ev, 1)} eventos armonizados</span><span class="tenue">FRP máximo de una detección: ${fmt(s[i].max)} MW</span>`,
      });
    }
    const c = f.correlacion, top = f.top[0];
    $('#ex-frp-datos').innerHTML = `
      <div><small>Correlación FRP ↔ eventos</small><b>r = ${c.frp_eventos ?? '—'}</b><small>${fuerza(c.frp_eventos)}</small></div>
      <div><small>Intensidad por evento</small><b>${fmt(c.intensidad_por_evento)} MW</b></div>
      <div><small>Mes más intenso</small><b>${top ? `${MES[top.m - 1]} ${top.y}` : '—'}</b><small>${top ? fmt(top.frp) + ' MW' : ''}</small></div>
      <div><small>FRP acumulado</small><b>${f.total >= 1e6 ? fmt(f.total / 1e6, 2) + ' M' : fmt(f.total)} MW</b><small>suma de detecciones ${f.desde}–${f.hasta}</small></div>`;
    $('#ex-frp-nota').textContent = f.ajuste
      ? `FRP armonizado: VIIRS desde 2012; MODIS convertido con FRP_VIIRS ≈ ${Math.exp(f.ajuste.a).toFixed(2)}·FRP_MODIS^${f.ajuste.b.toFixed(2)} (R² ${f.ajuste.r2_nacional_mensual} nacional mensual, 2012–2025).`
      : f.fuente;
  }
  $('#ex-frp-vista').onclick = e => { const b = e.target.closest('button'); if (!b) return; E.vistaFrp = b.dataset.vista; pintarFrp(); };

  // ---------------------------------------------------------------- calendario (eventos o intensidad) con tooltip
  function pintarCal() {
    const h = E.res, f = E.frp; if (!h) return;
    document.querySelectorAll('#ex-cal-vista button').forEach(b => b.classList.toggle('sel', b.dataset.cal === E.vistaCal));
    IG.dibujarCalendario($('#ex-cal'), E.vistaCal === 'frp' && f ? f.matriz : h.matriz, h.m);
    const ev = h.matriz, fr = f ? f.matriz : null;
    G.calendario($('#ex-cal'), (y, m) => {
      const i = ev.anios.indexOf(y), j = fr ? fr.anios.indexOf(y) : -1;
      return `<b>${cap(MES_L[m - 1])} ${y}</b><span><i style="background:#ffb020"></i>${i >= 0 ? fmt(ev.valores[i][m - 1], 1) : '—'} eventos</span>` +
        (fr ? `<span><i style="background:#ff5a1f"></i>${j >= 0 ? fmt(fr.valores[j][m - 1]) : '—'} MW de intensidad</span>` : '');
    });
  }
  $('#ex-cal-vista').onclick = e => { const b = e.target.closest('button'); if (!b) return; E.vistaCal = b.dataset.cal; pintarCal(); };

  // ---------------------------------------------------------------- años: arrastra para elegir el periodo
  function pintarAnios() {
    const h = E.res, f = E.frp; if (!h) return;
    const anios = h.anual.anios, frpAnual = f ? Object.fromEntries(f.anual.anios.map((y, i) => [y, f.anual.valores[i]])) : {};
    G.anios($('#ex-anual'), {
      anios, valores: h.anual.valores, desde: E.desde, hasta: Math.min(E.hasta, anios[anios.length - 1]),
      formato: i => `<b>${anios[i]}</b><span><i style="background:#f26b2a"></i>${fmt(h.anual.valores[i], 1)} eventos</span>${f ? `<span><i style="background:#ff5a1f"></i>${fmt(frpAnual[anios[i]] || 0)} MW</span>` : ''}<span class="tenue">arrastra para elegir un rango</span>`,
      alSeleccionar: (a, b) => {
        $('#ex-desde').value = a; $('#ex-hasta').value = b;
        IG.toast(`Periodo ${a}–${b}: analizando…`);
        analizar(E.area);
      },
    });
  }

  window.addEventListener('ignis-tema', () => { if (E.res) { pintarCal(); pintarFrp(); pintarAnios(); } });
  let t = null; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (E.res) { pintarFrp(); pintarAnios(); } }, 200); });
})();
