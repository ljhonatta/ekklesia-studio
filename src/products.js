// Consultas de produto compartilhadas por telas e catálogo.
import { db, artBlob } from './db.js';
import { loadImage, slugify } from './util.js';

// Imagens do produto em ordem: mockups escolhidos; senão fotos da peça (modelo
// vestindo ou peça base do fornecedor); por último, a arte atual.
export async function productImages(p) {
  const ms = (await db.mockups.bulkGet(p.mockupIds || [])).filter(Boolean);
  if (ms.length) return ms.map((m) => ({ blob: m.render || m.thumb, kind: 'mockup' }));
  const fotos = (p.fotos || []).filter((b) => b instanceof Blob);
  if (fotos.length) return fotos.map((blob) => ({ blob, kind: 'photo' }));
  if (p.designId) {
    const d = await db.designs.get(p.designId);
    const v = d && (await db.versions.get(d.currentVersionId));
    if (v) return [{ blob: artBlob(v), kind: 'art' }];
  }
  return [];
}

// Cópia para outra arte: mesmo preço, ficha e fotos base; sem arte, mockups nem vendas.
export async function duplicateProduct(id) {
  const src = await db.products.get(id);
  const { id: _, createdAt, updatedAt, ...rest } = src;
  const nome = `${src.nome} (cópia)`;
  const now = Date.now();
  return db.products.add({
    ...structuredClone(rest), nome, sku: await nextSku(), slug: await uniqueSlug(slugify(nome)), status: 'rascunho',
    designId: null, productionFileId: null, mockupIds: [], lancVendidos: 0, linkCompra: '', base: false, baseId: src.base ? src.id : src.baseId || null,
    createdAt: now, updatedAt: now,
  });
}

// Converte imagem em JPEG com fundo (para PDF), limitada a `max` px no lado maior.
// Marca d'água da loja: logo branca (fundo preto vira transparente), com sombra leve.
const MARCAS = { ekk: 'assets/marca-ekk.webp', ekl: 'assets/marca-ekl.webp' };
const marcaCache = {};
export async function watermarkImage(tipo = 'ekk') {
  if (marcaCache[tipo]) return marcaCache[tipo];
  let src;
  if (tipo === 'logo') { const { getLogo, tinted } = await import('./brand.js'); const l = await getLogo(); src = l ? tinted(l, '#ffffff', 900) : null; }
  if (!src) src = await loadImage(await (await fetch(MARCAS[tipo] || MARCAS.ekk)).blob());
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  if (tipo !== 'logo') { // branco sobre preto → branco com alfa
    const id = x.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const L = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, (L - 40) * 1.4)); }
    x.putImageData(id, 0, 0);
  }
  return (marcaCache[tipo] = c);
}

export async function toJpegDataURL(blob, { bg = '#e6e2da', max = 1200, pad = 0, marca = null } = {}) {
  const img = await loadImage(blob);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = h + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, pad, pad, w, h);
  if (marca) {
    const mw = c.width * 0.16, mh = mw * (marca.height / marca.width), m = c.width * 0.035;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = c.width * 0.006;
    ctx.drawImage(marca, c.width - mw - m, c.height - mh - m, mw, mh);
    ctx.restore();
  }
  return { url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
}

export async function nextSku() {
  const all = await db.products.toArray();
  const n = all.reduce((m, p) => Math.max(m, +(String(p.sku || '').match(/^EKK-(\d+)$/)?.[1] || 0)), 0) + 1;
  return `EKK-${String(n).padStart(3, '0')}`;
}

export async function uniqueSlug(base, selfId) {
  let slug = base || 'produto', i = 2;
  for (;;) {
    const hit = await db.products.where('slug').equals(slug).first();
    if (!hit || hit.id === selfId) return slug;
    slug = `${base}-${i++}`;
  }
}
