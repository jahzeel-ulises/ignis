// IGNIS · Plan de control (personal especializado y centro de control).
// Dibuja en el mapa la brecha cortafuego que va abriendo el tractor, las brigadas avanzando por los flancos,
// el apoyo aéreo, el contrafuego, la zona segura y las rutas de escape; anima el ataque completo
// ("Simular ataque") y arma el panel del plan y la hoja SCI-201 imprimible.
window.PLAN = (() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => (window.IG && IG.esc ? IG.esc(s) : String(s));
  const CARD = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  const cardinal = g => CARD[Math.round(((g % 360) + 360) % 360 / 45) % 8];
  const hm = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`;
  const COLOR = { maquinaria: '#b0763a', manual: '#ffb020', aereo: '#60a5fa', fuego: '#ff5a1f', seguridad: '#22c55e' };
  const ICONO = {
    tractor: '<svg viewBox="0 0 32 32"><rect x="9" y="9" width="10" height="8" rx="1.5" fill="#f59e0b"/><rect x="11" y="5" width="6" height="5" rx="1" fill="#fde68a" stroke="#92400e" stroke-width="1"/><circle cx="11" cy="21" r="5" fill="#1c1917" stroke="#fde68a" stroke-width="1.6"/><circle cx="22" cy="22.5" r="3.5" fill="#1c1917" stroke="#fde68a" stroke-width="1.4"/><rect x="18" y="12" width="8" height="5" rx="1" fill="#f59e0b"/><path d="M26 18 l4 5" stroke="#d6d3d1" stroke-width="2" stroke-linecap="round"/></svg>',
    brigada: '<svg viewBox="0 0 32 32"><path d="M6 17a10 10 0 0 1 20 0z" fill="#ffb020" stroke="#7c2d12" stroke-width="1.4"/><rect x="4" y="16" width="24" height="3.4" rx="1.7" fill="#fbbf24" stroke="#7c2d12" stroke-width="1.2"/><circle cx="16" cy="24" r="3.2" fill="#fde68a"/></svg>',
    helicoptero: '<svg viewBox="0 0 32 32"><ellipse cx="14" cy="17" rx="7" ry="4.5" fill="#60a5fa" stroke="#1e3a8a" stroke-width="1.2"/><path d="M20 17h9" stroke="#1e3a8a" stroke-width="2"/><path d="M3 10h22" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round"/><path d="M14 12v-2" stroke="#1e3a8a" stroke-width="2"/></svg>',
    bandera: '<svg viewBox="0 0 32 32"><path d="M9 4v25" stroke="#fafaf9" stroke-width="2.2" stroke-linecap="round"/><path d="M10 5h14l-4 5 4 5H10z" fill="#ffb020" stroke="#7c2d12" stroke-width="1"/></svg>',
  };
  const icono = (k, cls = '', s = 30) => L.divIcon({ className: '', html: `<div class="plan-ico ${cls}">${ICONO[k]}</div>`, iconSize: [s, s], iconAnchor: [s / 2, s / 2] });

  // ---------------------------------------------------------------- geometría sobre polilíneas
  const dist = (a, b) => L.latLng(a).distanceTo(L.latLng(b));
  function puntoEn(pts, t) {
    const seg = pts.slice(1).map((p, i) => dist(pts[i], p)), tot = seg.reduce((a, b) => a + b, 0);
    let falta = tot * Math.max(0, Math.min(1, t));
    for (let i = 0; i < seg.length; i++) {
      if (falta <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, falta / seg[i]) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; }
      falta -= seg[i];
    }
    return pts[pts.length - 1];
  }
  function parcial(pts, t) {
    if (t <= 0) return [pts[0], pts[0]];
    const seg = pts.slice(1).map((p, i) => dist(pts[i], p)), tot = seg.reduce((a, b) => a + b, 0);
    let falta = tot * Math.min(1, t); const out = [pts[0]];
    for (let i = 0; i < seg.length; i++) {
      if (falta >= seg[i]) { out.push(pts[i + 1]); falta -= seg[i]; continue; }
      const k = falta / seg[i]; out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]); break;
    }
    return out;
  }
  const prog = (plan, id) => (plan.tacticas.find(k => k.id === id) || { progreso: 0 }).progreso;

  // ---------------------------------------------------------------- capas del plan en el mapa
  function capas(mapa, fire, sobre = null) {
    const plan = fire && fire.plan; if (!plan) return quitar(mapa);
    const g = mapa._planCapa || (mapa._planCapa = L.layerGroup().addTo(mapa));
    if (!g._hecho || g._ver !== plan.version) { g.clearLayers(); construir(g, plan); g._hecho = true; g._ver = plan.version; }
    actualizar(g, plan, sobre);
    return g;
  }
  function construir(g, plan) {
    const b = plan.brecha.puntos, z = plan.zona_segura;
    g.zona = L.circle(z.punto, { radius: z.radio_m, color: '#22c55e', weight: 2, fillColor: '#22c55e', fillOpacity: .12, className: 'plan-zona', interactive: false })
      .bindTooltip('Zona segura', { permanent: true, direction: 'center', className: 'plan-etq verde' }).addTo(g);
    z.rutas.forEach(r => L.polyline(r, { color: '#22c55e', weight: 2, dashArray: '2 7', opacity: .9, className: 'plan-escape', interactive: false }).addTo(g));
    g.guia = L.polyline(b, { color: '#d6a46a', weight: 3, dashArray: '8 6', opacity: .75, interactive: false }).addTo(g);
    g.tierra = L.polyline([b[0], b[0]], { color: '#6b3f1d', weight: 9, opacity: .95, lineCap: 'butt', interactive: false }).addTo(g);
    g.surcos = L.polyline([b[0], b[0]], { color: '#c08a55', weight: 3, dashArray: '2 4', opacity: .9, lineCap: 'butt', interactive: false, className: 'plan-surcos' }).addTo(g);
    g.tractor = L.marker(b[0], { icon: icono('tractor', 'plan-tractor', 34), interactive: false, zIndexOffset: 900 }).addTo(g);
    const mid = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    g.etqBrecha = L.tooltip({ permanent: true, direction: 'top', offset: [0, -8], className: 'plan-etq tierra' }).setLatLng(mid).addTo(g);
    g.flancos = ['izq', 'der'].map(k => {
      const pts = plan.flancos[k];
      return { pts, guia: L.polyline(pts, { color: '#ffb020', weight: 2.5, dashArray: '6 7', opacity: .8, className: 'plan-flanco', interactive: false }).addTo(g),
        linea: L.polyline([pts[0], pts[0]], { color: '#ffb020', weight: 4.5, opacity: .95, interactive: false }).addTo(g),
        brig: L.marker(pts[0], { icon: icono('brigada', 'plan-brigada', 26), interactive: false, zIndexOffset: 800 }).addTo(g) };
    });
    L.marker(plan.anclaje, { icon: icono('bandera', '', 28), interactive: false }).bindTooltip('Punto de anclaje', { direction: 'top', className: 'plan-etq' }).addTo(g);
    if (plan.contrafuego.apto) g.contra = L.polyline(plan.contrafuego.puntos, { color: '#ff5a1f', weight: 4, opacity: 0, dashArray: '1 6', lineCap: 'round', className: 'plan-contrafuego', interactive: false }).addTo(g);
    if (plan.aereo.apto) g.heli = L.marker(plan.aereo.punto, { icon: L.divIcon({ className: '', html: `<div class="plan-orbita"><div class="plan-ico plan-heli">${ICONO.helicoptero}</div></div><i class="plan-gota"></i><i class="plan-gota d2"></i>`, iconSize: [90, 90], iconAnchor: [45, 45] }), interactive: false, zIndexOffset: 1000 }).addTo(g);
  }
  function actualizar(g, plan, sobre) {
    const p = id => sobre && id in sobre ? sobre[id] : prog(plan, id);
    const b = plan.brecha.puntos, pb = p('brecha');
    g.tierra.setLatLngs(parcial(b, pb)); g.surcos.setLatLngs(parcial(b, pb));
    g.tractor.setLatLng(puntoEn(b, pb)); g.tractor.setOpacity(pb >= 1 ? .55 : 1);
    g.etqBrecha.setContent(pb >= 1 ? 'Brecha terminada' : `Brecha ${Math.round(pb * 100)}% · ${plan.brecha.largo_km.toFixed(1)} km`);
    g.flancos.forEach((f, i) => { const t = p(i ? 'flanco_der' : 'flanco_izq'); f.linea.setLatLngs(parcial(f.pts, t)); f.brig.setLatLng(puntoEn(f.pts, t)); });
    if (g.contra) g.contra.setStyle({ opacity: p('contrafuego') > 0 ? .95 : 0 });
    if (g.heli) { const el = g.heli.getElement(); if (el) el.classList.toggle('activo', p('aereo') > 0 && p('aereo') < 1); }
    const el = g.tractor.getElement(); if (el) el.classList.toggle('trabajando', pb > 0 && pb < 1);
  }
  function quitar(mapa) { if (mapa._planCapa) { mapa.removeLayer(mapa._planCapa); mapa._planCapa = null; } detenerSim(mapa); }

  // ---------------------------------------------------------------- simulación del ataque (local, no cambia el incidente)
  function simular(mapa, fire, { alTerminar } = {}) {
    const plan = fire.plan; detenerSim(mapa);
    const fin = Math.max(...plan.tacticas.map(k => k.fin), plan.brecha.llegada_fuego_min) + 10;
    const dur = RM ? 1 : Math.min(18000, 6000 + fin * 45), t0 = performance.now(), r = fire.prop.rumbo;
    const vCab = Math.max(.3, fire.prop.vel_kmh * 1.5), frente0 = fire.frente_km || .2, tope = plan.brecha.dist_km;
    const reloj = document.createElement('div'); reloj.className = 'plan-reloj'; mapa.getContainer().appendChild(reloj);
    const mancha = L.polygon([[fire.lat, fire.lon]], { color: '#ff3b30', weight: 2, fillColor: '#ff5a1f', fillOpacity: .2, className: 'plan-mancha', interactive: false }).addTo(mapa);
    const mov = (la, lo, rb, km) => [la + km * Math.cos(rb * Math.PI / 180) / 110.57, lo + km * Math.sin(rb * Math.PI / 180) / (111.32 * Math.cos(la * Math.PI / 180))];
    let contenido = false;
    const paso = now => {
      const k = Math.min(1, (now - t0) / dur), min = k * fin, sobre = {};
      plan.tacticas.forEach(x => { sobre[x.id] = Math.max(0, Math.min(1, (min - x.inicio) / Math.max(1, x.fin - x.inicio))); });
      // la cabeza avanza hasta la brecha; si la brecha ya está lista, ahí se detiene
      let cabeza = frente0 + vCab * min / 60;
      if (cabeza >= tope - .1) { if (sobre.brecha >= 1) { cabeza = tope - .1; contenido = true; } }
      const largoF = Math.max(.3, cabeza * .52), anchoF = Math.max(.2, cabeza * .24), centro = mov(fire.lat, fire.lon, r, cabeza - largoF), pts = [];
      for (let a = 0; a < 360; a += 12) { const t = a * Math.PI / 180, x = Math.cos(t) * largoF, y = Math.sin(t) * anchoF;
        const q = mov(centro[0], centro[1], r + Math.atan2(y, x) * 180 / Math.PI, Math.hypot(x, y)); pts.push(q); }
      mancha.setLatLngs(pts);
      capas(mapa, fire, sobre);
      reloj.innerHTML = `<b>T + ${hm(min)}</b><span>${contenido ? 'Contenido en la brecha' : sobre.brecha >= 1 ? 'Brecha lista · esperando al fuego' : sobre.brecha > 0 ? `Tractores abriendo brecha · ${Math.round(sobre.brecha * 100)}%` : 'Despliegue de recursos'}</span>`;
      reloj.classList.toggle('ok', contenido);
      if (k < 1) mapa._planSim = requestAnimationFrame(paso);
      else { setTimeout(() => { mapa.removeLayer(mancha); reloj.remove(); capas(mapa, fire); alTerminar && alTerminar(contenido); }, 2600); mapa._planSim = null; }
    };
    mapa._planSimLimpiar = () => { mapa.removeLayer(mancha); reloj.remove(); };
    mapa._planSim = requestAnimationFrame(paso);
  }
  function detenerSim(mapa) { if (mapa._planSim) cancelAnimationFrame(mapa._planSim); mapa._planSim = null; if (mapa._planSimLimpiar) { mapa._planSimLimpiar(); mapa._planSimLimpiar = null; } }

  // ---------------------------------------------------------------- panel del plan
  const ESTADO = { 'en curso': ['curso', 'En curso'], contenido: ['ok', 'Contenido'], 'en riesgo': ['riesgo', 'En riesgo'], 'cruzó la brecha': ['riesgo', 'Cruzó la brecha'] };
  function panel(fire, { miTarea = null, control = false } = {}) {
    const p = fire.plan, b = p.brecha, [cls, txt] = ESTADO[p.estado] || ESTADO['en curso'];
    const fin = Math.max(...p.tacticas.map(k => k.fin));
    const resumen = p.contenido ? `Incendio <b>contenido en la brecha</b> a ${b.dist_km.toFixed(1)} km del foco.`
      : b.a_tiempo ? `Abrir una <b>brecha de ${b.largo_km.toFixed(1)} km</b> a ${b.dist_km.toFixed(1)} km hacia el ${cardinal(fire.prop.rumbo)}: se termina en ${hm(45 + b.construccion_min)} y el fuego llega en ${hm(b.llegada_fuego_min)} (<b>margen de ${hm(b.margen_min)}</b>).`
      : `<b>El fuego llegaría antes</b> de terminar la brecha: refuerza con apoyo aéreo y más maquinaria, o ábrela más adelante.`;
    return `<div class="plan-cab"><b>Plan de control</b><span class="plan-nivel n${p.nivel}">${p.nivel_txt}</span><span class="plan-estado ${cls}">${txt}</span></div>
      ${p.replanteado ? '<p class="plan-aviso">El fuego cruzó la línea anterior: plan replanteado más adelante.</p>' : ''}
      <p class="plan-resumen">${resumen}</p>
      ${miTarea ? tarea(miTarea) : ''}
      <div class="plan-acciones"><button type="button" class="btn-primario plan-sim" data-plan="sim">▶ Simular ataque</button>${control ? '<button type="button" class="btn-sec" data-plan="sci">Hoja SCI-201</button>' : ''}</div>
      <ol class="plan-tacticas">${p.tacticas.map(k => `<li style="--c:${COLOR[k.tipo]};--p:${k.progreso}">
        <div><b>${esc(k.nombre)}</b><small>${esc(k.recurso)} · ${hm(k.inicio)}–${hm(k.fin)}</small></div>
        <span class="plan-barra"><i style="left:${100 * k.inicio / fin}%;width:${100 * (k.fin - k.inicio) / fin}%"><em></em></i></span>
        <p>${esc(k.desc)}</p></li>`).join('')}</ol>
      <div class="plan-recursos">${p.recursos.filter(r => r.cantidad).map(r => `<span><b>${r.cantidad}</b>${esc(r.tipo)}</span>`).join('')}</div>
      ${control ? `<p class="plan-sub">Personal asignado</p>${p.asignaciones.length ? `<ul class="plan-equipo">${p.asignaciones.map(a => `<li><b>${esc(a.nombre)}</b><span>${esc(a.sector_txt)}</span></li>`).join('')}</ul>` : '<p class="plan-nota">Aún no hay personal especializado conectado. Al entrar con su código reciben su tarea en el celular o la computadora.</p>'}` : ''}
      <p class="plan-nota">Plan orientativo para entrenamiento (SCI). Las decisiones las toma el comandante del incidente.</p>`;
  }
  function tarea(t) {
    const gm = t.punto ? `https://www.google.com/maps/dir/?api=1&destination=${t.punto[0].toFixed(5)},${t.punto[1].toFixed(5)}&travelmode=driving` : null;
    return `<div class="plan-tarea"><small>Tu tarea</small><b>${esc(t.sector_txt)}</b><p>${esc(t.tarea)}</p>
      <span>${esc(t.recurso)}${t.dist_km != null ? ` · a ${t.dist_km} km hacia el ${cardinal(t.rumbo)}` : ''} · de ${hm(t.inicio)} a ${hm(t.fin)}</span>
      ${gm ? `<a class="btn-sec" target="_blank" rel="noopener" href="${gm}">Cómo llegar</a>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- hoja SCI-201 (resumen del incidente) imprimible
  function sciHTML(fire) {
    const p = fire.plan, c = fire.ctx || {}, ahora = new Date();
    const pts = [[fire.lat, fire.lon], ...p.brecha.puntos, ...p.flancos.izq, ...p.flancos.der, p.zona_segura.punto];
    const la = pts.map(x => x[0]), lo = pts.map(x => x[1]), m = .01;
    const [s, n, w, e] = [Math.min(...la) - m, Math.max(...la) + m, Math.min(...lo) - m, Math.max(...lo) + m];
    const X = q => 20 + 360 * (q[1] - w) / (e - w), Y = q => 20 + 260 * (n - q[0]) / (n - s), P = a => a.map(q => `${X(q).toFixed(1)},${Y(q).toFixed(1)}`).join(' ');
    const croquis = `<svg viewBox="0 0 400 300" width="400" height="300" style="border:1px solid #ccc;background:#faf8f5">
      <polyline points="${P(p.flancos.izq)}" fill="none" stroke="#d97706" stroke-width="3" stroke-dasharray="6 4"/>
      <polyline points="${P(p.flancos.der)}" fill="none" stroke="#d97706" stroke-width="3" stroke-dasharray="6 4"/>
      <polyline points="${P(p.brecha.puntos)}" fill="none" stroke="#6b3f1d" stroke-width="7"/>
      <circle cx="${X([fire.lat, fire.lon])}" cy="${Y([fire.lat, fire.lon])}" r="9" fill="#ef4444"/>
      <circle cx="${X(p.zona_segura.punto)}" cy="${Y(p.zona_segura.punto)}" r="10" fill="none" stroke="#16a34a" stroke-width="3"/>
      <text x="${X(p.zona_segura.punto) + 14}" y="${Y(p.zona_segura.punto) + 4}" font-size="11" fill="#16a34a">Zona segura</text>
      <text x="${X(p.brecha.puntos[1]) + 6}" y="${Y(p.brecha.puntos[1])}" font-size="11" fill="#6b3f1d">Brecha</text>
      <text x="${X([fire.lat, fire.lon]) + 12}" y="${Y([fire.lat, fire.lon]) + 4}" font-size="11" fill="#b91c1c">Foco</text></svg>`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SCI-201 · IGNIS-${esc(fire.id)}</title>
      <style>body{font:14px/1.45 system-ui,sans-serif;color:#111;max-width:860px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #e8561f;padding-bottom:3px}
      table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f5f0ea}.fila{display:flex;gap:20px;flex-wrap:wrap}.muted{color:#666;font-size:12px}
      @media print{button{display:none}}</style></head><body>
      <button onclick="print()" style="float:right;padding:8px 14px">Imprimir / PDF</button>
      <h1>SCI-201 · Resumen del incidente</h1><p class="muted">IGNIS · simulación y entrenamiento · generado ${ahora.toLocaleString('es-MX')}</p>
      <h2>1. Incidente</h2><table><tr><th>Nombre</th><td>IGNIS-${esc(fire.id)}</td><th>Nivel</th><td>${esc(p.nivel_txt)}</td></tr>
      <tr><th>Ubicación del foco</th><td>${fire.lat.toFixed(4)}, ${fire.lon.toFixed(4)}</td><th>Estado</th><td>${esc(p.estado)}</td></tr>
      <tr><th>Viento</th><td>${Math.round(c.viento_kmh || 0)} km/h hacia el ${cardinal(((c.viento_desde || 0) + 180) % 360)}</td><th>Pendiente</th><td>${c.pendiente_pct != null ? c.pendiente_pct + '%' : 'sin dato'}</td></tr>
      <tr><th>Propagación estimada</th><td>${fire.prop.vel_kmh} km/h hacia el ${cardinal(fire.prop.rumbo)}</td><th>Intensidad típica (FRP)</th><td>${p.frp_tipico != null ? Math.round(p.frp_tipico) + ' MW' : 'sin dato'}</td></tr></table>
      <h2>2. Croquis</h2><div class="fila">${croquis}<div><p><b>Brecha cortafuego:</b> ${p.brecha.largo_km.toFixed(1)} km a ${p.brecha.dist_km.toFixed(1)} km del foco.</p>
      <p><b>Construcción:</b> ${hm(p.brecha.construccion_min)} tras el despliegue · <b>llegada del fuego:</b> ${hm(p.brecha.llegada_fuego_min)}.</p>
      <p><b>Zona segura:</b> ${p.zona_segura.punto[0].toFixed(4)}, ${p.zona_segura.punto[1].toFixed(4)}</p></div></div>
      <h2>3. Objetivos y estrategia</h2><table><tr><th>Táctica</th><th>Recurso</th><th>Horario</th><th>Descripción</th></tr>
      ${p.tacticas.map(k => `<tr><td>${esc(k.nombre)}</td><td>${esc(k.recurso)}</td><td>${hm(k.inicio)}–${hm(k.fin)}</td><td>${esc(k.desc)}</td></tr>`).join('')}</table>
      <h2>4. Recursos</h2><table><tr>${p.recursos.map(r => `<th>${esc(r.tipo)}</th>`).join('')}</tr><tr>${p.recursos.map(r => `<td>${r.cantidad}</td>`).join('')}</tr></table>
      <h2>5. Organización (personal asignado)</h2><table><tr><th>Nombre</th><th>Sector</th></tr>${p.asignaciones.map(a => `<tr><td>${esc(a.nombre)}</td><td>${esc(a.sector_txt)}</td></tr>`).join('') || '<tr><td colspan="2">Sin personal conectado</td></tr>'}</table>
      <h2>6. Seguridad (LACES)</h2><p>Vigías, comunicaciones, rutas de escape hacia la zona segura y zonas seguras definidas antes de entrar. Contrafuego: ${esc(p.contrafuego.motivo)}.</p>
      <p class="muted">Plan orientativo generado por IGNIS para entrenamiento. No sustituye el juicio del comandante del incidente.</p></body></html>`;
  }
  // abre la hoja en otra pestaña; si el navegador lo bloquea, la descarga para imprimirla
  function sci(fire) {
    const url = URL.createObjectURL(new Blob([sciHTML(fire)], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a'); a.href = url; a.download = `SCI-201_IGNIS-${fire.id}.html`; document.body.appendChild(a); a.click(); a.remove();
      if (window.IG && IG.toast) IG.toast('Se descargó la hoja SCI-201: ábrela para imprimirla o guardarla como PDF', 'ok');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return { capas, quitar, simular, detenerSim, panel, tarea, sci, sciHTML, cardinal };
})();

// ---------------------------------------------------------------- enganche con el centro de control
(() => {
  if (!document.getElementById('btn-lanzar') || typeof pintarFuego !== 'function') return;
  const sec = document.createElement('section'); sec.className = 'plan-panel oculto'; sec.id = 'plan-panel'; sec.setAttribute('aria-live', 'polite');
  const ctx = document.getElementById('ctx'); ctx.parentNode.insertBefore(sec, ctx.nextSibling);
  sec.addEventListener('click', e => {
    const b = e.target.closest('[data-plan]'); if (!b || !fuego || !fuego.plan) return;
    if (b.dataset.plan === 'sim') { b.disabled = true; PLAN.simular(mapa, fuego, { alTerminar: ok => { b.disabled = false; bitacora(ok ? 'Simulación: incendio contenido en la brecha' : 'Simulación: la brecha no alcanzó a detener el fuego', ok ? 'verde' : 'rojo'); } }); }
    if (b.dataset.plan === 'sci') PLAN.sci(fuego);
  });
  let estadoPrevio = null;
  const original = pintarFuego;
  pintarFuego = function () {
    original();
    if (!fuego || !fuego.plan) { sec.classList.add('oculto'); PLAN.quitar(mapa); estadoPrevio = null; return; }
    sec.classList.remove('oculto'); sec.innerHTML = PLAN.panel(fuego, { control: true });
    const nueva = !mapa._planCapa || mapa._planCapa._ver !== fuego.plan.version;
    PLAN.capas(mapa, fuego);
    if (nueva) mapa.flyToBounds(L.latLngBounds([[fuego.lat, fuego.lon], ...fuego.plan.brecha.puntos, fuego.plan.zona_segura.punto]).pad(.3), { duration: WOW.RM ? 0 : 1.2, maxZoom: 13 });
    if (estadoPrevio && estadoPrevio !== fuego.plan.estado) bitacora(`Plan de control: ${fuego.plan.estado}`, fuego.plan.estado === 'contenido' ? 'verde' : 'rojo');
    estadoPrevio = fuego.plan.estado;
  };
})();

// ---------------------------------------------------------------- enganche con la app (personal especializado, celular o computadora)
(() => {
  if (typeof dibujarFuego !== 'function' || typeof S === 'undefined') return;
  const esBrig = () => S.rol === 'brigadista';
  const caja = () => {
    let c = document.getElementById('brig-plan');
    if (!c) { c = document.createElement('div'); c.id = 'brig-plan'; c.className = 'plan-panel';
      const d = document.getElementById('brig-datos'); d.parentNode.insertBefore(c, d.nextSibling);
      c.addEventListener('click', e => {
        const b = e.target.closest('[data-plan]'); if (!b || !S.fire || !S.fire.plan) return;
        if (b.dataset.plan === 'sim') { b.disabled = true; document.getElementById('hoja').classList.add('plegada');
          const pb = S.fire.plan.brecha.puntos; mapa.fitBounds(L.latLngBounds([[S.fire.lat, S.fire.lon], ...pb, S.fire.plan.zona_segura.punto]).pad(.25));
          PLAN.simular(mapa, S.fire, { alTerminar: ok => { b.disabled = false; IG.toast(ok ? 'Simulación: contenido en la brecha' : 'Simulación: la brecha no alcanzó', ok ? 'ok' : 'aviso'); } }); }
      }); }
    return c;
  };
  const pintar = () => {
    if (!esBrig()) return;
    if (!S.fire || !S.fire.plan) { const c = document.getElementById('brig-plan'); if (c) c.innerHTML = ''; PLAN.quitar(mapa); return; }
    caja().innerHTML = PLAN.panel(S.fire, { miTarea: S.tarea });
    PLAN.capas(mapa, S.fire);
  };
  const dib = dibujarFuego; dibujarFuego = function () { dib(); pintar(); };
  const lim = limpiar; limpiar = function () { lim(); S.tarea = null; pintar(); };
  const pb = panelBrigada; panelBrigada = function () { pb(); if (esBrig() && S.fire && S.fire.plan) caja().innerHTML = PLAN.panel(S.fire, { miTarea: S.tarea }); };
  const qb = queBrigada; queBrigada = function () { const h = qb(); return S.fire && S.fire.plan ? `<h2>Plan de control</h2><div class="plan-panel">${PLAN.panel(S.fire, { miTarea: S.tarea })}</div>` + h : h; };
  // tarea personal enviada por el servidor
  window.PLAN.asignacion = m => {
    const nueva = !S.tarea || S.tarea.sector !== m.tarea.sector;
    S.tarea = m.tarea;
    if (S.fire && m.estado && S.fire.plan) S.fire.plan.estado = m.estado;
    pintar();
    if (nueva) { IG.toast(`<b>Tu tarea:</b> ${IG.esc(m.tarea.sector_txt)}`, 'aviso'); if (navigator.vibrate) navigator.vibrate([120, 60, 120]); }
  };
})();
