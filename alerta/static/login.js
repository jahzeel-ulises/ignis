// Login + portada: 24 años de fuego en México, mes a mes, con datos armonizados reales.
(() => {
  const $ = s => document.querySelector(s);
  let rol = 'usuario';

  // ---------- perfil
  document.querySelectorAll('.rol').forEach(b => b.onclick = () => {
    document.querySelectorAll('.rol').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-checked', x === b); });
    rol = b.dataset.rol;
    $('#cred').classList.toggle('oculto', rol !== 'brigadista');
    if (rol === 'brigadista') setTimeout(() => $('#codigo').focus(), 50);
  });

  // ---------- envío
  $('#login').onsubmit = async e => {
    e.preventDefault();
    WOW.modoApp();   // en el mismo toque: pantalla completa en celular y pantalla siempre encendida
    try { window.__audio = new (window.AudioContext || window.webkitAudioContext)(); window.__audio.resume(); } catch (_) {}
    const btn = $('#btn-entrar'); btn.classList.add('cargando'); btn.disabled = true; $('#login-error').textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nombre: $('#nombre').value, rol, codigo: $('#codigo').value }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo entrar');
      const r0 = btn.getBoundingClientRect();
      await WOW.encender(r0.left + r0.width / 2, r0.top + r0.height / 2);   // el botón "enciende" la pantalla
      if (WOW.RM) { $('#s-inicio').classList.add('saliendo'); setTimeout(() => arrancar(d), 450); } else arrancar(d);
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#login').classList.remove('sacude'); void $('#login').offsetWidth; $('#login').classList.add('sacude');
      btn.classList.remove('cargando'); btn.disabled = false;
    }
  };

  // ---------- personas en línea
  const enLinea = () => fetch('/api/info').then(r => r.json()).then(i => {
    $('#en-linea').textContent = `${i.conectados} ${i.conectados === 1 ? 'persona conectada' : 'personas conectadas'} a esta red`;
  }).catch(() => { $('#en-linea').textContent = 'Sin conexión con el servidor'; });
  enLinea(); const tEnLinea = setInterval(enLinea, 4000);

  // ---------- portada animada
  const cv = $('#tl-canvas'), cx = cv.getContext('2d');
  let T = null, tierra = [], i = 0, vivo = true, ultimo = 0;
  const RAMPA = [[253, 227, 207], [253, 191, 143], [253, 154, 91], [242, 107, 42], [212, 71, 26], [165, 49, 15]];
  const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

  function medir() {
    const r = cv.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
  }
  function proyector() {
    const [w, s, e, n] = [-118.8, 14.2, -86.2, 33.2];
    const kx = Math.cos(23 * Math.PI / 180), W = cv.width, H = cv.height;
    const esc = Math.min(W * .92 / ((e - w) * kx), H * .84 / (n - s));
    const ox = (W - (e - w) * kx * esc) / 2, oy = (H - (n - s) * esc) / 2 - H * .04;
    return (lon, lat) => [ox + (lon - w) * kx * esc, oy + (n - lat) * esc];
  }
  function cuadro(t) {
    if (!vivo) return;
    requestAnimationFrame(cuadro);
    if (!T || t - ultimo < 140) return;
    ultimo = t;
    const P = proyector(), W = cv.width, H = cv.height, dpr = devicePixelRatio;
    cx.globalCompositeOperation = 'source-over';
    cx.fillStyle = 'rgba(10,8,7,0.35)'; cx.fillRect(0, 0, W, H);      // estela del mes anterior
    // costa
    cx.strokeStyle = 'rgba(255,240,225,0.16)'; cx.lineWidth = 1 * dpr;
    tierra.forEach(r => { cx.beginPath(); r.forEach(([x, y], k) => { const [a, b] = P(x, y); k ? cx.lineTo(a, b) : cx.moveTo(a, b); }); cx.stroke(); });
    // fuego del mes
    const [y, m] = T.meses[i], datos = T.datos[i];
    const [x0] = P(-100, 20), [x1] = P(-99.75, 20), lado = Math.max(2, x1 - x0);
    cx.globalCompositeOperation = 'lighter';
    let total = 0;
    for (const [k, v] of datos) {
      total += v;
      const [la, lo] = T.celdas[k], [px, py] = P(lo, la);
      const n = Math.min(5, Math.floor(Math.log1p(v) / Math.log1p(80) * 6)), c = RAMPA[n];
      cx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.35 + n * 0.11})`;
      cx.fillRect(px - lado / 2, py - lado / 2, lado * .92, lado * .92);
    }
    $('#pt-mes').textContent = `${MES[m - 1]} ${y}`;
    $('#pt-sensor').textContent = y < 2012 ? 'MODIS · convertido' : 'VIIRS';
    $('#pt-n').textContent = Math.round(total).toLocaleString('es-MX');
    $('#pt-prog').style.width = `${100 * i / (T.meses.length - 1)}%`;
    i = (i + 1) % T.meses.length;
    if (i === 0) { cx.globalCompositeOperation = 'source-over'; cx.fillStyle = '#0a0807'; cx.fillRect(0, 0, W, H); }
  }
  medir(); addEventListener('resize', medir);
  Promise.all([fetch('/api/timelapse').then(r => r.json()), fetch('/static/tierra.json').then(r => r.json())])
    .then(([t, l]) => { T = t.meses.length ? t : null; tierra = l; }).catch(() => {});
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(cuadro);
  else fetch('/api/timelapse').then(r => r.json()).then(t => { T = t; i = t.meses.findIndex(([y, m]) => y === 2019 && m === 5); vivo = true; cuadro(1e9); vivo = false; });
  // ---------- diapositiva 2: intensidad típica del fuego en México (FRP armonizado, datos reales)
  fetch('/api/frp?w=-118.5&s=14.3&e=-86.5&n=33&desde=2003&hasta=2025').then(r => r.json()).then(f => {
    if (!f.available) return;
    const W = 320, H = 180, iz = 14, de = 14, ar = 26, ab = 24, med = f.clima.media, alto = f.clima.p90, bajo = f.clima.p10;
    const max = Math.max(...alto), X = i => iz + (W - iz - de) * i / 11, Y = v => ar + (H - ar - ab) * (1 - v / max);
    const pts = med.map((v, i) => [X(i), Y(v)]);
    const curva = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
    const banda = alto.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ') + ' ' + bajo.map((v, i) => `L${X(11 - i).toFixed(1)} ${Y(bajo[11 - i]).toFixed(1)}`).join(' ') + ' Z';
    const p = f.mes_pico - 1, [px, py] = pts[p];
    $('#sl-frp').innerHTML = `<defs><linearGradient id="sl-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a1f" stop-opacity=".55"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></linearGradient></defs>
      <path class="sl-banda" d="${banda}"/><path class="sl-area" d="${curva} L${X(11)} ${H - ab} L${X(0)} ${H - ab} Z"/><path class="sl-linea" d="${curva}"/>
      ${MES.map((m, i) => `<text class="sl-mes" x="${X(i).toFixed(1)}" y="${H - 6}">${m[0]}</text>`).join('')}
      <g class="sl-pico"><circle class="halo" cx="${px}" cy="${py}" r="9"/><circle cx="${px}" cy="${py}" r="4.5"/><text x="${px}" y="${py - 14}">${MES[p].toLowerCase()}</text></g>`;
    const temp = f.meses_temporada.slice().sort((a, b) => a - b).map(m => MES[m - 1].toLowerCase());
    $('#sl-frp-txt').innerHTML = `La potencia radiada (FRP) de cada incendio, armonizada MODIS→VIIRS. En México, <b>${temp[0]}–${temp[temp.length - 1]}</b> concentran el <b>${f.pct_temporada}%</b> de la intensidad del año.`;
  }).catch(() => {});

  // ---------- día / noche también antes de entrar
  IG.tema();

  // ---------- slides: deslizar, puntos tipo "historias", teclado y avance automático
  const esc = $('#escenario'), sl = $('#slides'), slides = [...sl.children], puntos = [...document.querySelectorAll('.puntos button')];
  const sig = $('#btn-sig'), DUR = 7000;
  let actual = -1, auto = null, tocado = false;
  function marcar(k) {
    if (k === actual || k < 0 || k >= slides.length) return;
    actual = k; esc.dataset.i = k;
    slides.forEach((s, j) => { s.classList.toggle('actual', j === k); s.setAttribute('aria-hidden', j !== k); });
    puntos.forEach((p, j) => { p.classList.toggle('actual', j === k); p.classList.toggle('hecho', j < k); p.setAttribute('aria-selected', j === k);
      const i = p.querySelector('i'); i.style.animation = 'none'; void i.offsetWidth; i.style.animation = ''; });
    WOW.revelar(slides[k].querySelector('[data-split]'));
    const fin = k === slides.length - 1;
    sig.classList.toggle('final', fin); sig.querySelector('span').textContent = fin ? 'Entrar' : 'Siguiente';
    programar();
  }
  const ir = (k, suave = true) => sl.scrollTo({ left: k * sl.clientWidth, behavior: suave && !WOW.RM ? 'smooth' : 'auto' });
  function programar() {
    clearTimeout(auto);
    if (WOW.RM || tocado || !vivo) { esc.classList.add('pausa'); return; }
    esc.classList.remove('pausa'); esc.style.setProperty('--dur', DUR + 'ms');
    auto = setTimeout(() => ir((actual + 1) % slides.length), DUR);
  }
  let pend = null;
  sl.addEventListener('scroll', () => { if (pend) return; pend = requestAnimationFrame(() => { pend = null; marcar(Math.round(sl.scrollLeft / sl.clientWidth)); }); }, { passive: true });
  const parar = () => { tocado = true; programar(); };
  sl.addEventListener('pointerdown', parar, { passive: true }); sl.addEventListener('wheel', parar, { passive: true });
  puntos.forEach((p, j) => p.onclick = () => { parar(); ir(j); });
  sl.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { parar(); ir(Math.min(slides.length - 1, actual + 1)); }
    if (e.key === 'ArrowLeft') { parar(); ir(Math.max(0, actual - 1)); }
  });
  const alFormulario = () => { parar(); $('#login').scrollIntoView({ behavior: WOW.RM ? 'auto' : 'smooth' }); setTimeout(() => $('#nombre').focus({ preventScroll: true }), 600); };
  sig.onclick = () => actual === slides.length - 1 ? alFormulario() : (parar(), ir(actual + 1));
  $('#btn-saltar').onclick = alFormulario;
  addEventListener('resize', () => ir(actual, false));
  marcar(0);
  WOW.revelar($('#login h1'));

  const pararBrasas = WOW.brasas($('#brasas'));
  window.pararPortada = () => { vivo = false; clearInterval(tEnLinea); clearTimeout(auto); pararBrasas(); };
})();
