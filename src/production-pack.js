// Pacote de produção: a partir de UMA arte, gera tudo o que a gráfica pede, no
// padrão das pastas da marca (ex.: MARANATA):
//   0_DTF        arte colorida, fundo transparente, padrão e oversize
//   1_SERIGRAFIA tinta preta (camisa clara) e off-white (camisa escura), padrão e oversize
//   2_BORDADO    arte plana e efeito bordado, linha preta e off-white
//   3_FOTOLITO   um filme (preto) por cor de tinta, tamanho oversize
// Tudo PNG transparente a 300 DPI, com o DPI gravado no arquivo.
import { loadImage, canvasToBlob, slugify } from './util.js';
import { withDpi, TARGET_DPI } from './production.js';
import { colorName } from './shirt.js';
import { removeBackground } from './bgremove.js';

export const SIZES = { oversize: { estampa: 34, bordado: 14 }, padrao: { estampa: 26, bordado: 10 } };
export const INKS = { preta: { hex: '#141414', rgb: [20, 20, 20], camisa: 'camisa-clara' }, 'off-white': { hex: '#ede9df', rgb: [237, 233, 223], camisa: 'camisa-escura' } };
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_PIXELS = IOS ? 16e6 : 40e6;

const MASC = { vermelha: 'vermelho', amarela: 'amarelo', preta: 'preto', branca: 'branco', roxa: 'roxo', areia: 'dourado', caramelo: 'dourado' };
const px = (cm, dpi = TARGET_DPI) => Math.round((cm / 2.54) * dpi);
function fitSize(widthCm, aspect) {
  let dpi = TARGET_DPI, w = px(widthCm), h = Math.round(w * aspect);
  if (w * h > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * h)); w = Math.floor(w * k); h = Math.floor(h * k); dpi = Math.floor(TARGET_DPI * k); }
  return { w, h, dpi };
}

/**
 * Lê a arte (em resolução de trabalho) e separa as tintas:
 *  - neutra: preto/cinza/branco (a "tinta principal"), cobertura pela luminância
 *  - destaques: cores saturadas (vermelho, dourado...), agrupadas por matiz
 */
export async function analyzeArt(blob) {
  const img = await loadImage(blob);
  const S = 400, k = S / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  // fundo: cor das bordas (branco, preto ou transparente)
  let br = 0, bg = 0, bb = 0, ba = 0, n = 0;
  const edge = (i) => { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; ba += d[i + 3]; n++; };
  for (let X = 0; X < c.width; X++) { edge(X * 4); edge(((c.height - 1) * c.width + X) * 4); }
  for (let Y = 0; Y < c.height; Y++) { edge(Y * c.width * 4); edge((Y * c.width + c.width - 1) * 4); }
  const bgA = ba / n, bgL = (br + bg + bb) / (3 * n);
  const background = bgA < 128 ? 'transparente' : bgL > 128 ? 'claro' : 'escuro';
  let neutral = 0, neutralL = 0, accent = 0;
  const hues = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 40) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (r + g + b) / 3;
    if (background === 'claro' && L > 235 && mx - mn < 25) continue; // fundo branco
    if (background === 'escuro' && L < 25) continue; // fundo preto
    if (mx - mn > 60) {
      accent++;
      const h = hueOf(r, g, b), key = Math.round(h / 30) % 12;
      const e = hues.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b; hues.set(key, e);
    } else { neutral++; neutralL += L; }
  }
  const total = neutral + accent || 1;
  const accents = [...hues.values()].filter((e) => e.n / total > 0.01).sort((a, b) => b.n - a.n)
    .map((e) => { const rgb = [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round); const n = colorName(rgb).n; return { rgb, name: MASC[n] || n, hue: hueOf(...rgb) }; });
  // tinta principal escura (arte preta) ou clara (arte branca)
  const inkDark = background === 'escuro' ? false : background === 'claro' ? true : neutral ? neutralL / neutral < 128 : true;
  return {
    img, background, inkDark, accents,
    // muitas cores fortes = arte colorida: serigrafia por cor não faz sentido (só DTF)
    colorida: accent / total > 0.35 || accents.length > 3,
  };
}

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn || 1;
  const h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return (h * 60 + 360) % 360;
}

// Desenha a arte no tamanho final e devolve o ImageData de origem.
function drawAt(img, w, h, crop) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const r = crop || { x: 0, y: 0, w: 1, h: 1 };
  x.drawImage(img, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, w, h);
  return { c, x };
}

/**
 * Converte a arte numa "camada de tinta":
 *  mode 'cor'   → cores originais, fundo removido (DTF)
 *  mode 'tinta' → tinta principal trocada por `ink`, destaques mantidos (serigrafia/bordado)
 *  mode 'filme' → só a tinta `only` ('principal' ou índice do destaque), em preto (fotolito)
 */
function inkLayer(c, x, info, { mode, ink, only }) {
  const id = x.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const { background, inkDark, accents } = info;
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3] / 255;
    if (!a) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (r + g + b) / 765;
    const isAccent = mx - mn > 60;
    // cobertura da tinta principal: quanto mais longe do fundo, mais tinta
    const cover = inkDark ? 1 - L : L;
    let out = null;
    if (isAccent) {
      let k = 0;
      if (accents.length > 1) { const h = hueOf(r, g, b); k = accents.reduce((best, ac, j) => (Math.min(Math.abs(ac.hue - h), 360 - Math.abs(ac.hue - h)) < Math.min(Math.abs(accents[best].hue - h), 360 - Math.abs(accents[best].hue - h)) ? j : best), 0); }
      if (mode === 'filme') out = only === k ? [0, 0, 0, a] : null;
      else out = [r, g, b, a * (background === 'claro' ? Math.min(1, (1 - L) * 1.6 + 0.2) : 1)];
    } else {
      // branco dentro da arte não é tinta: vira transparente (a cor da camisa aparece)
      const cov = a * Math.min(1, cover * 1.15);
      if (mode === 'filme') out = only === 'principal' ? [0, 0, 0, cov] : null;
      else if (mode === 'tinta') out = [...ink, cov];
      else out = background === 'transparente' ? [r, g, b, a] : [r, g, b, cov]; // cor
    }
    if (!out || out[3] < 0.02) { d[i + 3] = 0; continue; }
    [d[i], d[i + 1], d[i + 2]] = out;
    d[i + 3] = Math.round(out[3] * 255);
  }
  x.putImageData(id, 0, 0);
  return c;
}

// DTF: cores originais. Fundo liso (branco/preto) sai só por fora da arte, então
// brancos de dentro (letras, preenchimentos) continuam impressos.
export function dtfLayer(img, w, h, info) {
  const { c } = drawAt(img, w, h);
  if (info.background === 'transparente') return c;
  return removeBackground(c, { color: info.background === 'claro' ? '#ffffff' : '#000000', tolerance: 38, mode: 'borda', smooth: true, trim: false });
}
export { drawAt, inkLayer };

// Simulação de bordado: fios em diagonal, relevo e sombra (só para aprovar visualmente).
function embroider(src) {
  const w = src.width, h = src.height;
  const o = document.createElement('canvas');
  o.width = w; o.height = h;
  const x = o.getContext('2d');
  const step = Math.max(4, Math.round(w / 260));
  // fios
  const pat = document.createElement('canvas');
  pat.width = pat.height = step * 2;
  const p = pat.getContext('2d');
  p.strokeStyle = 'rgba(0,0,0,0.28)'; p.lineWidth = Math.max(1, step * 0.35);
  for (let k = -1; k <= 2; k++) { p.beginPath(); p.moveTo(k * step * 2 - step, step * 2); p.lineTo(k * step * 2 + step, 0); p.stroke(); }
  p.strokeStyle = 'rgba(255,255,255,0.22)'; p.lineWidth = Math.max(1, step * 0.18);
  for (let k = -1; k <= 2; k++) { p.beginPath(); p.moveTo(k * step * 2 - step + step * 0.5, step * 2); p.lineTo(k * step * 2 + step + step * 0.5, 0); p.stroke(); }
  // sombra do relevo
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = step * 1.2; x.shadowOffsetX = step * 0.4; x.shadowOffsetY = step * 0.6;
  x.drawImage(src, 0, 0);
  x.restore();
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const tx = t.getContext('2d');
  tx.drawImage(src, 0, 0);
  tx.globalCompositeOperation = 'source-atop';
  tx.fillStyle = tx.createPattern(pat, 'repeat');
  tx.fillRect(0, 0, w, h);
  // brilho na borda de cima
  tx.globalCompositeOperation = 'source-atop';
  const gr = tx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  tx.fillStyle = gr; tx.fillRect(0, 0, w, h);
  x.drawImage(t, 0, 0);
  return o;
}

const png = async (canvas, dpi) => withDpi(await canvasToBlob(canvas, 'image/png'), dpi);

/**
 * opts: { name, art: Blob, bordadoArt?: Blob, bordadoCrop?: {x,y,w,h}, onProgress }
 * Retorna { files: [{ path, blob }], info }
 */
export async function buildPack({ name, art, bordadoArt = null, bordadoCrop = null, onProgress = () => {} }) {
  const info = await analyzeArt(art);
  const bInfo = bordadoArt ? await analyzeArt(bordadoArt) : info;
  const img = info.img, bImg = bInfo.img;
  const aspect = img.naturalHeight / img.naturalWidth;
  const bAspect = (bImg.naturalHeight * (bordadoCrop?.h || 1)) / (bImg.naturalWidth * (bordadoCrop?.w || 1));
  const files = [];
  const add = (path, blob) => files.push({ path, blob });
  const steps = [];

  for (const [mod, sz] of Object.entries(SIZES)) {
    steps.push(['DTF', async () => {
      const { w, h, dpi } = fitSize(sz.estampa, aspect);
      add(`0_DTF/DTF_${mod}_cores-originais_${sz.estampa}cm.png`, await png(dtfLayer(img, w, h, info), dpi));
    }]);
  }
  if (!info.colorida) {
    for (const [mod, sz] of Object.entries(SIZES)) for (const [inkName, ink] of Object.entries(INKS)) {
      steps.push([`Serigrafia ${mod} ${inkName}`, async () => {
        const { w, h, dpi } = fitSize(sz.estampa, aspect);
        const { c, x } = drawAt(img, w, h);
        add(`1_SERIGRAFIA/SERIGRAFIA_${mod}_tinta-${inkName}_${ink.camisa}.png`, await png(inkLayer(c, x, info, { mode: 'tinta', ink: ink.rgb }), dpi));
      }]);
    }
  }
  if (!bInfo.colorida) {
    for (const [mod, sz] of Object.entries(SIZES)) for (const [inkName, ink] of Object.entries(INKS)) {
      steps.push([`Bordado ${mod} ${inkName}`, async () => {
        const { w, h, dpi } = fitSize(sz.bordado, bAspect);
        const { c, x } = drawAt(bImg, w, h, bordadoCrop);
        const flat = inkLayer(c, x, bInfo, { mode: 'tinta', ink: ink.rgb });
        add(`2_BORDADO/BORDADO_${mod}_linha-${inkName}_${ink.camisa}_arte-plana.png`, await png(flat, dpi));
        add(`2_BORDADO/BORDADO_${mod}_linha-${inkName}_${ink.camisa}_efeito-bordado.png`, await png(embroider(flat), dpi));
      }]);
    }
  }
  if (!info.colorida) {
    const films = [['principal', `cor1_${info.inkDark ? 'preto' : 'branco'}-ou-${info.inkDark ? 'branco' : 'preto'}`], ...info.accents.map((a, k) => [k, `cor${k + 2}_${slugify(a.name)}`])];
    for (const [only, label] of films) {
      steps.push([`Fotolito ${label}`, async () => {
        const { w, h, dpi } = fitSize(SIZES.oversize.estampa, aspect);
        const { c, x } = drawAt(img, w, h);
        add(`3_FOTOLITO/FOTOLITO_oversize_${label}.png`, await png(inkLayer(c, x, info, { mode: 'filme', only }), dpi));
      }]);
    }
  }
  let i = 0;
  for (const [label, fn] of steps) { onProgress(`${++i}/${steps.length} · ${label}`); await fn(); await new Promise((r) => setTimeout(r)); }

  const readme = [
    `${name.toUpperCase()} — pacote de produção EKKLESIA`,
    '',
    'Todos os arquivos: PNG transparente, 300 DPI (DPI gravado), escala 1:1.',
    `Estampa: oversize ${SIZES.oversize.estampa} cm de largura · padrão ${SIZES.padrao.estampa} cm.`,
    `Bordado: oversize ${SIZES.oversize.bordado} cm · padrão ${SIZES.padrao.bordado} cm.`,
    '',
    '0_DTF: cores originais da arte (impressão DTF direto).',
    info.colorida ? 'Arte colorida: serigrafia e fotolito não gerados (use DTF).' : '1_SERIGRAFIA: tinta preta para camisa clara; tinta off-white para camisa escura. Destaques coloridos mantidos.',
    bInfo.colorida ? 'Bordado não gerado: arte colorida demais para linha.' : '2_BORDADO: arte plana (para o digitalizador) e efeito bordado (só para aprovar visual).',
    info.colorida ? '' : `3_FOTOLITO: um filme por tinta (${['principal', ...info.accents.map((a) => a.name)].join(', ')}).`,
  ].filter((l) => l !== '').join('\n');
  files.push({ path: 'LEIA-ME.txt', blob: new Blob([readme], { type: 'text/plain' }) });
  return { files, info };
}

// ZIP sem compressão (PNG já é comprimido): rápido e sem biblioteca.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export async function zip(files, root = '') {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = enc.encode((root ? `${root}/` : '') + f.path);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
    parts.push(head.buffer, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
