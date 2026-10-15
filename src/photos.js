// Peças reais: fotos das peças do fornecedor usadas como base de mockup.
// A arte é aplicada sobre a foto e recebe as dobras/luz do tecido da própria foto.
import { db } from './db.js';
import { canvasToBlob, dataURLToBlob } from './util.js';
import { drawLayer } from './compose.js';

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

// Área de estampa padrão (proporção da foto) por enquadramento. Ajustável por foto.
export const DEFAULT_AREA = {
  frente: { cx: 0.51, cy: 0.43, w: 0.3, h: 0.22 },
  inteiro: { cx: 0.5, cy: 0.36, w: 0.16, h: 0.13 },
  costas: { cx: 0.52, cy: 0.46, w: 0.32, h: 0.28 },
  detalhe: { cx: 0.5, cy: 0.6, w: 0.45, h: 0.3 },
};

// Áreas em px da foto: principal + peitos (derivados da principal).
export function photoAreas(p) {
  const a = p.area || DEFAULT_AREA[p.vista] || DEFAULT_AREA.frente;
  const cx = a.cx * p.w, cy = a.cy * p.h, w = a.w * p.w, h = a.h * p.h;
  const main = { id: 'principal', label: p.vista === 'costas' ? 'Costas' : 'Estampa grande', cx, cy, w, h, rot: 0 };
  if (p.vista === 'costas') return [main, { id: 'costas-superior', label: 'Costas superior', cx, cy: cy - h * 0.38, w: w * 0.8, h: h * 0.22, rot: 0 }];
  const s = Math.min(w, h) * 0.32;
  return [
    main,
    { id: 'peito-central', label: 'Peito central', cx, cy: cy - h * 0.3, w: w * 0.42, h: h * 0.3, rot: 0 },
    { id: 'peito-esquerdo', label: 'Peito esquerdo', cx: cx + w * 0.27, cy: cy - h * 0.3, w: s, h: s, rot: 0 },
    { id: 'peito-direito', label: 'Peito direito', cx: cx - w * 0.27, cy: cy - h * 0.3, w: s, h: s, rot: 0 },
  ];
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
  // peça escura tem pouca variação de luz: amplifica mais
  const gain = mean < 60 ? 2.6 : mean < 120 ? 1.8 : 1.3;
  for (let p = 0, i = 0; p < L.length; p++, i += 4) {
    const v = Math.max(0, Math.min(255, 128 + (L[p] - mean) * gain));
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  shadeCache.clear(); // guarda só o último (memória)
  shadeCache.set(key, c);
  return c;
}

/**
 * opts: { photo, img, layers: [{ area, x, y, scale, rot, opacity, img, blend, fabric }] }
 */
export function renderPhotoMockup(ctx, opts, { scale = 1, guides = false } = {}) {
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
    const actx = art.getContext('2d');
    actx.setTransform(scale, 0, 0, scale, 0, 0);
    const box = drawLayer(actx, layer.img, { ...layer, opacity: 1 }, area);
    sizes.push(box);
    const fabric = layer.fabric ?? 0.6;
    if (fabric > 0) {
      actx.globalCompositeOperation = 'overlay';
      actx.globalAlpha = fabric;
      actx.drawImage(shadingFor(photo, img, areas[0]), 0, 0, W, H);
      actx.globalAlpha = 1;
      actx.globalCompositeOperation = 'destination-in';
      drawLayer(actx, layer.img, { ...layer, opacity: 1 }, area); // recorta de volta no formato da arte
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend === 'multiply' ? 'multiply' : 'source-over';
    ctx.drawImage(art, 0, 0);
    ctx.restore();
  }

  if (guides) {
    const sel = opts.layers?.[0];
    const area = areas.find((a) => a.id === sel?.area) || (opts.showArea ? areas[0] : null);
    if (area) {
      ctx.strokeStyle = 'rgba(196,169,107,0.95)';
      ctx.lineWidth = 2 / Math.max(scale, 0.5);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(area.cx - area.w / 2, area.cy - area.h / 2, area.w, area.h);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  return { sizes };
}
