// IGNIS · Tarjeta "Mi zona en la historia": una imagen 1080×1350 lista para redes,
// con los datos reales de la zona y su calendario de fuego. Se genera en el celular (canvas), sin servidor.
(() => {
  const $ = s => document.querySelector(s);
  const btn = $('#btn-tarjeta'); if (!btn) return;

  // el botón aparece cuando la zona tiene historia
  const original = cargarHistoria;
  cargarHistoria = async function () { await original(); btn.classList.toggle('oculto', !(S.hist && S.hist.available)); };

  const LLAMA = new Path2D('M12.3 2.2c.9 3.2-1.7 4.7-1.7 7.4 0 1.6 1.2 2.8 2.7 2.8 2 0 2.8-1.8 2.3-3.7 2.3 1.9 3.6 4.2 3.6 6.6A7.2 7.2 0 0 1 4.8 15.3c0-4.3 3.9-6.3 7.5-13.1z');
  const coord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
  function lineas(cx, txt, ancho) {
    const out = []; let l = '';
    txt.split(' ').forEach(p => { const t = l ? l + ' ' + p : p; if (cx.measureText(t).width > ancho && l) { out.push(l); l = p; } else l = t; });
    if (l) out.push(l); return out;
  }

  async function dibujar() {
    await document.fonts.ready;
    const h = S.hist, claro = document.documentElement.dataset.theme === 'light';
    const C = claro ? { fondo: '#f6f4f1', tinta: '#1c1917', t2: '#44403c', tenue: '#78716c', caja: '#ffffff', borde: '#e7e0d6' }
                    : { fondo: '#0c0a09', tinta: '#fff6ef', t2: '#e2d4ca', tenue: '#a8a29e', caja: '#1c1917', borde: '#3a3633' };
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.fillStyle = C.fondo; cx.fillRect(0, 0, W, H);
    const g = cx.createRadialGradient(W * .85, -60, 0, W * .85, -60, 900); g.addColorStop(0, '#ff6a2b55'); g.addColorStop(1, '#ff6a2b00');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    const g2 = cx.createRadialGradient(W * .1, H + 80, 0, W * .1, H + 80, 800); g2.addColorStop(0, '#ffb02033'); g2.addColorStop(1, '#ffb02000');
    cx.fillStyle = g2; cx.fillRect(0, 0, W, H);

    // marca
    cx.save(); cx.translate(80, 72); cx.scale(2.4, 2.4); cx.fillStyle = '#e8561f'; cx.fill(LLAMA); cx.restore();
    cx.fillStyle = C.tinta; cx.font = "700 46px 'IBM Plex Sans Condensed', sans-serif"; cx.textBaseline = 'middle'; cx.fillText('IGNIS', 152, 102);
    cx.fillStyle = C.tenue; cx.font = "500 24px 'IBM Plex Mono', monospace"; cx.textAlign = 'right';
    cx.fillText(`${coord(S.yo.lat, 'N', 'S')} · ${coord(S.yo.lon, 'E', 'O')}`, W - 80, 102); cx.textAlign = 'left';

    // título
    cx.fillStyle = C.tinta; cx.font = "700 96px 'IBM Plex Sans Condensed', sans-serif"; cx.textBaseline = 'alphabetic';
    cx.fillText('Mi zona en', 80, 270); cx.fillText('la historia', 80, 366);
    cx.fillStyle = '#e8561f'; cx.fillRect(80, 398, 120, 8);

    // cifras
    const mes = IG.MESES_L[h.mes - 1], cajas = [
      [String(Math.round(h.media_mes)), `eventos de fuego en un ${mes} típico`],
      [h.pct_anual_en_mes + '%', `del fuego del año cae en ${mes}`],
      [h.cada_cuantos_anios ? `1 de ${h.cada_cuantos_anios}` : '—', `años tiene un ${mes} con el doble de lo normal`],
      [String(h.max_mes.anio), `${mes} récord (${h.max_mes.valor} eventos)`],
    ];
    cajas.forEach(([n, t], i) => {
      const x = 80 + (i % 2) * 470, y = 450 + Math.floor(i / 2) * 200;
      cx.fillStyle = C.caja; cx.strokeStyle = C.borde; cx.lineWidth = 2;
      cx.beginPath(); cx.roundRect(x, y, 450, 180, 22); cx.fill(); cx.stroke();
      cx.fillStyle = i === 0 ? '#e8561f' : C.tinta; cx.font = "700 76px 'IBM Plex Sans Condensed', sans-serif"; cx.fillText(n, x + 30, y + 90);
      cx.fillStyle = C.t2; cx.font = "500 26px 'IBM Plex Sans', sans-serif";
      lineas(cx, t, 390).slice(0, 2).forEach((l, k) => cx.fillText(l, x + 30, y + 132 + k * 32));
    });

    // calendario real de la zona
    cx.fillStyle = C.tenue; cx.font = "500 24px 'IBM Plex Mono', monospace";
    cx.fillText(`CALENDARIO DE FUEGO · ${h.matriz.anios[0]}–${h.matriz.anios[h.matriz.anios.length - 1]} · AÑO × MES`, 80, 900);
    const cal = document.createElement('canvas'); cal.width = 920; cal.height = 300;
    IG.dibujarCalendario(cal, h.matriz, h.mes);
    cx.drawImage(cal, 80, 920);

    // pie
    cx.fillStyle = C.tenue; cx.font = "500 22px 'IBM Plex Mono', monospace";
    cx.fillText('NASA FIRMS · serie armonizada MODIS→VIIRS (eventos ≥20 MW)', 80, 1268);
    cx.fillText('IGNIS Alerta · NASA Space Apps Challenge 2026', 80, 1302);
    return cv;
  }

  function cerrar(m) { m.classList.add('sale'); setTimeout(() => m.remove(), 350); }
  btn.onclick = async () => {
    btn.classList.add('cargando');
    const cv = await dibujar();
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    btn.classList.remove('cargando');
    const url = URL.createObjectURL(blob), archivo = new File([blob], 'ignis_mi_zona.png', { type: 'image/png' });
    const puedeCompartir = navigator.canShare && navigator.canShare({ files: [archivo] });
    const m = document.createElement('div'); m.className = 'tarjeta-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Tarjeta de mi zona');
    m.innerHTML = `<div class="tm-caja"><img class="tm-img" src="${url}" alt="Tarjeta: mi zona en la historia de fuego">
      <div class="tm-botones">${puedeCompartir ? '<button class="btn-primario" data-a="compartir">Compartir</button>' : ''}
      <a class="${puedeCompartir ? 'btn-sec' : 'btn-primario'}" href="${url}" download="ignis_mi_zona.png">Descargar imagen</a>
      <button class="btn-sec" data-a="cerrar">Cerrar</button></div></div>`;
    document.body.appendChild(m);
    m.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (e.target === m || (a && a.dataset.a === 'cerrar')) cerrar(m);
      if (a && a.dataset.a === 'compartir') navigator.share({ files: [archivo], title: 'Mi zona en la historia · IGNIS' }).catch(() => {});
    };
    const img = m.querySelector('.tm-img');   // inclinación 3D con el dedo o el mouse
    m.addEventListener('pointermove', e => {
      if (WOW.RM) return;
      const r = img.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      img.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg)`;
      img.style.setProperty('--gx', (x + .5) * 100 + '%'); img.style.setProperty('--gy', (y + .5) * 100 + '%');
    });
    m.addEventListener('pointerleave', () => { img.style.transform = ''; });
  };
})();
