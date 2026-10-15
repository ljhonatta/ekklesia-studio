// Peças reais: fotos das peças do fornecedor usadas como base de mockup.
// IA de pose (pose.js) + segmentação da roupa (shirt.js) definem onde a
// estampa vai, em medidas reais de serigrafia/bordado, projetada no tronco
// como um cilindro (acompanha o giro do corpo) e recortada só na roupa.
import { db } from './db.js';
import { canvasToBlob, dataURLToBlob } from './util.js';
import { detectPose } from './pose.js';
import { analyzeShirt } from './shirt.js';

export const ANALYSIS_VERSION = 3;

export const TIPOS_FOTO = ['Camiseta', 'Babylook', 'Polo', 'Manga longa', 'Moletom', 'Moletom com capuz', 'Regata', 'Short', 'Conjunto', 'Boné'];
export const VISTAS_FOTO = [
  { id: 'frente', label: 'Frente' },
  { id: 'inteiro', label: 'Corpo inteiro' },
  { id: 'costas', label: 'Costas' },
  { id: 'detalhe', label: 'Detalhe / close' },
];
export const MODELAGENS = [{ id: 'regular', label: 'Regular' }, { id: 'oversized', label: 'Oversized' }, { id: 'slim', label: 'Slim / baby look' }];
export const MODELOS = [{ id: 'masculino', label: 'Masculino' }, { id: 'feminino', label: 'Feminino' }];
export const vistaLabel = (id) => VISTAS_FOTO.find((v) => v.id === id)?.label || id;

// "Camiseta preta oversized"
export function photoLabel(p) {
  const cor = p.cor || p.shirt?.colorName || '';
  const fit = (p.modelagem || p.shirt?.fit) === 'oversized' && /camiseta|moletom/i.test(p.tipo || '') ? 'oversized' : '';
  return [p.tipo, cor, fit].filter(Boolean).join(' ') || p.name;
}

export const isBack = (p) => (p.pose?.ok ? p.pose.facing === 'back' : p.vista === 'costas');
const LONG = /manga longa|moletom/i;

// ---------- geometria ----------
// Posições usadas em serigrafia/bordado, em cm a partir da gola (y) e do
// centro da peça (s, ao longo do tronco; + = lado esquerdo de quem veste).
// { id, label, s, y, w, h, from: 'gola' | 'barra' }
const FRONT = [
  { id: 'principal', label: 'Estampa grande (A3)', s: 0, y: 8, w: 26, h: 30, top: true },
  { id: 'peito-central', label: 'Peito central', s: 0, y: 6, w: 12, h: 8, top: true },
  { id: 'peito-esquerdo', label: 'Peito esquerdo', s: 10, y: 6, w: 9, h: 9, top: true },
  { id: 'peito-direito', label: 'Peito direito', s: -10, y: 6, w: 9, h: 9, top: true },
  { id: 'barra-esquerda', label: 'Barra esquerda', s: 12, y: 6, w: 8, h: 8, from: 'barra' },
  { id: 'barra-direita', label: 'Barra direita', s: -12, y: 6, w: 8, h: 8, from: 'barra' },
];
const BACK = [
  { id: 'principal', label: 'Costas central (A3)', s: 0, y: 10, w: 28, h: 32, top: true },
  { id: 'nuca', label: 'Nuca', s: 0, y: 2.5, w: 8, h: 4, top: true },
  { id: 'costas-superior', label: 'Costas superior', s: 0, y: 7, w: 26, h: 7, top: true },
  { id: 'costas-inferior', label: 'Costas inferior', s: 0, y: 6, w: 24, h: 10, from: 'barra' },
];

const DEG = Math.PI / 180;

// Referencial do corpo a partir da pose: origem no meio dos ombros,
// u = linha dos ombros (esquerda→direita da imagem), v = descendo o tronco.
function bodyFrame(p) {
  const W = p.w, H = p.h, P = p.pose.pts;
  const px = (q) => ({ x: q.x * W, y: q.y * H, v: q.v });
  let A = px(P.ls), B = px(P.rs);
  if (A.x > B.x) [A, B] = [B, A];
  const sw = Math.hypot(B.x - A.x, B.y - A.y);
  const O = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const ux = (B.x - A.x) / sw, uy = (B.y - A.y) / sw;
  const vx = -uy, vy = ux;
  const hips = [px(P.lh), px(P.rh)];
  const hipsOk = hips[0].v > 0.35 && hips[1].v > 0.35;
  const Hm = hipsOk ? { x: (hips[0].x + hips[1].x) / 2, y: (hips[0].y + hips[1].y) / 2 } : { x: O.x, y: O.y + sw * 1.45 };
  const hipY = (Hm.x - O.x) * vx + (Hm.y - O.y) * vy;
  const tl = Math.max(sw * 0.8, hipY);
  const fem = p.modelo === 'feminino' || p.tipo === 'Babylook';
  const ppc = tl / (fem ? 44 : 48); // px por cm (ombro→quadril ≈ 48 cm masc., 44 fem.)
  const toLocal = (x, y) => ({ X: (x - O.x) * ux + (y - O.y) * uy, Y: (x - O.x) * vx + (y - O.y) * vy });
  const fromLocal = (X, Y) => ({ x: O.x + ux * X + vx * Y, y: O.y + uy * X + vy * Y });
  return { O, ux, uy, vx, vy, sw, tl, hipY, ppc, fem, A, B, toLocal, fromLocal, roll: Math.atan2(uy, ux), px };
}

// Giro estimado: ombros "encolhidos" em relação ao tronco = corpo de lado;
// o lado vem da posição do nariz em relação ao meio dos ombros.
export function estimateYaw(p) {
  if (!p.pose?.ok) return 0;
  const f = bodyFrame(p);
  const P = p.pose.pts;
  // de frente, ombros/tronco ≈ 0,73 (masc.) ou 0,68 (fem.); de lado, encolhe
  const expected = f.fem ? 0.68 : 0.73;
  const c = (f.sw / f.tl) / expected;
  if (c >= 1) return 0;
  let mag = Math.acos(Math.max(0.35, c)) / DEG;
  if (mag < (isBack(p) ? 25 : 15)) return 0;
  mag = Math.min(50, mag * 0.8);
  // lado: nariz deslocado (de frente) ou orelha mais visível
  const nose = f.px(P.nose);
  const nx = f.toLocal(nose.x, nose.y).X / f.sw;
  let sign = 0;
  if (!isBack(p) && Math.abs(nx) > 0.08) sign = Math.sign(nx);
  else if (P.lear && Math.abs(P.lear.v - P.rear.v) > 0.1) sign = P.lear.v > P.rear.v ? -1 : 1;
  if (isBack(p)) sign = -sign;
  return Math.round(sign * mag);
}

// Áreas em px da foto. Cada área cilíndrica tem s/y (referencial do corpo) e
// também cx/cy/w/h/rot projetados para guias e listas.
export function photoAreas(p, yawDeg) {
  const areas = p.pose?.ok ? poseAreas(p, yawDeg) : fallbackAreas(p);
  const ov = { ...(p.area ? { principal: p.area } : {}), ...(p.areaOverrides || {}) };
  const out = areas.map((a) => (ov[a.id]
    ? { ...a, mode: 'flat', cx: ov[a.id].cx * p.w, cy: ov[a.id].cy * p.h, w: ov[a.id].w * p.w, h: ov[a.id].h * p.h, rot: ov[a.id].rot ?? a.rot, manual: true }
    : a));
  out.frame = areas.frame;
  return out;
}

function poseAreas(p, yawDeg) {
  const f = bodyFrame(p);
  const back = isBack(p);
  const sh = p.shirt?.ok ? p.shirt : null;
  const k = (f.fem ? 0.88 : 1) * ((p.modelagem || sh?.fit) === 'oversized' ? 1.08 : 1);
  const yaw = (yawDeg ?? estimateYaw(p)) * DEG;
  const R = (f.fem ? 13.5 : 15) * f.ppc; // raio do tronco (cilindro)
  // gola, barra e centro da peça (da segmentação; senão, estimados pelo corpo)
  const loc = (q) => f.toLocal(q.x * p.w, q.y * p.h);
  const collarY = sh ? loc(sh.collar).Y : (back ? -2 : 2) * f.ppc;
  const hemY = sh ? loc(sh.hem).Y : f.hipY + 6 * f.ppc;
  const centerX = sh ? loc(sh.center).X : 0;
  const axisX = centerX; // eixo do tronco = centro da silhueta; a frente gira em volta dele
  const proj = (s, Y) => f.fromLocal(axisX + R * Math.sin(s / R + yaw), Y);
  const L = back ? -1 : 1; // lado esquerdo de quem veste

  const make = (d) => {
    const w = d.w * k * f.ppc, h = d.h * (d.w > 20 ? k : 1) * f.ppc;
    const s = d.s * (Math.abs(d.s) > 0 ? k : 1) * L * f.ppc;
    const y = d.from === 'barra' ? hemY - (d.y + d.h / 2) * f.ppc : collarY + (d.y + d.h / 2) * f.ppc;
    const c = proj(s, y);
    const vis = Math.cos(s / R + yaw);
    const outline = [];
    for (let i = 0; i <= 12; i++) outline.push(proj(s - w / 2 + (w * i) / 12, y - h / 2));
    for (let i = 12; i >= 0; i--) outline.push(proj(s - w / 2 + (w * i) / 12, y + h / 2));
    return { id: d.id, label: d.label, mode: 'cyl', s, y, w, h, cmW: +(w / f.ppc).toFixed(1), cmH: +(h / f.ppc).toFixed(1), cx: c.x, cy: c.y, rot: f.roll / DEG, outline, hidden: vis < 0.15 };
  };
  const list = (back ? BACK : FRONT).map(make);

  // mangas (planas, ao longo do braço): 7×7 cm a ~7 cm do ombro
  const pts = p.pose.pts;
  const sleeve = (wearerLeft, id, label) => {
    const imageRight = back ? !wearerLeft : wearerLeft;
    const shp = imageRight ? f.B : f.A;
    const els = [f.px(pts.le), f.px(pts.re)].sort((a, b) => Math.hypot(a.x - shp.x, a.y - shp.y) - Math.hypot(b.x - shp.x, b.y - shp.y));
    const el = els[0];
    let dir;
    if (el.v > 0.35 && Math.hypot(el.x - shp.x, el.y - shp.y) > f.sw * 0.2) {
      const len = Math.hypot(el.x - shp.x, el.y - shp.y);
      dir = { x: (el.x - shp.x) / len, y: (el.y - shp.y) / len };
    } else {
      const out = imageRight ? 1 : -1;
      dir = { x: f.ux * out * 0.5 + f.vx * 0.87, y: f.uy * out * 0.5 + f.vy * 0.87 };
    }
    const dcm = LONG.test(p.tipo || '') ? 9 : 7;
    const c = { x: shp.x + dir.x * dcm * f.ppc, y: shp.y + dir.y * dcm * f.ppc };
    const size = 7 * f.ppc;
    return { id, label, mode: 'flat', cx: c.x, cy: c.y, w: size, h: size, cmW: 7, cmH: 7, rot: Math.atan2(dir.y, dir.x) / DEG - 90 };
  };
  list.push(sleeve(true, 'manga-esquerda', 'Manga esquerda'), sleeve(false, 'manga-direita', 'Manga direita'));

  // mão na frente da área
  const wrists = [f.px(pts.lw), f.px(pts.rw)];
  for (const a of list) a.handOver = wrists.some((w) => w.v > 0.5 && Math.abs(w.x - a.cx) < a.w * 0.55 && Math.abs(w.y - a.cy) < a.h * 0.55);

  list.frame = { ...f, R, yaw, axisX, proj, collarY, hemY };
  return list;
}

// Sem corpo detectado (ex.: close): áreas planas a partir do enquadramento.
const DEFAULT_AREA = {
  frente: { cx: 0.51, cy: 0.43, w: 0.3, h: 0.22 },
  inteiro: { cx: 0.5, cy: 0.36, w: 0.16, h: 0.13 },
  costas: { cx: 0.52, cy: 0.46, w: 0.32, h: 0.28 },
  detalhe: { cx: 0.5, cy: 0.6, w: 0.45, h: 0.3 },
};
function fallbackAreas(p) {
  const a = DEFAULT_AREA[p.vista] || DEFAULT_AREA.frente;
  const cx = a.cx * p.w, cy = a.cy * p.h, w = a.w * p.w, h = a.h * p.h;
  const flat = (id, label, x, y, ww, hh) => ({ id, label, mode: 'flat', cx: x, cy: y, w: ww, h: hh, rot: 0 });
  const list = isBack(p)
    ? [flat('principal', 'Costas central', cx, cy, w, h), flat('costas-superior', 'Costas superior', cx, cy - h * 0.38, w * 0.8, h * 0.22)]
    : (() => {
      const s = Math.min(w, h) * 0.32;
      return [
        flat('principal', 'Estampa grande', cx, cy, w, h),
        flat('peito-central', 'Peito central', cx, cy - h * 0.3, w * 0.42, h * 0.3),
        flat('peito-esquerdo', 'Peito esquerdo', cx + w * 0.27, cy - h * 0.3, s, s),
        flat('peito-direito', 'Peito direito', cx - w * 0.27, cy - h * 0.3, s, s),
      ];
    })();
  list.frame = null;
  return list;
}

// Converte um arrasto na tela (px da foto) em deslocamento da estampa.
export function dragDelta(area, frame, dx, dy) {
  if (area.mode !== 'cyl' || !frame) return { dx, dy };
  const X = dx * frame.ux + dy * frame.uy, Y = dx * frame.vx + dy * frame.vy;
  const c = Math.max(0.3, Math.cos(area.s / frame.R + frame.yaw));
  return { dx: X / c, dy: Y };
}

// ---------- importação ----------
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
    modelo: meta.modelo || '', vista: meta.vista || 'frente', modelagem: meta.modelagem || '', area: null,
    image: b, thumb: await thumbOf(img), w: img.naturalWidth, h: img.naturalHeight, createdAt: Date.now(),
  });
}

// Importa imagens soltas (classificação fica para o usuário e para a IA).
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

// Pacote .json gerado com as fotos já classificadas (tipo, cor, modelo, vista).
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

// ---------- IA: corpo + roupa ----------
export async function detectPhoto(photo) {
  const img = await loadImg(photo.image);
  try {
    const pose = await detectPose(img);
    const shirt = pose.ok ? await analyzeShirt(img, pose, { longSleeve: LONG.test(photo.tipo || '') }) : { ok: false };
    const patch = { pose, shirt, analysis: ANALYSIS_VERSION };
    // frente/costas pela IA corrige a classificação manual
    if (pose.ok && pose.facing === 'back' && photo.vista !== 'costas') patch.vista = 'costas';
    if (pose.ok && pose.facing === 'front' && photo.vista === 'costas') patch.vista = 'frente';
    if (shirt.ok) {
      if (!photo.cor) { patch.cor = shirt.colorName; patch.corHex = shirt.colorHex; }
      if (!photo.modelagem) patch.modelagem = shirt.fit;
    }
    await db.photos.update(photo.id, patch);
    Object.assign(photo, patch);
    return pose;
  } finally { URL.revokeObjectURL(img.src); }
}

export const needsAnalysis = (p) => p.analysis !== ANALYSIS_VERSION;

// Analisa as fotos ainda sem detecção atual (ou todas, com `force`).
export async function detectAll(onProgress, { force = false } = {}) {
  const list = (await db.photos.toArray()).filter((p) => force || needsAnalysis(p));
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
  const gain = mean < 60 ? 2.6 : mean < 120 ? 1.8 : 1.3; // peça escura tem pouca variação: amplifica
  const S = new Uint8ClampedArray(w * h);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) {
    const v = Math.max(0, Math.min(255, 128 + (L[p] - mean) * gain));
    S[p] = v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const entry = { canvas: c, S, w, h };
  shadeCache.clear();
  shadeCache.set(key, entry);
  return entry;
}

// Desloca os pixels da arte conforme o relevo do tecido (dobras).
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
      const sx = Math.round(x - (lum(px + 3, py) - lum(px - 3, py)) * k);
      const sy = Math.round(y - (lum(px, py + 3) - lum(px, py - 3)) * k);
      if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue;
      const si = (sy * bw + sx) * 4, oi = (y * bw + x) * 4;
      o[oi] = s[si]; o[oi + 1] = s[si + 1]; o[oi + 2] = s[si + 2]; o[oi + 3] = s[si + 3];
    }
  }
  actx.putImageData(out, x0, y0);
}

// Arte já no tamanho, girada e (opcionalmente) recolorida, em resolução `scale`.
function prerender(img, layer, area, scale) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const fit = Math.min(area.w / iw, area.h / ih) * layer.scale;
  const aw = iw * fit, ah = ih * fit;
  const r = (layer.rot || 0) * DEG;
  const bw = Math.abs(aw * Math.cos(r)) + Math.abs(ah * Math.sin(r));
  const bh = Math.abs(aw * Math.sin(r)) + Math.abs(ah * Math.cos(r));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(bw * scale)); c.height = Math.max(1, Math.ceil(bh * scale));
  const x = c.getContext('2d');
  x.setTransform(scale, 0, 0, scale, 0, 0);
  x.translate(bw / 2, bh / 2);
  x.rotate(r);
  x.drawImage(img, -aw / 2, -ah / 2, aw, ah);
  if (layer.tint) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = layer.tint;
    x.fillRect(0, 0, c.width, c.height);
  }
  return { c, bw, bh, aw, ah };
}

function strokeOutline(ctx, a) {
  ctx.beginPath();
  if (a.outline && a.mode === 'cyl') a.outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  else {
    const r = (a.rot || 0) * DEG, c = Math.cos(r), s = Math.sin(r);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j], n) => {
      const x = a.cx + (i * a.w / 2) * c - (j * a.h / 2) * s, y = a.cy + (i * a.w / 2) * s + (j * a.h / 2) * c;
      if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * opts: { photo, img, mask, layers: [{ area, x, y, scale, rot, opacity, img, blend, fabric, warp, tint, clip, yaw }] }
 * `fast`: pula a deformação (enquanto arrasta).
 */
export function renderPhotoMockup(ctx, opts, { scale = 1, guides = false, fast = false } = {}) {
  const { photo, img } = opts;
  const W = photo.w, H = photo.h;
  const yawFor = opts.layers?.[0]?.yaw;
  const areas = photoAreas(photo, yawFor ?? undefined);
  const frame = areas.frame;
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
    const pre = prerender(layer.img, layer, area, scale);
    let center;
    actx.setTransform(scale, 0, 0, scale, 0, 0);
    if (area.mode === 'cyl' && frame) {
      // projeção no cilindro do tronco, em fatias verticais
      actx.translate(frame.O.x, frame.O.y);
      actx.rotate(frame.roll);
      const sc = area.s + layer.x, yc = area.y + layer.y;
      const n = Math.min(240, Math.max(24, Math.ceil(pre.c.width / 3)));
      const sliceW = pre.bw / n, srcW = pre.c.width / n;
      for (let i = 0; i < n; i++) {
        const u0 = -pre.bw / 2 + i * sliceW;
        const X0 = frame.axisX + frame.R * Math.sin((sc + u0) / frame.R + frame.yaw);
        const X1 = frame.axisX + frame.R * Math.sin((sc + u0 + sliceW) / frame.R + frame.yaw);
        if (X1 - X0 <= 0.02) continue; // parte que vira para trás do corpo
        actx.drawImage(pre.c, i * srcW, 0, srcW, pre.c.height, X0, yc - pre.bh / 2, X1 - X0 + 0.5 / scale, pre.bh);
      }
      center = frame.proj(sc, yc);
    } else {
      actx.translate(area.cx + layer.x, area.cy + layer.y);
      actx.rotate((area.rot || 0) * DEG);
      actx.drawImage(pre.c, -pre.bw / 2, -pre.bh / 2, pre.bw, pre.bh);
      center = { x: area.cx + layer.x, y: area.cy + layer.y };
    }
    actx.setTransform(1, 0, 0, 1, 0, 0);
    sizes.push({ wCm: frame ? pre.aw / frame.ppc : null, hCm: frame ? pre.ah / frame.ppc : null });

    const shade = shadingFor(photo, img, areas[0]);
    const warp = layer.warp ?? 0.5;
    if (warp > 0 && !fast) {
      const r = Math.hypot(pre.bw, pre.bh) / 2 + 8;
      warpByFabric(actx, shade, { x: (center.x - r) * scale, y: (center.y - r) * scale, w: 2 * r * scale, h: 2 * r * scale }, scale, warp);
    }
    // só onde tem roupa
    if (layer.clip !== false && opts.mask) {
      actx.globalCompositeOperation = 'destination-in';
      actx.imageSmoothingEnabled = true;
      actx.drawImage(opts.mask, 0, 0, art.width, art.height);
      actx.globalCompositeOperation = 'source-over';
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
      actx.drawImage(mask, 0, 0);
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
      if (opts.mask && opts.showMask) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        const tint = document.createElement('canvas');
        tint.width = opts.mask.width; tint.height = opts.mask.height;
        const t = tint.getContext('2d');
        t.drawImage(opts.mask, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = '#c4a96b';
        t.fillRect(0, 0, tint.width, tint.height);
        ctx.drawImage(tint, 0, 0, W, H);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(196,169,107,0.5)';
      ctx.setLineDash([4, 5]);
      for (const a of areas) if (!a.hidden) strokeOutline(ctx, a);
    }
    const sel = opts.layers?.[0];
    const area = areas.find((a) => a.id === sel?.area) || (opts.showArea ? areas[0] : null);
    if (area) {
      ctx.strokeStyle = 'rgba(196,169,107,0.95)';
      ctx.setLineDash([8, 6]);
      strokeOutline(ctx, area);
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
  return { sizes, areas };
}
