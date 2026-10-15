export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Object URLs da tela atual; revogados a cada troca de rota.
const urls = new Set();
export function objURL(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}
export function revokeURLs() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = objURL(blob);
  });
}

export const canvasToBlob = (canvas, type = 'image/png', quality) =>
  new Promise((res) => canvas.toBlob(res, type, quality));

export const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
export const dataURLToBlob = (url) => fetch(url).then((r) => r.blob());

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'arquivo';

export const fmtDate = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (ts) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Mistura uma cor hex com preto (amt < 0) ou branco (amt > 0).
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// ---------- Arte enviada ----------
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const ACCEPT_ATTR = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';

function guessType(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || '';
}

// SVG sem width/height não tem tamanho intrínseco no <img>. Gera uma cópia
// de exibição com dimensões; o arquivo original é guardado sem alteração.
async function svgPreview(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG inválido.');
  doc.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
  if (/%/.test(svg.getAttribute('width') || '') || !w || !h) {
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; } else { w = h = 1000; }
  }
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const k = Math.max(1, 2400 / Math.max(w, h)); // tamanho intrínseco maior = composição nítida
  svg.setAttribute('width', w * k);
  svg.setAttribute('height', h * k);
  return new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
}

function detectAlpha(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  } catch { return null; }
}

async function makeThumb(img, max = 480) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/png');
}

export async function prepareArtFile(file) {
  const mime = file.type || guessType(file.name);
  if (!ACCEPTED_TYPES.includes(mime)) throw new Error('Formato não suportado. Use PNG, JPG, WEBP ou SVG.');
  const preview = mime === 'image/svg+xml' ? await svgPreview(file) : null;
  const img = await loadImage(preview || file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('A imagem não tem dimensões válidas.');
  return {
    original: file, preview, thumb: await makeThumb(img), mime, fileName: file.name, size: file.size,
    width: img.naturalWidth, height: img.naturalHeight,
    hasAlpha: mime === 'image/jpeg' ? false : detectAlpha(img),
  };
}

export const nameFromFile = (name) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().toUpperCase();

// ---------- UI: toast e modal ----------
export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

export function modal({ title, body = '', actions = [{ label: 'OK', value: true, kind: 'primary' }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fechar">✕</button></header>
        <div class="modal-body">${body}</div>
        ${actions.length ? `<footer class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer>` : ''}
      </div>`;
    const close = (v) => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close(null);
      const b = e.target.closest('[data-i]');
      if (b) close(actions[+b.dataset.i].value);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    onOpen?.(wrap.querySelector('.modal'), close);
    (wrap.querySelector('.modal-foot .primary') || wrap.querySelector('[data-close]')).focus();
  });
}

export const confirmDialog = (title, text, okLabel = 'Confirmar', danger = false) => modal({
  title,
  body: `<p>${text}</p>`,
  actions: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }],
});
