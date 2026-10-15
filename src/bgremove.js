// Remoção de fundo para estampas (fundo de cor sólida), 100% no navegador.
// "borda": apaga só o fundo ligado às bordas (preserva o miolo das letras).
// "cor": apaga essa cor em toda a arte (inclusive dentro de letras e formas).

const dist = (d, i, c) => Math.sqrt((d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2);

export function imageToCanvas(img, maxSide = Infinity) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(iw, ih), Math.sqrt(16e6 / (iw * ih)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw * k));
  c.height = Math.max(1, Math.round(ih * k));
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Cor mais frequente na borda (já opaca), em hex.
export function detectBackground(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 200) return;
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    const e = counts.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; e.n++;
    counts.set(key, e);
  };
  const step = Math.max(1, Math.floor(Math.max(w, h) / 600));
  for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return null; // borda já transparente
  const hx = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hx(best.r)}${hx(best.g)}${hx(best.b)}`;
}

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

/**
 * opts: { color: '#rrggbb', tolerance: 0–150, mode: 'borda'|'cor', smooth: bool, trim: bool }
 * Retorna um canvas novo com transparência.
 */
export function removeBackground(src, { color, tolerance = 40, mode = 'borda', smooth = true, trim = true }) {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const bg = hexRgb(color);
  const tol = Math.max(1, tolerance);
  const soft = smooth ? tol * 0.8 : 0; // faixa de transição para borda suave

  // alfa novo de um pixel conforme a distância até a cor do fundo
  const alphaFor = (dd) => (dd <= tol ? 0 : dd < tol + soft ? (dd - tol) / soft : 1);
  const apply = (i, a) => {
    if (a >= 1) return;
    const oa = d[i + 3] / 255;
    if (a > 0) {
      // tira a "contaminação" da cor do fundo nas bordas (evita halo)
      for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] - bg[k] * (1 - a)) / a));
    }
    d[i + 3] = Math.round(255 * a * oa);
  };

  if (mode === 'cor') {
    for (let i = 0; i < d.length; i += 4) apply(i, alphaFor(dist(d, i, bg)));
  } else {
    const seen = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    const push = (p) => {
      if (seen[p]) return;
      seen[p] = 1;
      const i = p * 4;
      if (d[i + 3] < 8) { queue[tail++] = p; return; } // já transparente: continua o fundo
      const a = alphaFor(dist(d, i, bg));
      if (a >= 1) return;
      apply(i, a);
      if (a === 0) queue[tail++] = p; // só expande por pixels de fundo puro
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
  }
  ctx.putImageData(id, 0, 0);
  return trim ? trimCanvas(out, d) : out;
}

function trimCanvas(c, d) {
  const { width: w, height: h } = c;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return c; // tudo transparente: devolve como está
  const pad = Math.round(Math.max(w, h) * 0.01);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
