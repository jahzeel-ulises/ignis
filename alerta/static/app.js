// IGNIS Alerta — app del celular
const $ = s => document.querySelector(s);
const S = { rol: 'usuario', yo: null, fire: null, ws: null, mes: 4, audio: null, alertado: false, usuarios: [], timer: null };

// ---------------------------------------------------------------- perfil
function arrancar(ses) {
  Object.assign(S, { rol: ses.rol, nombre: ses.nombre, token: ses.token, verificado: ses.verificado });
  S.audio = window.__audio || new (window.AudioContext || window.webkitAudioContext)();   // creado en el toque del login
  S.audio.resume();
  if (navigator.vibrate) navigator.vibrate(30);
  $('#s-inicio').classList.remove('activa'); $('#s-mapa').classList.add('activa');
  $('#chip-rol').innerHTML = `<svg class="ic"><use href="#i-${S.rol === 'brigadista' ? 'shield' : 'user'}"/></svg><span class="rol-txt">${S.rol === 'brigadista' ? 'Especializado' : 'Ciudadano'}</span>`; $('#chip-rol').title = S.rol === 'brigadista' ? 'Personal especializado' : 'Usuario';
  if (S.rol === 'brigadista') $('#hoja-brig').classList.remove('oculto');
  if (window.pararPortada) pararPortada();
  iniciarMapa(); conectar(); ubicar();
  IG.toast(`Hola, ${S.nombre}. Alertas activadas${S.verificado ? ' · credencial verificada' : ''}`, 'ok');
};

// ---------------------------------------------------------------- mapa
let mapa, capaYo, capaFuego, capaRadio, capaRuta, capaCono, capaOtros, capaFrente;
function iniciarMapa() {
  mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView([IG.DEMO.lat, IG.DEMO.lon], 9);
  IG.tema(mapa, IG.mapaBase(mapa, 'Oscuro (Esri)'));
  capaOtros = L.layerGroup().addTo(mapa);
  mapa.on('click', e => fijarUbicacion({ lat: e.latlng.lat, lon: e.latlng.lng }));
}
function fijarUbicacion(p) {
  S.yo = p;
  $('#aviso-ubic').classList.add('oculto');
  const icono = L.divIcon({ className: '', html: '<div class="yo"></div>', iconSize: [22, 22] });
  if (capaYo) capaYo.setLatLng([p.lat, p.lon]); else capaYo = L.marker([p.lat, p.lon], { icon: icono }).addTo(mapa);
  enviar({ type: 'pos', lat: p.lat, lon: p.lon });
  cargarHistoria();
  if (S.fire) evaluar(S.fire, false);
}
function ubicar() {
  if (!navigator.geolocation || !isSecureContext) { $('#aviso-ubic').classList.remove('oculto'); return; }
  navigator.geolocation.getCurrentPosition(
    p => { fijarUbicacion({ lat: p.coords.latitude, lon: p.coords.longitude }); mapa.setView([p.coords.latitude, p.coords.longitude], 11); },
    () => $('#aviso-ubic').classList.remove('oculto'), { timeout: 6000 });
}
$('#btn-demo-ubic').onclick = () => {
  const p = IG.mover(IG.DEMO, Math.random() * 360, 3 + Math.random() * 22);
  fijarUbicacion(p); mapa.setView([p.lat, p.lon], 10);
};

// ---------------------------------------------------------------- historia
async function cargarHistoria() {
  if (!S.yo) return;
  $('#hist-esq').classList.remove('oculto'); $('#hist-cal').style.display = 'none';
  const h = await (await fetch(`/api/historia?lat=${S.yo.lat}&lon=${S.yo.lon}&mes=${S.mes}`)).json();
  S.hist = h;
  $('#hist-esq').classList.add('oculto');
  $('#hist-frase').innerHTML = IG.fraseHistoria(h);
  $('#hist-fuente').textContent = h.available ? h.fuente : '';
  if (h.available) IG.dibujarCalendario($('#hist-cal'), h.matriz, h.mes);
  $('#hist-cal').style.display = h.available ? 'block' : 'none';
  if (h.available) IG.graf.calendario($('#hist-cal'), (y, m, v) => `<b>${IG.MESES_L[m - 1]} ${y}</b><span><i style="background:#ffb020"></i>${IG.graf.fmt(v, 1)} eventos de fuego</span>`);
  pintarFrpZona();
}

// ---------------------------------------------------------------- tiempo real
function conectar() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  S.ws = ws;
  ws.onopen = () => { enviar({ type: 'hello', token: S.token, role: S.rol, name: S.nombre }); if (S.yo) enviar({ type: 'pos', ...S.yo }); estado('ok', 'Conectado · sin alertas'); };
  ws.onclose = () => { estado('mal', 'Reconectando…'); setTimeout(conectar, 1500); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') { S.mes = m.mes; if (m.fire) { S.fire = m.fire; dibujarFuego(); } }
    if (m.type === 'fire') { S.fire = m.fire; S.alertado = false; dibujarFuego(); evaluar(m.fire, true); }
    if (m.type === 'update') { IG.toast(`El fuego avanzó · ${m.fire.avance_min} min. Ruta recalculada`, 'aviso'); S.fire = m.fire; dibujarFuego(); evaluar(m.fire, false); if (!$('#s-alerta').classList.contains('oculto')) llenarAlerta(); }
    if (m.type === 'clear') limpiar();
    if (m.type === 'mes') { S.mes = m.mes; cargarHistoria(); }
    if (m.type === 'users') { S.usuarios = m.users; if (S.rol === 'brigadista') {
      if (m.fire && m.fire.plan && (!S.fire || !S.fire.plan || S.fire.plan.version !== m.fire.plan.version || S.fire.plan.estado !== m.fire.plan.estado)) { S.fire = m.fire; dibujarFuego(); }
      dibujarOtros(); panelBrigada(); } }
    if (m.type === 'asignacion' && window.PLAN && PLAN.asignacion) PLAN.asignacion(m);
  };
}
const enviar = m => S.ws && S.ws.readyState === 1 && S.ws.send(JSON.stringify(m));
function estado(clase, txt) { $('#chip-estado').className = 'chip ' + clase; $('#txt-estado').textContent = txt; }

// ---------------------------------------------------------------- fuego
function dibujarFuego() {
  const f = S.fire;
  [capaFuego, capaRadio, capaCono, capaFrente].forEach(c => c && mapa.removeLayer(c));
  capaFrente = IG.frente(mapa, f).addTo(mapa);
  capaRadio = L.circle([f.lat, f.lon], { radius: f.radio_km * 1000, color: '#ff4d2e', weight: 1.5, fillColor: '#ff4d2e', fillOpacity: .12 }).addTo(mapa);
  capaFuego = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', html: '<div class="foco"><span></span></div>', iconSize: [34, 34] }) }).addTo(mapa);
  if (S.rol === 'brigadista') {
    const largo = Math.max(1.5, f.prop.vel_kmh * 2), p = [[f.lat, f.lon]];
    for (let a = -25; a <= 25; a += 5) { const q = IG.mover(f, f.prop.rumbo + a, largo); p.push([q.lat, q.lon]); }
    capaCono = L.polygon(p, { color: '#ffb020', weight: 1, fillColor: '#ffb020', fillOpacity: .25, dashArray: '4 4' }).addTo(mapa)
      .bindTooltip('Propagación estimada en 2 h (orientativa)');
  }
}
function evaluar(f, nueva) {
  if (!S.yo) { estado('alerta', 'Incendio reportado · fija tu ubicación'); return; }
  const d = IG.dist(f, S.yo), nivel = IG.nivel(f, d);
  S.d = d; S.nivel = nivel;
  if (!nueva) { if (nivel !== 'aviso') dibujarRuta(); return; }
  const espera = Math.min(10, d / (f.onda_kms || 2)) * 1000;   // la alerta viaja como onda desde el foco
  clearTimeout(S.timer); clearInterval(S.cuenta);
  mapa.flyTo([f.lat, f.lon], Math.max(9, Math.min(12, 13 - Math.log2(1 + d))), { duration: 1.6 });
  if (nivel !== 'aviso' && espera > 900) {
    let n = Math.ceil(espera / 1000); $('#pre').classList.remove('oculto'); $('#pre-n').textContent = n; $('#pre-txt').textContent = `a ${d.toFixed(1)} km de ti`;
    toque(1); if (navigator.vibrate) navigator.vibrate(80);
    S.cuenta = setInterval(() => { n--; if (n <= 0) return clearInterval(S.cuenta); $('#pre-n').textContent = n; toque(1); }, 1000);
  }
  estado('alerta', `Alerta en camino… ${Math.round(espera / 1000)} s`);
  S.timer = setTimeout(() => {
    $('#pre').classList.add('oculto'); clearInterval(S.cuenta);
    if (nivel === 'aviso') { estado('aviso', `Incendio a ${d.toFixed(1)} km · fuera de tu zona`); toque(1); enviar({ type: 'alerted', dist_km: +d.toFixed(1) }); return; }
    mostrarAlerta(); dibujarRuta();
  }, espera);
}
function mostrarAlerta() {
  llenarAlerta();
  const al = $('#s-alerta'); al.className = 'alerta ' + S.nivel;
  sirena(S.nivel === 'peligro' ? 7 : 3);
  if (navigator.vibrate) navigator.vibrate(S.nivel === 'peligro' ? [600, 200, 600, 200, 600, 200, 1200] : [400, 200, 400]);
  estado('alerta', S.nivel === 'peligro' ? 'PELIGRO · incendio cercano' : 'Precaución · incendio en la región');
  enviar({ type: 'alerted', dist_km: +S.d.toFixed(1) });
}
function llenarAlerta() {
  const f = S.fire, d = IG.dist(f, S.yo), r = IG.rumbo(S.yo, f);
  $('#al-nivel').textContent = S.nivel === 'peligro' ? 'PELIGRO' : 'PRECAUCIÓN';
  $('#al-km').textContent = d.toFixed(1);
  $('#al-flecha').style.transform = `rotate(${r}deg)`;
  $('#al-dir').textContent = `El fuego está al ${IG.cardinal(r)} de ti`;
  const c = f.ctx;
  $('#al-viento').textContent = `Viento ${Math.round(c.viento_kmh)} km/h hacia el ${IG.cardinal((c.viento_desde + 180) % 360)}` +
    (IG.difAng(f.prop.rumbo, IG.rumbo(f, S.yo)) < 60 ? ' · el fuego avanza hacia ti' : '');
}
function dibujarRuta() {
  if (capaRuta) mapa.removeLayer(capaRuta);
  const s = IG.salida(S.fire, S.yo); S.salidaRuta = s;
  capaRuta = L.polyline([[S.yo.lat, S.yo.lon], [s.destino.lat, s.destino.lon]],
    { color: '#22c55e', weight: 5, opacity: .95, dashArray: '10 8' }).addTo(mapa);
}
function limpiar() {
  S.fire = null; clearTimeout(S.timer); clearInterval(S.cuenta); $('#pre').classList.add('oculto');
  IG.toast('Incendio controlado. Fin de la alerta', 'ok');
  [capaFuego, capaRadio, capaCono, capaRuta, capaFrente].forEach(c => c && mapa.removeLayer(c)); $('#ruta-card').classList.add('oculto');
  $('#s-alerta').className = 'alerta oculto'; estado('ok', 'Conectado · sin alertas');
}

// ---------------------------------------------------------------- botones de la alerta
$('#btn-ruta').onclick = () => {
  $('#s-alerta').classList.add('oculto');
  const s = S.salidaRuta || IG.salida(S.fire, S.yo);
  mapa.fitBounds([[S.yo.lat, S.yo.lon], [s.destino.lat, s.destino.lon], [S.fire.lat, S.fire.lon]], { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.round(innerHeight * .55)] });
  $('#ruta-card').classList.remove('oculto');
  $('#ruta-card').innerHTML = (`
    <p class="hoja-titulo" style="color:#22c55e">Ruta de salida</p>
    <p class="grande">Avanza hacia el <b>${IG.cardinal(s.rumbo)}</b> al menos <b>${s.km.toFixed(0)} km</b>.</p>
    <p>${s.motivo}</p>
    <a class="btn-primario" target="_blank" href="https://www.google.com/maps/dir/?api=1&origin=${S.yo.lat},${S.yo.lon}&destination=${s.destino.lat.toFixed(5)},${s.destino.lon.toFixed(5)}&travelmode=driving">Abrir ruta en Google Maps</a>
    <p class="nota">La línea verde es la dirección segura. Sigue siempre las indicaciones de Protección Civil.</p>
    <button class="btn-sec" onclick="mostrarAlertaDeNuevo()">Volver a la alerta</button>`);
};
function mostrarAlertaDeNuevo() { llenarAlerta(); $('#s-alerta').className = 'alerta ' + S.nivel; }
$('#btn-que').onclick = () => { $('#s-alerta').classList.add('oculto'); abrirPanel(S.rol === 'brigadista' ? queBrigada() : queUsuario()); };
$('#btn-salvo').onclick = () => { $('#s-alerta').classList.add('oculto'); estado('ok', 'Marcado a salvo'); enviar({ type: 'safe' }); IG.toast('Avisamos a los brigadistas que estás a salvo', 'ok'); };
document.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => $('#' + b.dataset.cerrar).classList.add('oculto'));
function abrirPanel(html) { $('#que-contenido').innerHTML = html; $('#s-que').classList.remove('oculto'); }

function queUsuario() {
  return `<h2>Qué hacer ahora</h2>
  <ol class="pasos">
    <li><b>Llama al 911</b> o a CONAFOR <a href="tel:8007370000">800 737 0000</a> y di dónde ves el humo.</li>
    <li><b>Aléjate</b> por la ruta verde. No vayas hacia el humo ni cuesta arriba del fuego: el fuego sube rápido por las laderas.</li>
    <li><b>No intentes apagarlo.</b> Ni quemas ni brechas: eso lo hacen brigadas entrenadas.</li>
    <li>Cubre nariz y boca con un trapo húmedo y cierra ventanas si vas en auto.</li>
    <li>Avisa a tus vecinos y mantén tu teléfono con batería.</li>
  </ol>
  <a class="btn-primario" href="tel:911">Llamar al 911</a>`;
}
function queBrigada() {
  const f = S.fire, c = f.ctx;
  return `<h2>Lectura táctica (orientativa)</h2>
  <div class="datos">${datosFuego(f)}</div>
  <h3>Consideraciones</h3>
  <ul class="pasos">
    <li>Propagación estimada hacia el <b>${IG.cardinal(f.prop.rumbo)}</b> a ~${f.prop.vel_kmh} km/h por viento${c.pendiente_pct ? ' y pendiente' : ''}.</li>
    ${c.pendiente_pct > 15 ? '<li>Pendiente fuerte: el fuego acelera ladera arriba; evitar posiciones por encima del frente.</li>' : ''}
    <li>Ataque indirecto: brechas cortafuego y líneas de control apoyadas en caminos, ríos o zonas sin combustible, por delante del frente.</li>
    <li>La quema de ensanche (contrafuego) solo con personal certificado, mando de incidente y condiciones de viento estables.</li>
    <li>Rutas de escape y zonas seguras definidas antes de entrar (protocolo LACES).</li>
  </ul>
  <p class="nota">Estimación con viento (Open-Meteo) y pendiente (modelo de elevación). No sustituye un modelo operativo de comportamiento del fuego.</p>`;
}
function datosFuego(f) {
  const c = f.ctx, enZona = S.usuarios.filter(u => u.lat != null && IG.dist(f, u) <= f.radio_km && u.role === 'usuario').length;
  return `
    <div><small>Personas en zona</small><b>${enZona}</b></div>
    <div><small>Viento</small><b>${Math.round(c.viento_kmh)} km/h → ${IG.cardinal((c.viento_desde + 180) % 360)}</b></div>
    <div><small>Pendiente</small><b>${c.pendiente_pct != null ? c.pendiente_pct + '%' : 'sin dato'}</b></div>
    <div><small>Cuesta arriba hacia</small><b>${c.cuesta_arriba != null ? IG.cardinal(c.cuesta_arriba) : 'sin dato'}</b></div>
    <div><small>Elevación</small><b>${c.elevacion_m != null ? c.elevacion_m + ' m' : 'sin dato'}</b></div>
    <div><small>Avance simulado</small><b>${f.avance_min} min</b></div>`;
}
function panelBrigada() { if (S.fire) $('#brig-datos').innerHTML = datosFuego(S.fire); else $('#brig-datos').innerHTML = '<p class="nota">Sin incendios activos. Aquí verás terreno, viento y personas en zona.</p>'; }
function dibujarOtros() {
  capaOtros.clearLayers();
  S.usuarios.filter(u => u.lat != null && u.role === 'usuario').forEach(u =>
    L.circleMarker([u.lat, u.lon], { radius: 5, color: u.safe ? '#22c55e' : u.alerted ? '#ff4d2e' : '#60a5fa', weight: 2, fillOpacity: .8 }).addTo(capaOtros));
}

// ---------------------------------------------------------------- sonido
function sirena(seg) {
  const a = S.audio; if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sawtooth'; o.connect(g); g.connect(a.destination);
  const t = a.currentTime; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.35, t + .05);
  for (let i = 0; i < seg * 2; i++) { o.frequency.setValueAtTime(700, t + i * .5); o.frequency.linearRampToValueAtTime(1300, t + i * .5 + .45); }
  g.gain.setValueAtTime(.35, t + seg); g.gain.exponentialRampToValueAtTime(.0001, t + seg + .2);
  o.start(t); o.stop(t + seg + .25);
}
function toque(n) {
  const a = S.audio; if (!a) return;
  for (let i = 0; i < n; i++) {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * .3;
    o.frequency.value = 880; o.connect(g); g.connect(a.destination);
    g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.0001, t + .25); o.start(t); o.stop(t + .3);
  }
}

function pintarFrpZona() {
  const h = S.hist, ok = h && h.available && h.frp_mes && Math.max(...h.frp_mes) > 0;
  $('#hist-frp').classList.toggle('oculto', !ok); if (!ok) return;
  IG.graf.serie($('#hist-frp-cv'), {
    etiquetas: IG.MESES, alto: 140, marcar: h.mes - 1,
    series: [{ nombre: 'FRP típico (MW)', valores: h.frp_mes, color: '#ff5a1f', tipo: 'area' }],
    formato: i => `<b>${IG.MESES_L[i]} típico</b><span><i style="background:#ff5a1f"></i>${IG.graf.fmt(h.frp_mes[i])} MW de intensidad</span>${i + 1 === h.frp_pico ? '<span class="tenue">el mes en que más fuerte arde</span>' : ''}`,
  });
}
window.addEventListener('ignis-tema', () => { if (S.hist && S.hist.available) { IG.dibujarCalendario($('#hist-cal'), S.hist.matriz, S.hist.mes); pintarFrpZona(); } });
