// Catálogo em PDF desenhado direto no jsPDF: texto real, botões e QR Codes
// clicáveis (links de compra, site, Instagram, WhatsApp) e índice com links internos.
import { db } from './db.js';
import { getJsPDF, qrMatrix } from './vendor.js';
import { brl, installmentText, tecLabel, dispLabel, buyLink, siteURL, instagramURL, whatsappURL } from './data.js';
import { productImages, toJpegDataURL } from './products.js';

const PW = 210, PH = 297, M = 18;
const C = { ink: '#0c0c0c', paper: '#f3f1ec', panel: '#dbd7cf', gold: '#b39558', grey: '#6f6b64', light: '#a8a39a', white: '#ffffff' };

// Fontes padrão do PDF usam WinAnsi: troca o que não existe nelas.
const safe = (s) => String(s ?? '').replace(/[→←–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/ /g, ' ').replace(/[^\x00-\xff]/g, '');

function font(doc, family, style, size, color) {
  doc.setFont(family, style);
  doc.setFontSize(size);
  doc.setTextColor(color);
}

// Texto com espaçamento entre letras, alinhado à esquerda/centro/direita.
function spaced(doc, text, x, y, cs = 0, align = 'left') {
  const t = safe(text);
  const w = doc.getTextWidth(t) + cs * Math.max(0, t.length - 1);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  doc.text(t, x0, y, { charSpace: cs });
  return w;
}

function bg(doc, color) {
  doc.setFillColor(color);
  doc.rect(0, 0, PW, PH, 'F');
}

function button(doc, { x, y, w, h = 12, label, url, fill = C.ink, text = C.white, stroke = null }) {
  if (stroke) { doc.setDrawColor(stroke); doc.setLineWidth(0.35); doc.rect(x, y, w, h, 'S'); }
  else { doc.setFillColor(fill); doc.rect(x, y, w, h, 'F'); }
  font(doc, 'helvetica', 'bold', 8, text);
  spaced(doc, label, x + w / 2, y + h / 2 + 1.1, 0.9, 'center');
  if (url) doc.link(x, y, w, h, { url });
}

async function qr(doc, url, x, y, size, fg = C.ink, bgc = C.white) {
  const m = await qrMatrix(url);
  const q = 2, mod = size / (m.n + q * 2);
  doc.setFillColor(bgc);
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor(fg);
  for (let r = 0; r < m.n; r++) {
    let c = 0;
    while (c < m.n) {
      if (!m.dark(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < m.n && m.dark(r, c + run)) run++;
      doc.rect(x + (c + q) * mod, y + (r + q) * mod, run * mod + 0.01, mod + 0.01, 'F');
      c += run;
    }
  }
  doc.link(x, y, size, size, { url });
}

function footer(doc, brand, n, total, dark = false) {
  doc.setDrawColor(dark ? '#2a2a2a' : '#d8d3ca');
  doc.setLineWidth(0.2);
  doc.line(M, PH - 14, PW - M, PH - 14);
  font(doc, 'helvetica', 'normal', 6.5, dark ? C.grey : C.light);
  spaced(doc, (brand.brandName || 'EKKLESIA').toUpperCase(), M, PH - 9, 1.6);
  spaced(doc, `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, PW - M, PH - 9, 0.8, 'right');
}

function cover(doc, brand, catalog, count) {
  bg(doc, C.ink);
  font(doc, 'helvetica', 'normal', 7.5, C.gold);
  spaced(doc, `CATÁLOGO ${new Date().getFullYear()}`, PW / 2, 32, 2.4, 'center');
  font(doc, 'times', 'normal', 50, C.white);
  spaced(doc, (brand.brandName || 'EKKLESIA').toUpperCase(), PW / 2, 142, 3.2, 'center');
  doc.setDrawColor(C.gold); doc.setLineWidth(0.4);
  doc.line(PW / 2 - 14, 154, PW / 2 + 14, 154);
  font(doc, 'times', 'italic', 22, '#e8e4dc');
  spaced(doc, catalog.title || 'Coleção', PW / 2, 170, 0, 'center');
  const sub = catalog.subtitle || brand.tagline;
  if (sub) { font(doc, 'helvetica', 'normal', 8.5, C.light); doc.text(doc.splitTextToSize(safe(sub), 120), PW / 2, 182, { align: 'center' }); }
  font(doc, 'helvetica', 'normal', 7, C.grey);
  spaced(doc, `${count} ${count === 1 ? 'PEÇA' : 'PEÇAS'}`, M, PH - 18, 1.6);
  const site = siteURL(brand.site);
  if (site) { spaced(doc, brand.site.replace(/^https?:\/\//, '').toUpperCase(), PW - M, PH - 18, 1.2, 'right'); doc.link(PW - M - 70, PH - 23, 70, 8, { url: site }); }
}

function intro(doc, brand, catalog, products, firstPage, total) {
  bg(doc, C.paper);
  font(doc, 'helvetica', 'normal', 7.5, C.gold);
  spaced(doc, 'A MARCA', M, 38, 2.4);
  font(doc, 'times', 'normal', 34, C.ink);
  doc.text(safe(brand.brandName || 'EKKLESIA'), M, 54);
  font(doc, 'helvetica', 'normal', 10.5, '#3b3935');
  const text = brand.apresentacao || 'Cadastre a apresentação da marca em Configurações.';
  const lines = doc.splitTextToSize(safe(text), 140).slice(0, 16);
  doc.setLineHeightFactor(1.55);
  doc.text(lines, M, 68);
  let y = Math.max(140, 68 + lines.length * 6.2 + 18);
  font(doc, 'helvetica', 'normal', 7.5, C.gold);
  spaced(doc, 'NESTA COLEÇÃO', M, y, 2.4);
  y += 8;
  doc.setDrawColor('#d8d3ca'); doc.setLineWidth(0.2);
  const maxRows = Math.floor((PH - 30 - y) / 9);
  products.slice(0, maxRows).forEach((p, i) => {
    doc.line(M, y, PW - M, y);
    font(doc, 'helvetica', 'normal', 7.5, C.light);
    doc.text(String(i + 1).padStart(2, '0'), M, y + 6);
    font(doc, 'helvetica', 'normal', 10, C.ink);
    doc.textWithLink(safe(p.nome), M + 12, y + 6, { pageNumber: firstPage + i });
    font(doc, 'helvetica', 'normal', 9.5, C.grey);
    doc.text(p.preco ? brl(p.preco) : '', PW - M, y + 6, { align: 'right' });
    y += 9;
  });
  if (products.length) doc.line(M, y, PW - M, y);
  footer(doc, brand, 2, total);
}

async function productPage(doc, p, brand, n, total) {
  bg(doc, C.paper);
  const imgs = (await productImages(p)).slice(0, 2);
  const panelH = 168;
  doc.setFillColor(C.panel);
  doc.rect(0, 0, PW, panelH, 'F');
  if (imgs[0]) {
    const im = await toJpegDataURL(imgs[0].blob, { bg: C.panel, pad: imgs[0].kind === 'art' ? 120 : 0 });
    const h = 156, w = (h * im.w) / im.h;
    const x = imgs[1] ? M + 8 : (PW - w) / 2;
    doc.addImage(im.url, 'JPEG', x, 6, w, h, undefined, 'FAST');
  }
  if (imgs[1]) {
    const im = await toJpegDataURL(imgs[1].blob, { bg: C.panel, max: 700 });
    const w = 42, h = (w * im.h) / im.w;
    doc.setFillColor(C.white);
    doc.rect(PW - M - w - 1.5, panelH - h - 11.5, w + 3, h + 3, 'F');
    doc.addImage(im.url, 'JPEG', PW - M - w, panelH - h - 10, w, h, undefined, 'FAST');
  }

  // coluna esquerda
  let y = 184;
  font(doc, 'helvetica', 'normal', 7, C.gold);
  spaced(doc, [p.sku, p.categoria].filter(Boolean).join('  ·  ').toUpperCase(), M, y, 1.6);
  font(doc, 'times', 'normal', 24, C.ink);
  const title = doc.splitTextToSize(safe(p.nome), 112).slice(0, 2);
  doc.setLineHeightFactor(1.1);
  doc.text(title, M, y + 11);
  y += 11 + title.length * 9.5;
  font(doc, 'helvetica', 'bold', 14, C.ink);
  const price = p.preco ? brl(p.preco) : 'Consulte';
  doc.text(price, M, y);
  const priceW = doc.getTextWidth(price);
  const inst = installmentText(p);
  if (inst) { font(doc, 'helvetica', 'normal', 8.5, C.grey); doc.text(safe(inst), M + priceW + 4, y); }
  y += 8;
  if (p.descricao) {
    font(doc, 'helvetica', 'normal', 9, '#3b3935');
    doc.setLineHeightFactor(1.45);
    const d = doc.splitTextToSize(safe(p.descricao), 112);
    const maxLines = Math.max(2, Math.floor((246 - y) / 4.7));
    const shown = d.slice(0, maxLines);
    if (d.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1].replace(/\s+\S*$/, '')}...`;
    doc.text(shown, M, y);
  }

  // coluna direita: ficha
  const sizes = Object.keys(p.medidas || {});
  const specs = [
    ['MATERIAL', [p.material, p.gramatura && `${p.gramatura} g/m²`].filter(Boolean).join(' · ')],
    ['TÉCNICA', tecLabel(p.tecnica)],
    ['CORES', (p.cores || []).join(', ')],
    ['TAMANHOS', (p.tamanhos || []).join('  ')],
    ['MEDIDAS (L x C)', sizes.map((s) => `${s} ${p.medidas[s].largura || '-'}x${p.medidas[s].comprimento || '-'}`).join('  ')],
    ['DISPONIBILIDADE', dispLabel(p.disponibilidade)],
  ].filter(([, v]) => v);
  let sy = 184;
  const sx = 140, sw = PW - M - sx;
  for (const [label, value] of specs) {
    font(doc, 'helvetica', 'normal', 6.3, C.gold);
    spaced(doc, label, sx, sy, 1.1);
    font(doc, 'helvetica', 'normal', 8.8, C.ink);
    const v = doc.splitTextToSize(safe(value), sw).slice(0, 2);
    doc.setLineHeightFactor(1.3);
    doc.text(v, sx, sy + 4.6);
    sy += 6 + v.length * 4.4;
    if (sy > 244) break;
  }

  // compra
  const buy = buyLink(p, brand);
  if (buy) {
    button(doc, { x: M, y: 252, w: 86, h: 13, label: buy.label, url: buy.url });
    await qr(doc, buy.url, PW - M - 24, 247, 24, C.ink, C.paper);
    font(doc, 'helvetica', 'normal', 6, C.grey);
    spaced(doc, 'APONTE A CÂMERA', PW - M - 28, 256, 0.8, 'right');
    spaced(doc, 'PARA COMPRAR', PW - M - 28, 259.5, 0.8, 'right');
  }
  footer(doc, brand, n, total);
}

async function back(doc, brand, catalog, n) {
  bg(doc, C.ink);
  font(doc, 'times', 'normal', 30, C.white);
  spaced(doc, (brand.brandName || 'EKKLESIA').toUpperCase(), PW / 2, 92, 2.4, 'center');
  if (brand.tagline) { font(doc, 'times', 'italic', 15, '#d9d4ca'); doc.text(doc.splitTextToSize(safe(brand.tagline), 130), PW / 2, 106, { align: 'center' }); }
  const links = [
    ['VER SITE', siteURL(brand.site)],
    ['INSTAGRAM', instagramURL(brand.instagram)],
    ['WHATSAPP', whatsappURL(brand.whatsapp)],
  ].filter(([, u]) => u);
  let y = 128;
  for (const [label, url] of links) {
    button(doc, { x: PW / 2 - 45, y, w: 90, h: 12, label, url, stroke: C.gold, text: C.white });
    y += 17;
  }
  const qrUrl = links[0]?.[1];
  if (qrUrl) await qr(doc, qrUrl, PW / 2 - 15, y + 8, 30, C.ink, C.white);
  if (!links.length) { font(doc, 'helvetica', 'normal', 9, C.grey); doc.text('Cadastre site, Instagram e WhatsApp em Configurações.', PW / 2, 140, { align: 'center' }); }
  font(doc, 'helvetica', 'normal', 6.5, C.grey);
  spaced(doc, safe(catalog.title || '').toUpperCase(), PW / 2, PH - 16, 1.6, 'center');
}

export async function buildCatalogPDF(catalog, brand) {
  const jsPDF = await getJsPDF();
  const products = (await db.products.bulkGet(catalog.productIds || [])).filter(Boolean);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: safe(`${brand.brandName || 'EKKLESIA'} · ${catalog.title || 'Catálogo'}`), creator: 'EKKLESIA STUDIO' });
  const total = products.length + 3;
  cover(doc, brand, catalog, products.length);
  doc.addPage();
  intro(doc, brand, catalog, products, 3, total);
  for (let i = 0; i < products.length; i++) {
    doc.addPage();
    await productPage(doc, products[i], brand, i + 3, total);
  }
  doc.addPage();
  await back(doc, brand, catalog, total);
  return doc.output('blob');
}
