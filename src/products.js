// Consultas de produto compartilhadas por telas e catálogo.
import { db, artBlob } from './db.js';
import { loadImage, slugify } from './util.js';

// Imagens do produto em ordem: mockups escolhidos; sem mockup, a arte atual;
// sem arte, as fotos da peça base (fornecedor).
export async function productImages(p) {
  const ms = (await db.mockups.bulkGet(p.mockupIds || [])).filter(Boolean);
  if (ms.length) return ms.map((m) => ({ blob: m.render || m.thumb, kind: 'mockup' }));
  if (p.designId) {
    const d = await db.designs.get(p.designId);
    const v = d && (await db.versions.get(d.currentVersionId));
    if (v) return [{ blob: artBlob(v), kind: 'art' }];
  }
  return (p.fotos || []).filter((b) => b instanceof Blob).map((blob) => ({ blob, kind: 'photo' }));
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
export async function toJpegDataURL(blob, { bg = '#e6e2da', max = 1200, pad = 0 } = {}) {
  const img = await loadImage(blob);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = h + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, pad, pad, w, h);
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
