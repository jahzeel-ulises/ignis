// IGNIS · gráficas interactivas en canvas (sin librerías): línea/área con banda, barras con selección
// de rango arrastrando, calendario con tooltip y mini gráficas SVG para tooltips del mapa.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('es-MX', { maximumFractionDigits: d }));
  const corto = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : fmt(v, v < 10 ? 1 : 0);
  const G = IG.graf = { fmt, corto };

  // ---------------------------------------------------------------- tooltip compartido
  const tip = document.createElement('div'); tip.className = 'graf-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
  G.tip = (html, x, y) => {
    if (!html) { tip.classList.remove('ver'); return; }
    tip.innerHTML = html; tip.classList.add('ver');
    const r = tip.getBoundingClientRect(), m = 10;
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > innerWidth - m) left = x - r.width - 14;
    if (top < m) top = y + 18;
    tip.style.transform = `translate(${Math.max(m, left)}px, ${Math.min(innerHeight - r.height - m, top)}px)`;
  };

  function preparar(cv, alto) {
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth || cv.parentElement.clientWidth, h = alto || cv.clientHeight || 180;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, w, h };
  }
  function animar(dibujar, ms = 900) {
    if (RM) return dibujar(1);
    const t0 = performance.now();
    const paso = now => { const k = Math.min(1, (now - t0) / ms); dibujar(1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  }
  function eventosPuntero(cv, alMover, alSalir) {
    cv.onpointermove = e => { const r = cv.getBoundingClientRect(); alMover(e.clientX - r.left, e.clientY - r.top, e); };
    cv.onpointerleave = () => { G.tip(null); alSalir && alSalir(); };
    cv.onpointerdown = cv.onpointermove;
  }

  // ---------------------------------------------------------------- línea / área / barras con eje doble
  // series: [{ valores, color, tipo: 'area'|'linea'|'barras', eje: 0|1, nombre, banda: {bajo, alto} }]
  G.serie = (cv, { etiquetas, series, alto = 190, marcar = null, formato, ejes = ['', ''] }) => {
    const { c, w, h } = preparar(cv, alto), izq = 40, der = series.some(s => s.eje === 1) ? 38 : 10, arriba = 12, abajo = 24;
    const n = etiquetas.length, iw = w - izq - der, ih = h - arriba - abajo;
    const max = [0, 1].map(e => Math.max(1e-9, ...series.filter(s => (s.eje || 0) === e).flatMap(s => [...s.valores, ...(s.banda ? s.banda.alto : [])])));
    const X = i => izq + (n === 1 ? iw / 2 : iw * i / (n - 1)), Y = (v, e) => arriba + ih * (1 - v / max[e || 0]);
    const tinta = css('--tenue') || '#a8a29e', rejilla = css('--borde') || '#3a3633';
    let hover = null;
    function dibujar(k) {
      c.clearRect(0, 0, w, h);
      c.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace"; c.fillStyle = tinta; c.strokeStyle = rejilla; c.lineWidth = 1;
      for (let g = 0; g <= 3; g++) {
        const y = arriba + ih * g / 3; c.globalAlpha = .5; c.beginPath(); c.moveTo(izq, y); c.lineTo(w - der, y); c.stroke(); c.globalAlpha = 1;
        c.textAlign = 'right'; c.fillText(corto(max[0] * (1 - g / 3)), izq - 6, y + 4);
        if (der > 10) { c.textAlign = 'left'; c.fillText(corto(max[1] * (1 - g / 3)), w - der + 6, y + 4); }
      }
      const paso = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / 46))));
      c.textAlign = 'center';
      etiquetas.forEach((t, i) => { if (i % paso === 0 || i === n - 1 && n < 30) c.fillText(t, X(i), h - 6); });
      c.save(); c.beginPath(); c.rect(izq - 2, 0, (iw + 4) * k, h); c.clip();
      series.forEach(s => {
        const e = s.eje || 0;
        if (s.banda) {
          c.beginPath(); s.banda.alto.forEach((v, i) => i ? c.lineTo(X(i), Y(v, e)) : c.moveTo(X(i), Y(v, e)));
          for (let i = n - 1; i >= 0; i--) c.lineTo(X(i), Y(s.banda.bajo[i], e));
          c.closePath(); c.fillStyle = s.color + '2a'; c.fill();
        }
        if (s.tipo === 'barras') {
          const bw = Math.max(2, iw / n * .62);
          s.valores.forEach((v, i) => { c.fillStyle = s.color + (i === marcar ? 'ff' : 'aa'); const y = Y(v, e); c.beginPath(); c.roundRect(X(i) - bw / 2, y, bw, arriba + ih - y, [3, 3, 0, 0]); c.fill(); });
          return;
        }
        c.beginPath(); s.valores.forEach((v, i) => i ? c.lineTo(X(i), Y(v, e)) : c.moveTo(X(i), Y(v, e)));
        c.lineWidth = 2.2; c.strokeStyle = s.color; c.lineJoin = 'round'; c.stroke();
        if (s.tipo === 'area') {
          c.lineTo(X(n - 1), arriba + ih); c.lineTo(X(0), arriba + ih); c.closePath();
          const g = c.createLinearGradient(0, arriba, 0, arriba + ih); g.addColorStop(0, s.color + '66'); g.addColorStop(1, s.color + '05');
          c.fillStyle = g; c.fill();
        }
      });
      c.restore();
      if (marcar != null && marcar >= 0) { c.strokeStyle = css('--tinta') || '#fff'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(marcar), arriba); c.lineTo(X(marcar), arriba + ih); c.stroke(); c.setLineDash([]); }
      if (hover != null) {
        c.strokeStyle = css('--brasa2') || '#ffb020'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(hover), arriba); c.lineTo(X(hover), arriba + ih); c.stroke();
        series.forEach(s => { if (s.tipo === 'barras') return; c.fillStyle = s.color; c.beginPath(); c.arc(X(hover), Y(s.valores[hover], s.eje || 0), 4, 0, 6.3); c.fill(); });
      }
    }
    animar(dibujar);
    eventosPuntero(cv, (x, y, ev) => {
      const i = Math.max(0, Math.min(n - 1, Math.round((x - izq) / (iw || 1) * (n - 1))));
      if (i !== hover) { hover = i; dibujar(1); }
      G.tip(formato ? formato(i) : `<b>${etiquetas[i]}</b>` + series.map(s => `<span><i style="background:${s.color}"></i>${s.nombre}: ${fmt(s.valores[i], 1)}</span>`).join(''), ev.clientX, ev.clientY);
    }, () => { hover = null; dibujar(1); });
    cv._redibujar = () => dibujar(1);
  };

  // ---------------------------------------------------------------- barras por año con selección de rango (arrastrar)
  G.anios = (cv, { anios, valores, desde, hasta, alto = 150, colorAntes = '#fd9a5b', color = '#f26b2a', formato, alSeleccionar }) => {
    const { c, w, h } = preparar(cv, alto), izq = 6, abajo = 20, n = anios.length, bw = (w - izq * 2) / n, max = Math.max(1, ...valores);
    let sel = [Math.max(0, anios.indexOf(desde)), anios.indexOf(hasta) < 0 ? n - 1 : anios.indexOf(hasta)], arr = null, hover = null;
    const idx = x => Math.max(0, Math.min(n - 1, Math.floor((x - izq) / bw)));
    function dibujar(k = 1) {
      c.clearRect(0, 0, w, h);
      const [a, b] = [Math.min(...sel), Math.max(...sel)];
      c.fillStyle = (css('--brasa') || '#e8561f') + '1c'; c.fillRect(izq + a * bw, 0, (b - a + 1) * bw, h - abajo + 4);
      valores.forEach((v, i) => {
        const bh = (h - abajo - 8) * v / max * k, x = izq + i * bw, dentro = i >= a && i <= b;
        c.fillStyle = (anios[i] < 2012 ? colorAntes : color) + (dentro ? (i === hover ? 'ff' : 'dd') : '44');
        c.beginPath(); c.roundRect(x + 2, h - abajo - bh, Math.max(1, bw - 4), bh, [3, 3, 0, 0]); c.fill();
      });
      c.fillStyle = css('--tenue') || '#a8a29e'; c.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace"; c.textAlign = 'center';
      anios.forEach((y, i) => { if (y % 5 === 0 || i === a || i === b) { c.fillStyle = i === a || i === b ? (css('--tinta') || '#fff') : (css('--tenue') || '#a8a29e'); c.fillText(y, izq + (i + .5) * bw, h - 5); } });
      [a, b].forEach(i => { c.fillStyle = css('--brasa2') || '#ffb020'; c.fillRect(izq + (i === a ? i : i + 1) * bw - 1.5, 2, 3, h - abajo); });
    }
    animar(dibujar, 700);
    cv.style.touchAction = 'pan-y'; cv.style.cursor = 'ew-resize';
    cv.onpointerdown = e => { const r = cv.getBoundingClientRect(); arr = idx(e.clientX - r.left); sel = [arr, arr]; try { cv.setPointerCapture(e.pointerId); } catch (_) {} dibujar(); };
    cv.onpointermove = e => {
      const r = cv.getBoundingClientRect(), i = idx(e.clientX - r.left);
      if (arr != null) { sel = [arr, i]; dibujar(); G.tip(`<b>${anios[Math.min(...sel)]}–${anios[Math.max(...sel)]}</b><span>suelta para analizar este periodo</span>`, e.clientX, e.clientY); return; }
      if (i !== hover) { hover = i; dibujar(); }
      G.tip(formato ? formato(i) : `<b>${anios[i]}</b><span>${fmt(valores[i], 1)}</span>`, e.clientX, e.clientY);
    };
    const soltar = () => { if (arr == null) return; arr = null; G.tip(null); const a = anios[Math.min(...sel)], b = anios[Math.max(...sel)]; alSeleccionar && alSeleccionar(a, b); };
    cv.onpointerup = soltar; cv.onpointercancel = soltar;
    cv.onpointerleave = () => { hover = null; if (arr == null) G.tip(null); dibujar(); };
  };

  // ---------------------------------------------------------------- tooltip para el calendario año × mes
  G.calendario = (cv, formato) => {
    cv.onpointermove = e => {
      const g = cv._geo; if (!g) return;
      const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
      const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
      const j = Math.floor((x - g.izq) / g.cw), i = Math.floor((y - g.arriba) / g.ch);
      if (j < 0 || j > 11 || i < 0 || i >= g.anios.length) return G.tip(null);
      G.tip(formato(g.anios[i], j + 1, g.v[i][j]), e.clientX, e.clientY);
    };
    cv.onpointerleave = () => G.tip(null);
  };

  // ---------------------------------------------------------------- mini gráfica SVG (12 meses) para tooltips
  G.mini = (eventos, frp, marcado) => {
    const W = 180, H = 56, bw = W / 12, me = Math.max(1, ...eventos), mf = Math.max(1, ...frp);
    const barras = eventos.map((v, i) => `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - 12 - (H - 16) * v / me).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${((H - 16) * v / me).toFixed(1)}" rx="1.5" fill="#ffb020" opacity="${i + 1 === marcado ? 1 : .55}"/>`).join('');
    const linea = frp.map((v, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - 12 - (H - 16) * v / mf).toFixed(1)}`).join(' ');
    const meses = 'EFMAMJJASOND'.split('').map((m, i) => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" font-size="8" text-anchor="middle" fill="#a8a29e">${m}</text>`).join('');
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${barras}<polyline points="${linea}" fill="none" stroke="#ff5a1f" stroke-width="2" stroke-linejoin="round"/>${meses}</svg>
      <span class="mini-ley"><i style="background:#ffb020"></i>eventos <i style="background:#ff5a1f"></i>intensidad FRP</span>`;
  };
})();
