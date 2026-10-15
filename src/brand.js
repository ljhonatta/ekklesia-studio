// Logo oficial da marca. Guardamos o arquivo original e uma "máscara"
// monocromática (branco + transparência, recortada), que pode ser tingida de
// qualquer cor: branca no app e na capa, preta nas páginas claras, dourada na etiqueta.
import { getSetting, setSetting } from './db.js';
import { canvasToBlob } from './util.js';

function loadRaw(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem da logo.'));
    img.src = URL.createObjectURL(blob); // sem revogar: a logo vive a sessão toda
  });
}

export async function processLogo(file) {
  const img = await loadRaw(file);
  const k = Math.min(1, 1800 / Math.max(img.naturalWidth || 1000, img.naturalHeight || 1000));
  const w = Math.round((img.naturalWidth || 1000) * k), h = Math.round((img.naturalHeight || 1000) * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  let transparent = false;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { transparent = true; break; }

  // Sem transparência: o fundo é a cor da borda. Logo clara em fundo escuro
  // (ou o contrário) vira alfa pela luminância.
  let bgLum = 0, n = 0;
  if (!transparent) {
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { bgLum += lum((y * w + x) * 4); n++; }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { bgLum += lum((y * w + x) * 4); n++; }
    bgLum /= n;
  }
  const darkBg = bgLum < 128;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let a;
      if (transparent) a = d[i + 3];
      else {
        const dist = darkBg ? lum(i) - bgLum : bgLum - lum(i);
        a = Math.max(0, Math.min(255, ((dist - 18) / (200 - 18)) * 255));
      }
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a;
      if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('Não encontrei a logo na imagem. Use um PNG transparente ou a logo em contraste com o fundo.');
  ctx.putImageData(id, 0, 0);
  const pad = 2;
  const cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(c, x0 - pad, y0 - pad, cw, ch, 0, 0, cw, ch);
  return { original: file, fileName: file.name, mask: await canvasToBlob(out, 'image/png'), w: cw, h: ch };
}

let cache;
export async function getLogo() {
  if (cache !== undefined) return cache;
  const l = await getSetting('logo', null);
  cache = l ? { ...l, img: await loadRaw(l.mask) } : null;
  return cache;
}

export async function saveLogo(logo) {
  await setSetting('logo', logo ? { original: logo.original, fileName: logo.fileName, mask: logo.mask, w: logo.w, h: logo.h } : null);
  cache = undefined;
  await getLogo();
  window.dispatchEvent(new Event('brand-logo'));
}

// Logo tingida numa cor, como canvas (máx. `maxW` px de largura).
export function tinted(logo, color, maxW = 1400) {
  const k = Math.min(1, maxW / logo.w);
  const c = document.createElement('canvas');
  c.width = Math.round(logo.w * k); c.height = Math.round(logo.h * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(logo.img, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export async function tintedDataURL(color, maxW) {
  const l = await getLogo();
  if (!l) return null;
  const c = tinted(l, color, maxW);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}
