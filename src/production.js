// Arquivo de produção: gerado a partir da versão da arte, nunca a partir do mockup.
import { artBlob } from './db.js';
import { loadImage, canvasToBlob, blobToDataURL, slugify } from './util.js';
import { tecLabel } from './data.js';
import { getJsPDF } from './vendor.js';

export const TARGET_DPI = 300;
const MAX_PIXELS = 16e6; // limite seguro de canvas (Safari)

export const isVector = (v) => v?.mime === 'image/svg+xml';
export const heightFor = (v, widthCm) => +(widthCm * (v.height / v.width)).toFixed(1);
export const effectiveDpi = (v, widthCm) => (isVector(v) ? Infinity : Math.round(v.width / (widthCm / 2.54)));

export function targetPixels(pf, dpi = TARGET_DPI) {
  let w = Math.round((pf.widthCm / 2.54) * dpi), h = Math.round((pf.heightCm / 2.54) * dpi);
  let eff = dpi;
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.floor(w * k); h = Math.floor(h * k); eff = Math.floor(dpi * k);
  }
  return { w, h, dpi: eff };
}

// Checagens por técnica. Retorna [{ ok: bool|null, text }]; null = informativo.
export function checks(v, pf) {
  const out = [];
  const dpi = effectiveDpi(v, pf.widthCm);
  const vec = isVector(v);
  out.push(vec
    ? { ok: true, text: 'Arte vetorial (SVG): escala sem perder qualidade.' }
    : dpi >= 300 ? { ok: true, text: `${dpi} DPI no tamanho final (mínimo recomendado: 300).` }
      : dpi >= 200 ? { ok: false, text: `${dpi} DPI no tamanho final. Aceitável para DTF, mas abaixo dos 300 recomendados.` }
        : { ok: false, text: `${dpi} DPI no tamanho final: vai imprimir serrilhado. Use uma arte maior ou reduza a estampa.` });
  if (['dtf', 'dtg', 'transfer'].includes(pf.tecnica)) {
    out.push(v.hasAlpha === false
      ? { ok: false, text: 'Sem fundo transparente: o retângulo do fundo também será impresso.' }
      : { ok: true, text: 'Fundo transparente.' });
  }
  if (pf.tecnica === 'serigrafia') {
    const n = pf.colors?.length || 0;
    out.push({ ok: null, text: `${n || '?'} cor(es) detectada(s) = ${n || '?'} tela(s). A gráfica precisa fazer a separação de cores${vec ? '' : ', de preferência a partir de um vetor'}.` });
  }
  if (pf.tecnica === 'bordado') out.push({ ok: false, text: 'Bordado exige matriz (DST/PES) feita por um digitalizador a partir desta arte.' });
  if (pf.tecnica === 'sublimacao') out.push({ ok: null, text: 'Sublimação só funciona em tecido de poliéster claro.' });
  if (String(v.origin || '').startsWith('ia')) out.push({ ok: false, text: 'Arte gerada por IA: revise contornos, textos e cores antes de mandar para a gráfica.' });
  return out;
}

// Cores dominantes (ignora transparência e ruído de antisserrilhado).
export function dominantColors(img, max = 8) {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  let data;
  try { data = ctx.getImageData(0, 0, S, S).data; } catch { return []; }
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n++;
    buckets.set(key, b);
    total++;
  }
  const cols = [...buckets.values()].map((b) => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, n: b.n })).sort((a, b) => b.n - a.n);
  const merged = [];
  for (const col of cols) {
    const near = merged.find((m) => Math.hypot(m.r - col.r, m.g - col.g, m.b - col.b) < 48);
    if (near) near.n += col.n; else merged.push({ ...col });
  }
  const hex = (x) => Math.round(x).toString(16).padStart(2, '0');
  return merged.filter((m) => m.n / total >= 0.02).slice(0, max).map((m) => `#${hex(m.r)}${hex(m.g)}${hex(m.b)}`);
}

// ---- PNG com DPI gravado (chunk pHYs), para a gráfica abrir no tamanho certo ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function withDpi(blob, dpi) {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 33; // assinatura (8) + IHDR (25)
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, at)); out.set(chunk, at); out.set(src.subarray(at), at + chunk.length);
  return new Blob([out], { type: 'image/png' });
}

export async function renderProductionPNG(v, pf) {
  const img = await loadImage(artBlob(v));
  const { w, h, dpi } = targetPixels(pf);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await withDpi(await canvasToBlob(c, 'image/png'), dpi);
  return { blob, dpi, w, h };
}

export const fileBase = (pf) => `${slugify(pf.name)}-${pf.tecnica}-${pf.widthCm}x${pf.heightCm}cm`;

// PDF 1:1: a arte no tamanho real, com marcas de corte e a ficha no rodapé.
export async function productionPDF(v, pf) {
  const jsPDF = await getJsPDF();
  const { blob, dpi } = await renderProductionPNG(v, pf);
  const wmm = pf.widthCm * 10, hmm = pf.heightCm * 10, m = 20, foot = 34;
  const pw = wmm + m * 2, ph = hmm + m * 2 + foot;
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'l' : 'p', compress: true });
  doc.setProperties({ title: `${pf.name} · produção`, creator: 'EKKLESIA STUDIO' });
  doc.addImage(await blobToDataURL(blob), 'PNG', m, m, wmm, hmm, undefined, 'FAST');
  doc.setDrawColor(0); doc.setLineWidth(0.2);
  const mark = 6, gap = 2;
  for (const [x, y, dx, dy] of [[m, m, -1, -1], [m + wmm, m, 1, -1], [m, m + hmm, -1, 1], [m + wmm, m + hmm, 1, 1]]) {
    doc.line(x + dx * gap, y, x + dx * (gap + mark), y);
    doc.line(x, y + dy * gap, x, y + dy * (gap + mark));
  }
  const y0 = m + hmm + m;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20);
  doc.text(`${pf.name}  |  ESCALA 1:1`, m, y0);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
  const lines = [
    `Técnica: ${tecLabel(pf.tecnica)}   Área: ${pf.area || '-'}   Tamanho: ${pf.widthCm} x ${pf.heightCm} cm   Resolução: ${dpi} DPI${isVector(v) ? ' (vetor original disponível)' : ''}`,
    `Cores: ${(pf.colors || []).join('  ') || '-'}`,
    pf.notes ? `Obs.: ${pf.notes}` : '',
  ].filter(Boolean);
  doc.text(doc.splitTextToSize(lines.join('\n'), pw - m * 2), m, y0 + 6);
  let x = m;
  for (const col of pf.colors || []) { doc.setFillColor(col); doc.rect(x, ph - 10, 6, 4, 'F'); x += 8; }
  return doc.output('blob');
}
