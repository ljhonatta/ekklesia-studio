// Banco local (IndexedDB via Dexie). Arte, mockup e produção ficam em tabelas
// separadas — nunca tratar os três como a mesma coisa.
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs';
import { blobToDataURL, dataURLToBlob } from './util.js';

export const db = new Dexie('ekklesia-studio');

db.version(1).stores({
  designs: '++id, status, updatedAt',
  // Versões são imutáveis: nunca editar `original` nem apagar automaticamente.
  versions: '++id, designId, createdAt',
  mockups: '++id, designId, updatedAt',
  // Fase 2 — já criadas para não exigir migração.
  products: '++id, &slug, sku, status',
  productionFiles: '++id, designId, versionId',
  catalogs: '++id',
  catalogItems: '++id, catalogId, productId',
  settings: 'key',
});
// v2: fotos reais das peças do fornecedor (base de mockup). Ficam só no navegador.
db.version(2).stores({ photos: '++id, tipo, createdAt' });

export const STATUS = [
  { id: 'criacao', label: 'Em criação' },
  { id: 'aprovado', label: 'Aprovado' },
  { id: 'producao', label: 'Produção' },
  { id: 'publicado', label: 'Publicado' },
];
export const statusLabel = (id) => STATUS.find((s) => s.id === id)?.label || id;

// Imagem usada para exibir/compor (SVG normalizado quando houver); o original fica intacto.
export const artBlob = (v) => v?.preview || v?.original;

export function createDesign(name, art, status = 'criacao') {
  return db.transaction('rw', db.designs, db.versions, async () => {
    const now = Date.now();
    const id = await db.designs.add({
      name, status, createdAt: now, updatedAt: now, versionCount: 0, currentVersionId: null,
    });
    await addVersionTx(id, art, 'upload');
    return id;
  });
}

async function addVersionTx(designId, art, origin, note = '') {
  const d = await db.designs.get(designId);
  const n = (d.versionCount || 0) + 1;
  const now = Date.now();
  const vid = await db.versions.add({
    designId, n, origin, note, createdAt: now,
    original: art.original, preview: art.preview || null, thumb: art.thumb,
    mime: art.mime, fileName: art.fileName, size: art.size,
    width: art.width, height: art.height, hasAlpha: art.hasAlpha,
    parentId: d.currentVersionId || null,
  });
  await db.designs.update(designId, { versionCount: n, currentVersionId: vid, updatedAt: now });
  return vid;
}

export const addVersion = (designId, art, origin = 'upload', note = '') =>
  db.transaction('rw', db.designs, db.versions, () => addVersionTx(designId, art, origin, note));

export const setCurrentVersion = (designId, versionId) =>
  db.designs.update(designId, { currentVersionId: versionId, updatedAt: Date.now() });

// Exclusão só por ação explícita do usuário. Mockups continuam salvos como imagem.
export function deleteDesign(id) {
  return db.transaction('rw', db.designs, db.versions, db.mockups, async () => {
    await db.versions.where('designId').equals(id).delete();
    await db.mockups.where('designId').equals(id).modify({ designId: null });
    await db.designs.delete(id);
  });
}

export async function currentVersions(designs) {
  const ids = designs.map((d) => d.currentVersionId).filter(Boolean);
  const vs = await db.versions.bulkGet(ids);
  return new Map(vs.filter(Boolean).map((v) => [v.designId, v]));
}

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
export const setSetting = (key, value) => db.settings.put({ key, value });

// ---------- Backup ----------
const TABLES = ['designs', 'versions', 'mockups', 'products', 'productionFiles', 'catalogs', 'catalogItems', 'settings', 'photos'];

// Blobs (inclusive aninhados, como a logo em settings) viram data URLs no JSON.
async function encode(v) {
  if (v instanceof Blob) return { __blob: await blobToDataURL(v) };
  if (Array.isArray(v)) return Promise.all(v.map(encode));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await encode(x)])));
  return v;
}
async function decode(v) {
  if (v && typeof v === 'object' && typeof v.__blob === 'string') return dataURLToBlob(v.__blob);
  if (Array.isArray(v)) return Promise.all(v.map(decode));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await decode(x)])));
  return v;
}

export async function exportBackup() {
  const out = { app: 'ekklesia-studio', schema: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const rows = await db.table(t).toArray();
    out.tables[t] = await Promise.all(rows.map(encode));
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'ekklesia-studio' || !data.tables) throw new Error('Arquivo não é um backup do EKKLESIA STUDIO.');
  // Decodifica tudo antes da transação (await fora do IndexedDB encerraria a transação).
  const decoded = {};
  for (const t of TABLES) {
    decoded[t] = await Promise.all((data.tables[t] || []).map(decode));
  }
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      if (decoded[t].length) await db.table(t).bulkAdd(decoded[t]);
    }
  });
}
