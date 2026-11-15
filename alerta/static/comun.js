// Utilidades compartidas: geodesia, rumbos, rutas de salida y calendario.
const IG = {
  // Mapas base reales: OpenStreetMap (el mismo de la app Streamlit del equipo), satélite Esri y oscuro Esri.
  mapaBase(mapa, inicial = 'Calles (OpenStreetMap)') {
    const capas = {
      'Calles (OpenStreetMap)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
      'Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
      // CARTO ahora exige clave de API; Esri gris oscuro (base + etiquetas) no la pide.
      'Oscuro (Esri)': L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles © Esri, HERE, Garmin, © OpenStreetMap' }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
      ]),
    };
    capas[inicial].addTo(mapa);
    L.control.layers(capas, null, { position: 'topright', collapsed: true }).addTo(mapa);
    return capas;
  },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  DEMO: { lat: 17.875, lon: -100.625 },   // zona #1 de México (Tierra Caliente, Guerrero)
  MESES: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  MESES_L: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
  rad: d => d * Math.PI / 180,
  dist(a, b) {
    const R = 6371, dl = IG.rad(b.lat - a.lat), dn = IG.rad(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(IG.rad(a.lat)) * Math.cos(IG.rad(b.lat)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },
  rumbo(a, b) {
    const y = Math.sin(IG.rad(b.lon - a.lon)) * Math.cos(IG.rad(b.lat));
    const x = Math.cos(IG.rad(a.lat)) * Math.sin(IG.rad(b.lat)) - Math.sin(IG.rad(a.lat)) * Math.cos(IG.rad(b.lat)) * Math.cos(IG.rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  },
  mover(p, rumbo, km) {
    return { lat: p.lat + km * Math.cos(IG.rad(rumbo)) / 110.57,
             lon: p.lon + km * Math.sin(IG.rad(rumbo)) / (111.32 * Math.cos(IG.rad(p.lat))) };
  },
  cardinal(g) {
    return ['norte','noreste','este','sureste','sur','suroeste','oeste','noroeste'][Math.round(g / 45) % 8];
  },
  difAng: (a, b) => Math.abs(((a - b + 540) % 360) - 180),
  // Ruta de salida: alejarse del fuego; si estás en su camino, salir hacia un lado.
  salida(fire, yo) {
    const desdeFuego = IG.rumbo(fire, yo), prop = fire.prop.rumbo;
    let r = desdeFuego, motivo = 'Aléjate en dirección contraria al fuego.';
    if (IG.difAng(desdeFuego, prop) < 60) {
      const izq = (prop + 270) % 360, der = (prop + 90) % 360;
      r = IG.difAng(izq, desdeFuego) < IG.difAng(der, desdeFuego) ? izq : der;
      motivo = 'Estás en la dirección hacia donde avanza el fuego: sal hacia un costado, no en línea recta.';
    }
    const d = IG.dist(fire, yo);
    const km = Math.max(4, fire.radio_km - d + 4);
    return { rumbo: r, destino: IG.mover(yo, r, km), km, motivo };
  },
  // Frente de fuego animado: mancha que se alarga hacia donde empuja el viento + brasas que vuelan en esa dirección.
  frente(mapa, f) {
    const g = L.layerGroup(), rumbo = f.prop.rumbo;
    const largo = Math.max(.8, (f.frente_km || .2) * 2 + f.prop.vel_kmh * .6), ancho = largo * .45;
    const centro = IG.mover(f, rumbo, largo * .35), pts = [];
    for (let a = 0; a < 360; a += 8) {
      const t = a * Math.PI / 180, x = Math.cos(t) * largo, y = Math.sin(t) * ancho;
      const q = IG.mover(centro, rumbo + Math.atan2(y, x) * 180 / Math.PI, Math.hypot(x, y) * (1 + Math.sin(a * 7.3 + f.avance_min) * .07));
      pts.push([q.lat, q.lon]);
    }
    L.polygon(pts, { className: 'frente-mancha', color: '#ff7a2b', weight: 2, fillColor: '#ff4d1a', fillOpacity: .3, interactive: false }).addTo(g);
    const brasas = L.marker([f.lat, f.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: '' }) }).addTo(g);
    const dibujar = () => {
      const mpp = 156543.03 * Math.cos(f.lat * Math.PI / 180) / Math.pow(2, mapa.getZoom());
      const s = Math.round(Math.max(70, Math.min(520, largo * 2200 / mpp)));
      let html = `<div class="brasas-viento" style="width:${s}px;height:${s}px;transform:rotate(${rumbo}deg)">`;
      for (let i = 0; i < 16; i++) html += `<i style="left:${42 + Math.sin(i * 2.4) * 10}%;--d:${(s * (.32 + (i % 5) * .04)).toFixed(0)}px;--dx:${(Math.sin(i * 1.7) * s * .08).toFixed(0)}px;animation-delay:${(i * .19).toFixed(2)}s;animation-duration:${(1.8 + (i % 4) * .35).toFixed(2)}s"></i>`;
      brasas.setIcon(L.divIcon({ className: '', html: html + '</div>', iconSize: [s, s], iconAnchor: [s / 2, s / 2] }));
    };
    dibujar(); mapa.on('zoomend', dibujar); g.on('remove', () => mapa.off('zoomend', dibujar));
    return g;
  },
  nivel(fire, d) {
    if (d <= fire.radio_km) return 'peligro';
    if (d <= fire.radio_km * 2) return 'precaucion';
    return 'aviso';
  },
  // Interruptor día/noche: cambia la paleta y el mapa base (calles de día, oscuro de noche).
  // Funciona en cualquier página (con o sin mapa) y sincroniza todos los interruptores .fire-switch.
  tema(mapa = null, capas = null) {
    const chks = [...document.querySelectorAll('.fire-switch input')]; if (!chks.length) return;
    let actual = capas ? Object.keys(capas).find(k => mapa.hasLayer(capas[k])) : null, manual = false;
    if (mapa) mapa.on('baselayerchange', e => { actual = e.name; manual = e.name.startsWith('Sat'); });
    const aplicar = noche => {
      document.documentElement.dataset.theme = noche ? 'dark' : 'light';
      chks.forEach(c => { c.checked = noche; });
      if (mapa && capas && !manual) { const q = noche ? 'Oscuro (Esri)' : 'Calles (OpenStreetMap)';
        if (q !== actual && capas[q]) { if (actual) mapa.removeLayer(capas[actual]); capas[q].addTo(mapa); actual = q; } }
      window.dispatchEvent(new Event('ignis-tema'));
      try { localStorage.setItem('ignis-tema', noche ? 'dark' : 'light'); } catch (e) {}
    };
    let guardado = null; try { guardado = localStorage.getItem('ignis-tema'); } catch (e) {}
    chks.forEach(c => { c.onchange = () => aplicar(c.checked); });
    aplicar(guardado ? guardado === 'dark' : true);
  },
  // Selección de un segmento del mapa arrastrando (mouse o dedo). Devuelve L.LatLngBounds o null.
  dibujarArea(mapa, { color = '#ffb020' } = {}) {
    return new Promise(res => {
      const c = mapa.getContainer(); let ini = null, rect = null, etq = null;
      c.classList.add('dibujando'); mapa.dragging.disable(); mapa.touchZoom && mapa.touchZoom.disable(); mapa.boxZoom && mapa.boxZoom.disable();
      const km = b => { const la = (b.getNorth() + b.getSouth()) / 2;
        return [Math.abs(b.getEast() - b.getWest()) * 111.32 * Math.cos(la * Math.PI / 180), Math.abs(b.getNorth() - b.getSouth()) * 110.57]; };
      const abajo = e => { if (e.button > 0) return; e.preventDefault(); e.stopPropagation(); ini = mapa.mouseEventToLatLng(e); try { c.setPointerCapture(e.pointerId); } catch (_) {} };
      const mover = e => {
        if (!ini) return; e.preventDefault();
        const b = L.latLngBounds(ini, mapa.mouseEventToLatLng(e)), [ax, ay] = km(b);
        if (rect) rect.setBounds(b); else rect = L.rectangle(b, { color, weight: 2, dashArray: '6 4', fillColor: color, fillOpacity: .1, interactive: false }).addTo(mapa);
        const txt = `${Math.round(ax)} × ${Math.round(ay)} km`;
        if (etq) etq.setLatLng(b.getNorthEast()).setContent(txt); else etq = L.tooltip({ permanent: true, direction: 'top', className: 'tip-area' }).setLatLng(b.getNorthEast()).setContent(txt).addTo(mapa);
      };
      const fin = ok => {
        c.removeEventListener('pointerdown', abajo, true); c.removeEventListener('pointermove', mover, true);
        c.removeEventListener('pointerup', arriba, true); removeEventListener('keydown', tecla);
        const b = ok && rect ? rect.getBounds() : null;
        if (rect) mapa.removeLayer(rect); if (etq) mapa.removeLayer(etq);
        const bloquear = e => e.stopPropagation();   // que el clic final no fije la ubicación ni otra acción del mapa
        c.addEventListener('click', bloquear, true); setTimeout(() => c.removeEventListener('click', bloquear, true), 350);
        c.classList.remove('dibujando'); mapa.dragging.enable(); mapa.touchZoom && mapa.touchZoom.enable(); mapa.boxZoom && mapa.boxZoom.enable();
        res(b && Math.min(...km(b)) > 1 ? b : null);
      };
      const arriba = () => { if (ini) fin(true); };
      const tecla = e => { if (e.key === 'Escape') fin(false); };
      c.addEventListener('pointerdown', abajo, true); c.addEventListener('pointermove', mover, true);
      c.addEventListener('pointerup', arriba, true); addEventListener('keydown', tecla);
      IG.dibujarArea.cancelar = () => fin(false);
    });
  },
  toast(html, tipo = '') {
    const c = document.getElementById('toasts'); if (!c) return;
    const t = document.createElement('div'); t.className = 'toast ' + tipo; t.innerHTML = html; c.prepend(t);
    setTimeout(() => t.classList.add('sale'), 3600); setTimeout(() => t.remove(), 4100);
  },
  contar(el, hasta, sufijo = '', ms = 900) {
    el.textContent = (hasta > 0 && sufijo === '%' ? '+' : '') + Math.round(hasta) + sufijo;   // valor final de inmediato
    const t0 = performance.now(), ini = 0;
    const paso = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (hasta > 0 && sufijo === '%' ? '+' : '') + Math.round(ini + (hasta - ini) * e) + sufijo; if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  },
  // Calendario año × mes en canvas, escala secuencial de fuego (log). Guarda su geometría para el tooltip.
  dibujarCalendario(canvas, matriz, mesMarcado) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const anios = matriz.anios, v = matriz.valores, filas = anios.length;
    const izq = 46, arriba = 4, abajo = 18, cw = (W - izq) / 12, ch = (H - arriba - abajo) / filas;
    const max = Math.max(1, ...v.flat());
    canvas._geo = { izq, arriba, cw, ch, anios, v };
    const vac = getComputedStyle(document.documentElement).getPropertyValue('--vacio').trim() || '#2a2522';
    const esc = [vac, '#fde3cf', '#fdbf8f', '#fd9a5b', '#f26b2a', '#c43c14', '#7a2408'];
    ctx.font = "500 14px 'IBM Plex Mono', monospace"; ctx.textBaseline = 'middle';
    for (let i = 0; i < filas; i++) {
      if (anios[i] % 4 === 3 || i === filas - 1) { ctx.fillStyle = '#a8a29e'; ctx.fillText(anios[i], 0, arriba + ch * (i + .5)); }
      for (let j = 0; j < 12; j++) {
        const x = v[i][j];
        let c = esc[0];
        if (x > 0) { const t = Math.log(1 + x) / Math.log(1 + max); c = esc[1 + Math.min(5, Math.floor(t * 6))]; }
        ctx.fillStyle = c;
        ctx.fillRect(izq + j * cw + 1, arriba + i * ch + 1, cw - 2, ch - 2);
      }
    }
    if (mesMarcado) {
      ctx.strokeStyle = document.documentElement.dataset.theme === 'light' ? '#1c1917' : '#ffffff'; ctx.lineWidth = 3;
      ctx.strokeRect(izq + (mesMarcado - 1) * cw, arriba, cw, ch * filas);
    }
    ctx.fillStyle = '#a8a29e'; ctx.textAlign = 'center'; ctx.font = "500 12px 'IBM Plex Mono', monospace";
    IG.MESES.forEach((m, j) => ctx.fillText(m[0], izq + cw * (j + .5), H - 8));
    ctx.textAlign = 'left';
  },
  fraseHistoria(h) {
    if (!h.available) return h.reason;
    const mes = IG.MESES_L[h.mes - 1];
    let s = `En ${mes}, esta zona registra en promedio <b>${Math.round(h.media_mes)}</b> eventos de fuego. `;
    s += `Concentra el <b>${h.pct_anual_en_mes}%</b> del fuego del año`;
    s += h.mes_pico === h.mes ? ' — <b>es su mes más crítico</b>.' : ` (su mes pico es ${IG.MESES_L[h.mes_pico - 1]}).`;
    if (h.cada_cuantos_anios) s += ` Un ${mes} con el doble de lo normal ocurre <b>1 de cada ${h.cada_cuantos_anios} años</b>.`;
    s += ` Récord: ${mes} de ${h.max_mes.anio}.`;
    if (h.frp_pico) s += h.frp_pico === h.mes ? ` También es cuando el fuego <b>arde con más intensidad</b>.` : ` Arde con más intensidad en <b>${IG.MESES_L[h.frp_pico - 1]}</b>.`;
    return s;
  },
};
