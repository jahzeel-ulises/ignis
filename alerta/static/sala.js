// IGNIS · Sala en vivo (centro de control):
//  1. Pared de asistentes: cada celular que entra aparece como burbuja con su nombre y un sonido.
//     Se pone roja cuando le llega la alerta y verde cuando marca "Estoy a salvo".
//  2. Marcador para el proyector: "N/M personas alertadas en X s" y la llegada de la onda en una línea de tiempo.
// Se engancha a las funciones del control (pintarUsuarios, lanzarOnda) sin cambiar su lógica.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  const cont = document.getElementById('mapa');

  // ---------------------------------------------------------------- piezas en pantalla
  const sala = document.createElement('div'); sala.className = 'sala vacia';
  sala.innerHTML = `<div class="sala-cab"><span class="sala-vivo"></span><b>En la sala</b><span id="sala-n" class="sala-n">0</span><small>Escanea el QR para aparecer aquí</small></div>
    <div class="sala-burbujas" id="sala-b" aria-live="polite"></div>`;
  const marc = document.createElement('div'); marc.className = 'marcador oculto'; marc.setAttribute('aria-live', 'polite');
  marc.innerHTML = `
    <div class="mc-fila">
      <div class="mc-num"><b id="mc-al">0</b><span>/<i id="mc-tot">0</i></span></div>
      <div class="mc-txt"><p>personas alertadas</p><p class="mc-t">la última en <b id="mc-s">—</b></p></div>
      <svg class="mc-anillo" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" class="mc-base"/><circle cx="22" cy="22" r="19" class="mc-prog" id="mc-prog"/></svg>
    </div>
    <div class="mc-onda" aria-hidden="true"><div class="mc-eje" id="mc-eje"><i class="mc-cursor" id="mc-cursor"></i></div>
      <div class="mc-esc"><span>0 s</span><span>llegada de la onda</span><span id="mc-max">10 s</span></div></div>
    <div class="mc-pie"><span class="mc-salvo"><b id="mc-sal">0</b> a salvo</span><span id="mc-cron">0.0 s desde el lanzamiento</span></div>`;
  const proy = document.createElement('button'); proy.className = 'btn-proy'; proy.type = 'button'; proy.title = 'Pantalla completa (proyector)';
  proy.setAttribute('aria-label', 'Pantalla completa');
  proy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  proy.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
  const ver3d = document.createElement('a'); ver3d.className = 'btn-proy btn-3d'; ver3d.href = '/static/3d.html'; ver3d.target = '_blank'; ver3d.rel = 'noopener';
  ver3d.title = 'Ver 24 años de fuego en 3D'; ver3d.textContent = '3D';
  const verEv = document.createElement('a'); verEv.className = 'btn-proy btn-3d btn-ev'; verEv.href = '/eventos'; verEv.target = '_blank'; verEv.rel = 'noopener';
  verEv.title = 'Incendios reconstruidos día por día'; verEv.setAttribute('aria-label', verEv.title);
  verEv.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><use href="#i-flame"/></svg>';
  cont.append(sala, marc, proy, ver3d, verEv);
  [sala, marc, proy, ver3d, verEv].forEach(el => { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); });

  // ---------------------------------------------------------------- sonidos (se activan con el primer toque en la página)
  let ac = null;
  const activarAudio = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} };
  addEventListener('pointerdown', activarAudio);
  function tono(frecs, dur, tipo = 'sine', vol = .12) {
    if (!ac || ac.state !== 'running') return;
    frecs.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * dur * .8;
      o.type = tipo; o.frequency.setValueAtTime(f, t); o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.start(t); o.stop(t + dur + .02);
    });
  }
  const sonido = { entra: () => tono([523, 784], .11), alerta: () => tono([330], .14, 'square', .05), salvo: () => tono([659, 880, 1319], .16, 'triangle', .1) };

  // ---------------------------------------------------------------- pared de asistentes
  const burb = {}, llegada = {};
  let fuegoId = null, crono = null;
  const iniciales = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(p => [...p][0] || '').join('').toUpperCase() || '?';
  const tonoColor = n => [...(n || '')].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 17);
  function chispasEn(el, clase) {
    if (RM) return;
    const r = el.getBoundingClientRect(), s = document.createElement('div');
    s.className = 'spark ' + clase; s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top + r.height / 2 + 'px';
    s.innerHTML = '<i></i>'.repeat(8); document.body.appendChild(s); setTimeout(() => s.remove(), 650);
  }
  function pared() {
    const vivos = new Set(), caja = $('#sala-b');
    usuarios.forEach(u => {
      vivos.add(u.id);
      let b = burb[u.id];
      if (!b) {
        const el = document.createElement('div'); el.className = 'burbuja';
        el.style.setProperty('--h', tonoColor(u.name));
        el.innerHTML = `<span class="bb-av">${IG.esc(iniciales(u.name))}</span><span class="bb-n">${IG.esc(u.name)}</span>` +
          (u.role === 'brigadista' ? '<svg class="bb-rol" aria-label="especializado"><use href="#i-shield"/></svg>' : '');
        caja.appendChild(el); b = burb[u.id] = { el, e: null };
        sonido.entra();
      }
      const e = u.safe ? 'salvo' : u.alerted ? 'alerta' : u.lat == null ? 'sin' : 'ok';
      if (e !== b.e) {
        b.el.dataset.e = e;
        if (e === 'alerta') { sonido.alerta(); if (window.t0Onda && !(u.id in llegada)) llegada[u.id] = (performance.now() - t0Onda) / 1000; }
        if (e === 'salvo') { sonido.salvo(); chispasEn(b.el, 'verde'); if (!(u.id in llegada) && window.t0Onda) llegada[u.id] = (performance.now() - t0Onda) / 1000; }
        b.e = e;
      }
      b.el.title = `${u.name}${u.dist_km != null ? ' · ' + u.dist_km + ' km' : ''}${u.id in llegada ? ' · ' + llegada[u.id].toFixed(1) + ' s' : ''}`;
    });
    Object.keys(burb).forEach(id => {
      if (vivos.has(id)) return;
      const el = burb[id].el; delete burb[id];
      el.classList.add('sale'); setTimeout(() => el.remove(), 450);
    });
    const n = $('#sala-n');
    if (n.textContent !== String(usuarios.length)) { n.textContent = usuarios.length; WOW.bump(n); }
    sala.classList.toggle('vacia', !usuarios.length);
  }

  // ---------------------------------------------------------------- marcador del proyector
  const CIRC = 2 * Math.PI * 19;
  const mostrado = { al: 0, sal: 0 };
  function correrA(el, clave, valor) {
    if (mostrado[clave] === valor) return;
    const de = mostrado[clave]; mostrado[clave] = valor;
    if (RM) { el.textContent = valor; return; }
    const t0 = performance.now();
    const paso = now => { const k = Math.min(1, (now - t0) / 500); el.textContent = Math.round(de + (valor - de) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso); WOW.bump(el);
  }
  function marcador() {
    if (!fuego) { marc.classList.add('oculto'); cancelAnimationFrame(crono); crono = null; return; }
    if (fuego.id !== fuegoId) {   // incendio nuevo: reinicia el marcador
      fuegoId = fuego.id; Object.keys(llegada).forEach(k => delete llegada[k]);
      $('#mc-eje').querySelectorAll('.mc-p').forEach(p => p.remove());
      mostrado.al = mostrado.sal = 0; $('#mc-al').textContent = '0'; $('#mc-sal').textContent = '0';
      marc.classList.remove('oculto', 'entra'); void marc.offsetWidth; marc.classList.add('entra');
    }
    const conUbic = usuarios.filter(u => u.lat != null), al = usuarios.filter(u => u.alerted).length, sal = usuarios.filter(u => u.safe).length;
    const tot = Math.max(conUbic.length, al);
    $('#mc-tot').textContent = tot;
    correrA($('#mc-al'), 'al', al); correrA($('#mc-sal'), 'sal', sal);
    $('#mc-prog').style.strokeDashoffset = CIRC * (1 - (tot ? al / tot : 0));
    marc.classList.toggle('completo', tot > 0 && al === tot);
    const tiempos = Object.values(llegada), ultimo = tiempos.length ? Math.max(...tiempos) : null;
    $('#mc-s').textContent = ultimo != null ? ultimo.toFixed(1) + ' s' : '—';
    const max = Math.max(5, Math.ceil((ultimo || 0) + 1), Math.ceil(Math.max(0, ...conUbic.map(u => IG.dist(fuego, u))) / (fuego.onda_kms || 2)) + 1);
    $('#mc-max').textContent = max + ' s';
    marc.dataset.max = max;
    const eje = $('#mc-eje');
    Object.entries(llegada).forEach(([id, t]) => {
      let p = eje.querySelector(`[data-id="${id}"]`);
      if (!p) { p = document.createElement('i'); p.className = 'mc-p'; p.dataset.id = id; eje.appendChild(p); }
      const u = usuarios.find(x => x.id === id);
      p.style.left = (100 * t / max) + '%'; p.classList.toggle('salvo', !!(u && u.safe));
      p.title = u ? `${u.name} · ${t.toFixed(1)} s` : `${t.toFixed(1)} s`;
    });
    if (!crono) crono = requestAnimationFrame(tic);
  }
  function tic() {
    if (!fuego || !window.t0Onda) { crono = null; return; }
    const s = (performance.now() - t0Onda) / 1000, max = +marc.dataset.max || 10;
    $('#mc-cron').textContent = `${s.toFixed(1)} s desde el lanzamiento`;
    $('#mc-cursor').style.left = Math.min(100, 100 * s / max) + '%';
    $('#mc-cursor').classList.toggle('fin', s > max);
    crono = s < 600 ? requestAnimationFrame(tic) : null;
  }

  // ---------------------------------------------------------------- enganche con el control
  const pintarOriginal = pintarUsuarios;
  pintarUsuarios = function () { pintarOriginal(); pared(); marcador(); };
  const ondaOriginal = lanzarOnda;
  lanzarOnda = function (f) {
    ondaOriginal(f); fuego = f; marcador();
    if (mapa.getZoom() < 10) mapa.flyTo([f.lat, f.lon], 10, { duration: RM ? 0 : 1.4 });   // acerca el foco para que se vea el frente
  };
  pared();
})();
