// IGNIS · capa "wow": efectos reutilizables en JS puro (sin librerías, funciona sin internet).
// Inspirado en React Bits (Split/Blur Text, Click Spark, Spotlight Card, Count Up) recreado en vanilla.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = window.WOW = { RM };

  // ---------------------------------------------------------------- texto letra por letra
  W.split = el => {
    if (!el || el.dataset.split === 'ok') return;
    const txt = el.textContent.trim(); let i = 0;
    el.setAttribute('aria-label', txt);
    el.innerHTML = txt.split(/\s+/).map(p => `<span class="sp-w" aria-hidden="true">${[...p].map(c => `<span class="sp-c" style="--i:${i++}">${c}</span>`).join('')}</span>`).join(' ');
    el.dataset.split = 'ok';
  };
  W.revelar = el => { if (!el) return; el.classList.remove('ver'); void el.offsetWidth; el.classList.add('ver'); };
  document.querySelectorAll('[data-split]').forEach(W.split);

  // ---------------------------------------------------------------- chispas al tocar
  const SEL_CHISPA = '.btn-primario, .btn-blanco, .rol, .tl-play, .btn-sig, .tabs button, [data-spark]';
  document.addEventListener('pointerdown', e => {
    if (RM) return;
    const t = e.target.closest(SEL_CHISPA); if (!t || t.disabled) return;
    const s = document.createElement('div'); s.className = 'spark';
    s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.innerHTML = '<i></i>'.repeat(8);
    document.body.appendChild(s); setTimeout(() => s.remove(), 650);
  }, { passive: true });

  // ---------------------------------------------------------------- foco de luz que sigue al puntero
  let pend = null;
  document.addEventListener('pointermove', e => {
    if (pend) return;
    pend = requestAnimationFrame(() => {
      pend = null;
      const t = e.target.closest && e.target.closest('.spot'); if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }, { passive: true });

  // ---------------------------------------------------------------- transición de ignición
  W.encender = (x, y) => new Promise(res => {
    if (RM) return res();
    const d = document.createElement('div'); d.className = 'ignicion';
    d.style.setProperty('--x', x + 'px'); d.style.setProperty('--y', y + 'px');
    document.body.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('va')));
    setTimeout(() => { res(); setTimeout(() => d.classList.add('sale'), 120); setTimeout(() => d.remove(), 900); }, 700);
  });

  // ---------------------------------------------------------------- número que corre
  W.correr = (el, hasta, dec = 0, ms = 900) => {
    if (!el || isNaN(hasta)) return;
    el.textContent = hasta.toFixed(dec);   // valor final de inmediato; luego la animación
    if (RM) return;
    const t0 = performance.now();
    const paso = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
      el.textContent = (hasta * e).toFixed(dec);
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
  W.bump = el => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  // ---------------------------------------------------------------- brasas que suben (canvas)
  W.brasas = cv => {
    if (RM || !cv) return () => {};
    const cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), P = [];
    let w = 0, h = 0, vivo = true;
    const medir = () => { const r = cv.getBoundingClientRect(); w = cv.width = Math.max(1, r.width * dpr); h = cv.height = Math.max(1, r.height * dpr); };
    const nueva = y => ({ x: Math.random() * w, y: y ?? h + 10 * dpr, r: (.5 + Math.random() * 1.6) * dpr, vy: (.25 + Math.random() * .9) * dpr,
      f: Math.random() * 6.28, df: .02 + Math.random() * .03, a: .35 + Math.random() * .65 });
    medir(); addEventListener('resize', medir);
    const n = innerWidth < 600 ? 34 : 60;
    for (let i = 0; i < n; i++) P.push(nueva(Math.random() * h));
    const paso = () => {
      if (!vivo) return;
      cx.clearRect(0, 0, w, h); cx.globalCompositeOperation = 'lighter';
      for (const p of P) {
        p.f += p.df; p.y -= p.vy; p.x += Math.sin(p.f) * .45 * dpr;
        if (p.y < -12 * dpr) Object.assign(p, nueva());
        const a = p.a * Math.min(1, (p.y / h) * 1.5) * (.75 + .25 * Math.sin(p.f * 3)), R = p.r * 4;
        const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        g.addColorStop(0, `rgba(255,214,140,${a})`); g.addColorStop(.35, `rgba(255,120,40,${a * .55})`); g.addColorStop(1, 'rgba(255,80,20,0)');
        cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, R, 0, 6.2832); cx.fill();
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => { vivo = false; removeEventListener('resize', medir); };
  };

  // ---------------------------------------------------------------- hoja inferior arrastrable (celular)
  const hoja = document.getElementById('hoja'), asa = hoja && hoja.querySelector('.asa');
  if (hoja && asa) {
    let y0 = null, base = 0, dy = 0, movio = false;
    const tope = () => hoja.offsetHeight - 92;
    asa.addEventListener('pointerdown', e => {
      if (innerWidth >= 900) return;
      y0 = e.clientY; dy = 0; movio = false; base = hoja.classList.contains('plegada') ? tope() : 0;
      try { asa.setPointerCapture(e.pointerId); } catch (_) {}
    });
    asa.addEventListener('pointermove', e => {
      if (y0 == null) return;
      dy = e.clientY - y0; if (Math.abs(dy) > 6) movio = true;
      if (!movio) return;
      hoja.classList.add('arrastrando');
      hoja.style.transform = `translateY(${Math.max(0, Math.min(tope(), base + dy))}px)`;
    });
    const soltar = () => {
      if (y0 == null) return;
      y0 = null; hoja.classList.remove('arrastrando'); hoja.style.transform = '';
      if (movio) hoja.classList.toggle('plegada', base + dy > tope() / 2);
    };
    asa.addEventListener('pointerup', soltar); asa.addEventListener('pointercancel', soltar);
    document.addEventListener('click', e => { if (movio && e.target.closest('.asa')) { e.stopImmediatePropagation(); movio = false; } }, true);
  }

  // ---------------------------------------------------------------- alerta: la distancia corre al aparecer
  const al = document.getElementById('s-alerta');
  if (al) new MutationObserver(() => {
    const visible = !al.classList.contains('oculto');
    if (visible && !al.dataset.vivo) {
      al.dataset.vivo = '1';
      const km = document.getElementById('al-km'); W.correr(km, parseFloat(km.textContent), 1, 1100);
    } else if (!visible) delete al.dataset.vivo;
  }).observe(al, { attributes: true, attributeFilter: ['class'] });

  // ---------------------------------------------------------------- "Estoy a salvo": palomita que se dibuja + confeti verde
  W.confeti = cv => {
    if (RM || !cv) return;
    const cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.width = innerWidth * dpr, h = cv.height = innerHeight * dpr;
    const COL = ['#22c55e', '#4ade80', '#86efac', '#ffffff', '#facc15', '#16a34a'];
    const P = Array.from({ length: innerWidth < 600 ? 110 : 170 }, () => {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = (8 + Math.random() * 12) * dpr;
      return { x: w / 2, y: h * .42, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.3, vr: (Math.random() - .5) * .4,
        s: (5 + Math.random() * 7) * dpr, c: COL[Math.random() * COL.length | 0], f: Math.random() * 6.3 };
    });
    const t0 = performance.now();
    const paso = now => {
      const t = now - t0; cx.clearRect(0, 0, w, h);
      for (const p of P) {
        p.vy += .38 * dpr; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.f += .2;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.cos(p.f));
        cx.globalAlpha = Math.max(0, 1 - t / 2600); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
      }
      if (t < 2600) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
  W.celebrar = () => {
    document.querySelector('.salvo-cel')?.remove();
    const d = document.createElement('div'); d.className = 'salvo-cel'; d.setAttribute('role', 'status');
    d.innerHTML = `<canvas aria-hidden="true"></canvas><div class="sc-caja">
      <svg class="sc-ico" viewBox="0 0 52 52" aria-hidden="true"><circle class="sc-c" cx="26" cy="26" r="23"/><path class="sc-p" d="M15 27.5l7.5 7.5L38 19"/></svg>
      <h2>Estás a salvo</h2><p>Avisamos a los brigadistas y al centro de control.</p><small>Toca para cerrar</small></div>`;
    document.body.appendChild(d);
    if (navigator.vibrate) navigator.vibrate([30, 60, 30, 60, 90]);
    W.confeti(d.querySelector('canvas'));
    const cerrar = () => { d.classList.add('sale'); setTimeout(() => d.remove(), 450); };
    d.onclick = cerrar; setTimeout(cerrar, 3800);
  };
  // ---------------------------------------------------------------- modo app: pantalla completa (celular) y pantalla encendida
  let candado = null;
  const pedirCandado = async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { candado = await navigator.wakeLock.request('screen'); } catch (e) {}
  };
  W.modoApp = () => {
    const tactil = matchMedia('(pointer: coarse)').matches, instalada = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
    if (tactil && !instalada && !document.fullscreenElement && document.documentElement.requestFullscreen)
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    pedirCandado();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (!candado || candado.released)) pedirCandado(); });
  };
  const bs = document.getElementById('btn-salvo');
  if (bs) bs.addEventListener('click', W.celebrar);
})();
