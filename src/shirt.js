// Segmentação da roupa na foto: a partir dos pontos do corpo (IA de pose),
// separa os pixels que são a camiseta (cresce da cor do peito para fora,
// limitado ao tronco e às mangas). Daí saem: máscara (a estampa só cobre a
// roupa), gola, barra, largura da peça, cor dominante e modelagem.
import { canvasToBlob } from './util.js';

const MW = 360; // largura de trabalho da máscara

// sRGB → Lab (D65)
function lab(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  x = t(x); y = t(y); z = t(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// distância tolerante a luz/sombra (dobras mudam mais a luminância que a cor)
const dist = (a, b, wL = 0.35) => Math.sqrt(((a[0] - b[0]) * wL) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

export const NAMED_COLORS = [
  ['preta', '#161616'], ['branca', '#f1efea'], ['off-white', '#e7e0d2'], ['cinza', '#9d9d9b'], ['cinza-chumbo', '#55585b'],
  ['bege', '#d5c4a5'], ['areia', '#c6a27c'], ['caramelo', '#9a5d2a'], ['marrom', '#5f3f30'], ['vinho', '#5e1f2a'],
  ['vermelha', '#c41f2b'], ['rosa', '#e46f98'], ['salmão', '#ef9f7f'], ['laranja', '#e2762b'], ['amarela', '#f0cb2f'],
  ['verde', '#2e6a44'], ['verde-oliva', '#83854a'], ['verde militar', '#4a573a'], ['verde-água', '#31bfa1'],
  ['azul', '#3e60ad'], ['azul-marinho', '#1c294b'], ['azul-claro', '#8fb4dc'], ['roxa', '#5b2a7e'], ['lilás', '#a98dc8'],
];
const NAMED_LAB = NAMED_COLORS.map(([n, h]) => { const v = parseInt(h.slice(1), 16); return [n, h, lab(v >> 16, (v >> 8) & 255, v & 255)]; });
export function colorName(rgb) {
  const L = lab(...rgb);
  return NAMED_LAB.reduce((best, c) => { const dd = dist(L, c[2], 0.6); return dd < best.d ? { n: c[0], h: c[1], d: dd } : best; }, { d: Infinity });
}

/**
 * img: imagem da foto; pose: resultado de detectPose (normalizado).
 * Retorna métricas normalizadas (0–1 da foto) + máscara PNG.
 */
export async function analyzeShirt(img, pose, { longSleeve = false } = {}) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const mw = MW, mh = Math.round((MW * ih) / iw);
  const c = document.createElement('canvas');
  c.width = mw; c.height = mh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, mw, mh);
  const d = ctx.getImageData(0, 0, mw, mh).data;
  const N = mw * mh;
  const LAB = new Float32Array(N * 3);
  for (let p = 0; p < N; p++) { const v = lab(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]); LAB[p * 3] = v[0]; LAB[p * 3 + 1] = v[1]; LAB[p * 3 + 2] = v[2]; }
  const at = (p) => [LAB[p * 3], LAB[p * 3 + 1], LAB[p * 3 + 2]];

  // geometria do corpo em px da máscara
  const P = (k) => ({ x: pose.pts[k].x * mw, y: pose.pts[k].y * mh, v: pose.pts[k].v });
  let A = P('ls'), B = P('rs');
  if (A.x > B.x) [A, B] = [B, A];
  const sw = Math.hypot(B.x - A.x, B.y - A.y);
  const S = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const hips = [P('lh'), P('rh')];
  const hipsOk = hips[0].v > 0.35 && hips[1].v > 0.35;
  const Hm = hipsOk ? { x: (hips[0].x + hips[1].x) / 2, y: (hips[0].y + hips[1].y) / 2 } : { x: S.x, y: S.y + sw * 1.45 };
  const ux = (B.x - A.x) / sw, uy = (B.y - A.y) / sw;
  let vx = -uy, vy = ux;
  if (vy < 0) { vx = -vx; vy = -vy; }
  const tl = Math.max(sw * 0.8, (Hm.x - S.x) * vx + (Hm.y - S.y) * vy);
  const toLocal = (x, y) => ({ X: (x - S.x) * ux + (y - S.y) * uy, Y: (x - S.x) * vx + (y - S.y) * vy });
  const fromLocal = (X, Y) => ({ x: S.x + ux * X + vx * Y, y: S.y + uy * X + vy * Y });

  // região permitida: tronco + mangas (cápsulas ombro→cotovelo[→punho])
  const caps = [];
  for (const [s, e, w] of [['ls', 'le', 'lw'], ['rs', 're', 'rw']]) {
    const sh = P(s), el = P(e), wr = P(w);
    if (el.v > 0.3) {
      caps.push([sh, el, sw * 0.26]);
      if (longSleeve && wr.v > 0.3) caps.push([el, wr, sw * 0.2]);
    } else caps.push([sh, { x: sh.x + (sh.x - S.x) * 0.6, y: sh.y + tl * 0.35 }, sw * 0.26]);
  }
  const inCapsule = (x, y, [a, b, r]) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) < r;
  };
  const allowed = new Uint8Array(N);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const { X, Y } = toLocal(x, y);
    const torso = Y > -0.3 * tl && Y < 1.45 * tl && Math.abs(X) < 0.72 * sw;
    if (torso || caps.some((cp) => inCapsule(x, y, cp))) allowed[y * mw + x] = 1;
  }

  // cor de referência: sementes no peito/barriga, fica com o grupo mais consistente
  const seeds = [];
  for (const Y of [0.3, 0.5, 0.7]) for (const X of [-0.18, 0, 0.18]) {
    const q = fromLocal(X * sw, Y * tl);
    const qx = Math.round(q.x), qy = Math.round(q.y);
    if (qx < 3 || qy < 3 || qx >= mw - 3 || qy >= mh - 3) continue;
    let l = 0, a = 0, b = 0, n = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) { const v = at((qy + yy) * mw + qx + xx); l += v[0]; a += v[1]; b += v[2]; n++; }
    seeds.push({ p: qy * mw + qx, c: [l / n, a / n, b / n] });
  }
  if (seeds.length < 3) return { ok: false };
  let best = null;
  for (const s of seeds) {
    const group = seeds.filter((o) => dist(o.c, s.c) < 10);
    if (!best || group.length > best.length) best = group;
  }
  const ref = [0, 1, 2].map((k) => best.reduce((t, s) => t + s.c[k], 0) / best.length);

  // fundo (cantos) para não vazar quando a peça é parecida com o fundo
  const corners = [[2, 2], [mw - 3, 2], [2, mh - 3], [mw - 3, mh - 3]].map(([x, y]) => at(y * mw + x));
  const bg = [0, 1, 2].map((k) => corners.reduce((t, v) => t + v[k], 0) / 4);
  const nearBg = dist(ref, bg) < 14;

  // cresce a região
  const mask = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const T_REF = 24, T_STEP = nearBg ? 4 : 9;
  for (const s of best) { mask[s.p] = 1; queue[qt++] = s.p; }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % mw, y = (p - x) / mw;
    const cp = at(p);
    for (const q of [x > 0 ? p - 1 : -1, x < mw - 1 ? p + 1 : -1, y > 0 ? p - mw : -1, y < mh - 1 ? p + mw : -1]) {
      if (q < 0 || mask[q] || !allowed[q]) continue;
      const cq = at(q);
      if (dist(cq, ref) > T_REF || dist(cq, cp) > T_STEP) continue;
      if (nearBg && dist(cq, bg, 1) < dist(cq, ref, 1)) continue;
      mask[q] = 1;
      queue[qt++] = q;
    }
  }

  // fecha pequenos buracos (estampas, botões, vincos) e suaviza a borda
  const morph = (src, r, grow) => {
    const o = new Uint8Array(N);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      let hit = !grow;
      for (let yy = -r; yy <= r && hit !== grow; yy++) for (let xx = -r; xx <= r; xx++) {
        const X = x + xx, Y = y + yy;
        const v = X >= 0 && Y >= 0 && X < mw && Y < mh && src[Y * mw + X];
        if (grow && v) { hit = true; break; }
        if (!grow && !v) { hit = false; break; }
      }
      o[y * mw + x] = hit ? 1 : 0;
    }
    return o;
  };
  const m = morph(morph(mask, 2, true), 2, false);
  // preenche buracos internos
  const outside = new Uint8Array(N);
  qh = qt = 0;
  const pushOut = (p) => { if (!m[p] && !outside[p]) { outside[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < mw; x++) { pushOut(x); pushOut((mh - 1) * mw + x); }
  for (let y = 0; y < mh; y++) { pushOut(y * mw); pushOut(y * mw + mw - 1); }
  while (qh < qt) {
    const p = queue[qh++]; const x = p % mw, y = (p - x) / mw;
    if (x > 0) pushOut(p - 1);
    if (x < mw - 1) pushOut(p + 1);
    if (y > 0) pushOut(p - mw);
    if (y < mh - 1) pushOut(p + mw);
  }
  for (let p = 0; p < N; p++) if (!m[p] && !outside[p]) m[p] = 1;

  let area = 0;
  for (let p = 0; p < N; p++) area += m[p];
  if (area < sw * tl * 0.3) return { ok: false };

  // medidas ao longo do eixo do corpo
  const isM = (X, Y) => { const q = fromLocal(X, Y); const x = Math.round(q.x), y = Math.round(q.y); return x >= 0 && y >= 0 && x < mw && y < mh && m[y * mw + x] === 1; };
  const chestY = 0.35 * tl;
  let l = 0, r = 0;
  while (l > -1.2 * sw && isM(l - 1, chestY)) l--;
  while (r < 1.2 * sw && isM(r + 1, chestY)) r++;
  const midX = Math.max(-0.25 * sw, Math.min(0.25 * sw, (l + r) / 2));
  // gola: primeira linha com roupa descendo pelo centro
  let collar = null;
  for (let Y = -0.3 * tl; Y < 0.4 * tl; Y += 0.5) if (isM(midX, Y) && isM(midX, Y + 1) && isM(midX, Y + 2)) { collar = Y; break; }
  if (collar === null) collar = 0.03 * tl;
  // barra: desce até acabar a roupa (com limite para calças da mesma cor)
  let hem = collar, gap = 0;
  const hipY = hipsOk ? (Hm.x - S.x) * vx + (Hm.y - S.y) * vy : tl;
  const maxY = hipY + 0.45 * tl;
  for (let Y = collar; Y < maxY; Y += 0.5) { if (isM(midX, Y)) { hem = Y; gap = 0; } else if (++gap > 6) break; }
  if (hem - collar < 0.6 * tl) hem = hipY + 0.12 * tl; // mão/braço na frente: estima pela cintura
  // largura da peça no meio do tronco (para modelagem)
  const waistY = collar + 0.55 * (hem - collar);
  let wl = 0, wr = 0;
  while (wl > -1.2 * sw && isM(midX + wl - 1, waistY)) wl--;
  while (wr < 1.2 * sw && isM(midX + wr + 1, waistY)) wr++;
  const widthRatio = (wr - wl) / sw;
  const lengthRatio = (hem - collar) / tl;

  // cor média da roupa
  let rr = 0, gg = 0, bb = 0, n = 0;
  for (let p = 0; p < N; p += 3) if (m[p]) { rr += d[p * 4]; gg += d[p * 4 + 1]; bb += d[p * 4 + 2]; n++; }
  const rgb = [rr / n, gg / n, bb / n].map(Math.round);
  const named = colorName(rgb);

  // máscara em PNG (branco + alfa)
  const out = document.createElement('canvas');
  out.width = mw; out.height = mh;
  const octx = out.getContext('2d');
  const od = octx.createImageData(mw, mh);
  for (let p = 0; p < N; p++) { od.data[p * 4] = od.data[p * 4 + 1] = od.data[p * 4 + 2] = 255; od.data[p * 4 + 3] = m[p] ? 255 : 0; }
  octx.putImageData(od, 0, 0);

  const norm = (X, Y) => { const q = fromLocal(X, Y); return { x: +(q.x / mw).toFixed(4), y: +(q.y / mh).toFixed(4) }; };
  return {
    ok: true,
    mask: await canvasToBlob(out, 'image/png'),
    collar: norm(midX, collar), hem: norm(midX, hem), center: norm(midX, chestY),
    widthRatio: +widthRatio.toFixed(2), lengthRatio: +lengthRatio.toFixed(2),
    rgb, colorName: named.n, colorHex: named.h,
    fit: widthRatio > 1.32 || (widthRatio > 1.2 && lengthRatio > 1.3) ? 'oversized' : 'regular',
    at: Date.now(),
  };
}
