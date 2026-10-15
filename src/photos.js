// Peças reais: fotos das peças do fornecedor usadas como base de mockup.
// A arte é aplicada sobre a foto e recebe as dobras/luz do tecido da própria foto.
import { db } from './db.js';
import { canvasToBlob, dataURLToBlob } from './util.js';
import { drawLayer } from './compose.js';
import { detectPose } from './pose.js';

export const TIPOS_FOTO = ['Camiseta', 'Babylook', 'Polo', 'Manga longa', 'Moletom', 'Moletom com capuz', 'Regata', 'Short', 'Conjunto', 'Boné'];
export const VISTAS_FOTO = [
  { id: 'frente', label: 'Frente' },
  { id: 'inteiro', label: 'Corpo inteiro' },
  { id: 'costas', label: 'Costas' },
  { id: 'detalhe', label: 'Detalhe / close' },
];
export const photoLabel = (p) => [p.tipo, p.cor].filter(Boolean).join(' ') || p.name;
export const vistaLabel = (id) => VISTAS_FOTO.find((v) => v.id === id)?.label || id;
export const MODELOS = [{ id: 'masculino', label: 'Masculino' }, { id: 'feminino', label: 'Feminino' }];

// Área de estampa padrão (proporção da foto) quando a IA não detecta o corpo.
export const DEFAULT_AREA = {
  frente: { cx: 0.51, cy: 0.43, w: 0.3, h: 0.22 },
  inteiro: { cx: 0.5, cy: 0.36, w: 0.16, h: 0.13 },
  costas: { cx: 0.52, cy: 0.46, w: 0.32, h: 0.28 },
  detalhe: { cx: 0.5, cy: 0.6, w: 0.45, h: 0.3 },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const DEG = 180 / Math.PI;

export const isBack = (p) => p.vista === 'costas' || p.pose?.facing === 'back';

// Áreas calculadas pelo corpo detectado pela IA: seguem posição, tamanho e
// inclinação de cada pessoa. "Esquerdo/direito" = lado de quem veste.
function poseAreas(p) {
  const P = p.pose.pts, W = p.w, H = p.h;
  const px = (q) => ({ x: q.x * W, y: q.y * H, v: q.v });
  let A = px(P.ls), B = px(P.rs);
  if (A.x > B.x) [A, B] = [B, A]; // A = ombro à esquerda da imagem
  const hips = [px(P.lh), px(P.rh)].sort((a, b) => a.x - b.x);
  const elbows = [px(P.le), px(P.re)];
  const wrists = [px(P.lw), px(P.rw)];
  const sw = dist(A, B);
  const S = mid(A, B);
  const hipsOk = hips[0].v > 0.4 && hips[1].v > 0.4 && mid(hips[0], hips[1]).y > S.y + sw * 0.6;
  const Hm = hipsOk ? mid(hips[0], hips[1]) : { x: S.x, y: S.y + sw * 1.45 };
  const tl = dist(S, Hm);
  const ux = (B.x - A.x) / sw, uy = (B.y - A.y) / sw;
  // eixo do tronco (ombros → quadril), corrigido para ser perpendicular aos ombros
  let vx = (Hm.x - S.x) / tl, vy = (Hm.y - S.y) / tl;
  const dot = vx * ux + vy * uy;
  vx -= dot * ux; vy -= dot * uy;
  const vn = Math.hypot(vx, vy) || 1;
  vx /= vn; vy /= vn;
  const rot = Math.atan2(uy, ux) * DEG;
  const at = (a, b) => ({ x: S.x + ux * a * sw + vx * b * tl, y: S.y + uy * a * sw + vy * b * tl });
  const box = (id, label, a, b, w, h, r = rot) => { const c = at(a, b); return { id, label, cx: c.x, cy: c.y, w, h, rot: r, auto: true }; };
  const back = isBack(p);
  const L = back ? -1 : 1; // lado esquerdo de quem veste: direita da imagem (frente) ou esquerda (costas)

  // mangas: do ombro em direção ao cotovelo
  const sleeve = (side, id, label) => {
    const sh = side > 0 ? B : A;
    const el = elbows.slice().sort((a, b) => dist(a, sh) - dist(b, sh))[0];
    let c, r;
    if (el && el.v > 0.4 && dist(el, sh) > sw * 0.25) {
      c = { x: sh.x + (el.x - sh.x) * 0.3, y: sh.y + (el.y - sh.y) * 0.3 };
      r = Math.atan2(el.y - sh.y, el.x - sh.x) * DEG - 90;
    } else {
      c = { x: sh.x + ux * side * sw * 0.1 + vx * tl * 0.12, y: sh.y + uy * side * sw * 0.1 + vy * tl * 0.12 };
      r = rot + side * 20;
    }
    return { id, label, cx: c.x, cy: c.y, w: sw * 0.15, h: sw * 0.15, rot: r, auto: true };
  };
  const mangaE = sleeve(L, 'manga-esquerda', 'Manga esquerda');
  const mangaD = sleeve(-L, 'manga-direita', 'Manga direita');

  const out = back ? [
    box('principal', 'Costas central', 0, 0.42, sw * 0.66, tl * 0.5),
    box('costas-superior', 'Costas superior', 0, 0.16, sw * 0.56, tl * 0.14),
    box('nuca', 'Nuca', 0, 0.02, sw * 0.16, sw * 0.08),
    box('costas-inferior', 'Costas inferior', 0, 0.8, sw * 0.5, tl * 0.14),
    mangaE, mangaD,
  ] : [
    box('principal', 'Estampa grande', 0, 0.4, sw * 0.62, tl * 0.5),
    box('peito-central', 'Peito central', 0, 0.2, sw * 0.36, tl * 0.17),
    box('peito-esquerdo', 'Peito esquerdo', 0.24 * L, 0.2, sw * 0.2, sw * 0.2),
    box('peito-direito', 'Peito direito', -0.24 * L, 0.2, sw * 0.2, sw * 0.2),
    box('barra-esquerda', 'Barra esquerda', 0.26 * L, 0.9, sw * 0.2, sw * 0.16),
    box('barra-direita', 'Barra direita', -0.26 * L, 0.9, sw * 0.2, sw * 0.16),
    mangaE, mangaD,
  ];
  // mãos na frente da área (aviso no editor)
  for (const a of out) {
    a.handOver = wrists.some((w) => w.v > 0.5 && Math.abs(w.x - a.cx) < a.w * 0.6 && Math.abs(w.y - a.cy) < a.h * 0.6);
  }
  return out;
}

// Sem detecção (ex.: close): áreas a partir do padrão do enquadramento.
function fallbackAreas(p) {
  const a = DEFAULT_AREA[p.vista] || DEFAULT_AREA.frente;
  const cx = a.cx * p.w, cy = a.cy * p.h, w = a.w * p.w, h = a.h * p.h;
  const main = { id: 'principal', label: isBack(p) ? 'Costas central' : 'Estampa grande', cx, cy, w, h, rot: 0 };
  if (isBack(p)) return [main, { id: 'costas-superior', label: 'Costas superior', cx, cy: cy - h * 0.38, w: w * 0.8, h: h * 0.22, rot: 0 }];
  const s = Math.min(w, h) * 0.32;
  return [
    main,
    { id: 'peito-central', label: 'Peito central', cx, cy: cy - h * 0.3, w: w * 0.42, h: h * 0.3, rot: 0 },
    { id: 'peito-esquerdo', label: 'Peito esquerdo', cx: cx + w * 0.27, cy: cy - h * 0.3, w: s, h: s, rot: 0 },
    { id: 'peito-direito', label: 'Peito direito', cx: cx - w * 0.27, cy: cy - h * 0.3, w: s, h: s, rot: 0 },
    { id: 'barra-esquerda', label: 'Barra esquerda', cx: cx + w * 0.3, cy: cy + h * 0.9, w: s, h: s * 0.8, rot: 0 },
    { id: 'barra-direita', label: 'Barra direita', cx: cx - w * 0.3, cy: cy + h * 0.9, w: s, h: s * 0.8, rot: 0 },
  ];
}

// Áreas em px da foto. Ajustes manuais ("Ajustar na foto") têm prioridade.
export function photoAreas(p) {
  const base = p.pose?.ok ? poseAreas(p) : fallbackAreas(p);
  const ov = { ...(p.area ? { principal: p.area } : {}), ...(p.areaOverrides || {}) };
  return base.map((a) => (ov[a.id]
    ? { ...a, cx: ov[a.id].cx * p.w, cy: ov[a.id].cy * p.h, w: ov[a.id].w * p.w, h: ov[a.id].h * p.h, rot: ov[a.id].rot ?? a.rot, manual: true, auto: false }
    : a));
}

function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida.'));
    img.src = URL.createObjectURL(blob);
  });
}

async function thumbOf(img, max = 420) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.85);
}

// Fotos grandes são reduzidas a 2000 px no lado maior (suficiente para mockup).
async function normalizePhoto(blob) {
  const img = await loadImg(blob);
  const max = 2000;
  if (Math.max(img.naturalWidth, img.naturalHeight) <= max) return { blob, img };
  const k = max / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = await canvasToBlob(c, 'image/jpeg', 0.9);
  return { blob: out, img: await loadImg(out) };
}

async function addPhoto(blob, meta) {
  const { blob: b, img } = await normalizePhoto(blob);
  return db.photos.add({
    name: meta.name, sourceFile: meta.sourceFile || '', tipo: meta.tipo || 'Camiseta', cor: meta.cor || '', corHex: meta.corHex || '',
    modelo: meta.modelo || '', vista: meta.vista || 'frente', area: meta.area || null,
    image: b, thumb: await thumbOf(img), w: img.naturalWidth, h: img.naturalHeight, createdAt: Date.now(),
  });
}

// Importa imagens soltas (classificação fica para o usuário).
export async function importImages(files, onProgress) {
  const existing = new Set((await db.photos.toArray()).map((p) => p.sourceFile));
  let added = 0, skipped = 0, i = 0;
  for (const f of files) {
    onProgress?.(++i, files.length);
    if (!f.type.startsWith('image/')) { skipped++; continue; }
    if (existing.has(f.name)) { skipped++; continue; }
    try { await addPhoto(f, { name: f.name.replace(/\.[^.]+$/, ''), sourceFile: f.name }); added++; } catch { skipped++; }
  }
  return { added, skipped };
}

// Pacote .json gerado com as fotos já classificadas (tipo, cor, modelo, vista, área).
export async function importPack(file, onProgress) {
  const data = JSON.parse(await file.text());
  if (data?.kind !== 'ekklesia-pecas-reais' || !Array.isArray(data.items)) throw new Error('Arquivo não é um pacote de peças reais.');
  const existing = new Set((await db.photos.toArray()).map((p) => p.sourceFile));
  let added = 0, skipped = 0, i = 0;
  for (const it of data.items) {
    onProgress?.(++i, data.items.length);
    if (existing.has(it.file)) { skipped++; continue; }
    try { await addPhoto(await dataURLToBlob(it.data), { ...it, sourceFile: it.file }); added++; } catch { skipped++; }
  }
  return { added, skipped };
}

// ---------- IA: detecção do corpo ----------
export async function detectPhoto(photo) {
  const img = await loadImg(photo.image);
  const pose = await detectPose(img);
  URL.revokeObjectURL(img.src);
  await db.photos.update(photo.id, { pose });
  photo.pose = pose;
  return pose;
}

// Analisa as fotos ainda sem detecção (ou todas, com `force`).
export async function detectAll(onProgress, { force = false } = {}) {
  const list = (await db.photos.toArray()).filter((p) => force || !p.pose);
  let ok = 0, fail = 0, i = 0, errors = 0, lastErr = null;
  for (const p of list) {
    onProgress?.(++i, list.length);
    try { (await detectPhoto(p)).ok ? ok++ : fail++; } catch (e) { console.error(e); errors++; lastErr = e; }
  }
  if (errors && errors === list.length) throw lastErr;
  return { ok, fail: fail + errors, total: list.length };
}

// ---------- render ----------
// Mapa de sombreamento (luz e dobras) da foto, neutro em 128 dentro da área.
// Também guarda a luminância para deformar a arte pelas dobras.
const shadeCache = new Map();
function shadingFor(photo, img, area) {
  const key = `${photo.id}:${Math.round(area.cx)}:${Math.round(area.cy)}:${Math.round(area.w)}`;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const w = photo.w, h = photo.h;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const L = new Float32Array(w * h);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) L[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const x0 = Math.max(0, Math.floor(area.cx - area.w / 2)), x1 = Math.min(w, Math.ceil(area.cx + area.w / 2));
  const y0 = Math.max(0, Math.floor(area.cy - area.h / 2)), y1 = Math.min(h, Math.ceil(area.cy + area.h / 2));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += L[y * w + x]; n++; }
  const mean = n ? sum / n : 128;
  // peça escura tem pouca variação de luz: amplifica mais
  const gain = mean < 60 ? 2.6 : mean < 120 ? 1.8 : 1.3;
  const S = new Uint8ClampedArray(w * h);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) {
    const v = Math.max(0, Math.min(255, 128 + (L[p] - mean) * gain));
    S[p] = v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const entry = { canvas: c, S, w, h };
  shadeCache.clear(); // guarda só o último (memória)
  shadeCache.set(key, entry);
  return entry;
}

// Desloca os pixels da arte conforme o relevo do tecido (dobras), só na região da arte.
function warpByFabric(actx, shade, region, scale, strength) {
  const cw = actx.canvas.width, ch = actx.canvas.height;
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(cw, Math.ceil(region.x + region.w)), y1 = Math.min(ch, Math.ceil(region.y + region.h));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 4 || bh < 4) return;
  const src = actx.getImageData(x0, y0, bw, bh);
  const out = actx.createImageData(bw, bh);
  const s = src.data, o = out.data, { S, w, h } = shade;
  const k = strength * 0.09 * scale;
  const lum = (x, y) => S[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < bh; y++) {
    const py = Math.round((y0 + y) / scale);
    for (let x = 0; x < bw; x++) {
      const px = Math.round((x0 + x) / scale);
      const gx = lum(px + 3, py) - lum(px - 3, py);
      const gy = lum(px, py + 3) - lum(px, py - 3);
      const sx = Math.round(x - gx * k), sy = Math.round(y - gy * k);
      if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue;
      const si = (sy * bw + sx) * 4, oi = (y * bw + x) * 4;
      o[oi] = s[si]; o[oi + 1] = s[si + 1]; o[oi + 2] = s[si + 2]; o[oi + 3] = s[si + 3];
    }
  }
  actx.putImageData(out, x0, y0);
}

function rotRectPath(ctx, a) {
  ctx.save();
  ctx.translate(a.cx, a.cy);
  ctx.rotate((a.rot * Math.PI) / 180);
  ctx.strokeRect(-a.w / 2, -a.h / 2, a.w, a.h);
  ctx.restore();
}

/**
 * opts: { photo, img, layers: [{ area, x, y, scale, rot, opacity, img, blend, fabric, warp }] }
 * `fast`: pula a deformação (usado enquanto arrasta).
 */
export function renderPhotoMockup(ctx, opts, { scale = 1, guides = false, fast = false } = {}) {
  const { photo, img } = opts;
  const W = photo.w, H = photo.h;
  const areas = photoAreas(photo);
  const sizes = [];
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  for (const layer of opts.layers || []) {
    if (!layer.img) continue;
    const area = areas.find((a) => a.id === layer.area) || areas[0];
    const art = document.createElement('canvas');
    art.width = Math.round(W * scale); art.height = Math.round(H * scale);
    const actx = art.getContext('2d', { willReadFrequently: true });
    actx.setTransform(scale, 0, 0, scale, 0, 0);
    const box = drawLayer(actx, layer.img, { ...layer, opacity: 1 }, area);
    sizes.push(box);
    actx.setTransform(1, 0, 0, 1, 0, 0);
    const shade = shadingFor(photo, img, areas[0]);
    const warp = layer.warp ?? 0.5;
    if (warp > 0 && !fast) {
      const r = Math.hypot(box.w, box.h) / 2 + 6;
      const cx = (area.cx + layer.x) * scale, cy = (area.cy + layer.y) * scale;
      warpByFabric(actx, shade, { x: cx - r * scale, y: cy - r * scale, w: 2 * r * scale, h: 2 * r * scale }, scale, warp);
    }
    const fabric = layer.fabric ?? 0.6;
    if (fabric > 0) {
      const mask = document.createElement('canvas');
      mask.width = art.width; mask.height = art.height;
      mask.getContext('2d').drawImage(art, 0, 0);
      actx.globalCompositeOperation = 'overlay';
      actx.globalAlpha = fabric;
      actx.drawImage(shade.canvas, 0, 0, art.width, art.height);
      actx.globalAlpha = 1;
      actx.globalCompositeOperation = 'destination-in';
      actx.drawImage(mask, 0, 0); // recorta de volta no formato da arte
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend === 'multiply' ? 'multiply' : 'source-over';
    ctx.drawImage(art, 0, 0);
    ctx.restore();
  }

  if (guides) {
    ctx.lineWidth = 2 / Math.max(scale, 0.5);
    if (opts.showAllAreas) {
      ctx.strokeStyle = 'rgba(196,169,107,0.45)';
      ctx.setLineDash([4, 5]);
      for (const a of areas) rotRectPath(ctx, a);
    }
    const sel = opts.layers?.[0];
    const area = areas.find((a) => a.id === sel?.area) || (opts.showArea ? areas[0] : null);
    if (area) {
      ctx.strokeStyle = 'rgba(196,169,107,0.95)';
      ctx.setLineDash([8, 6]);
      rotRectPath(ctx, area);
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
  return { sizes };
}
