import { $, revokeURLs } from './util.js';
import { NAV, ICONS } from './ui.js';
import { isAuthed, renderLogin, logout } from './auth.js';
import { getLogo, tinted } from './brand.js';
import { setLabelLogo } from './compose.js';
import * as dashboard from './modules/dashboard.js';
import * as create from './modules/create.js';
import * as designs from './modules/designs.js';
import * as designDetail from './modules/design-detail.js';
import * as mockups from './modules/mockups.js';
import * as mockupEditor from './modules/mockup-editor.js';
import * as settings from './modules/settings.js';
import * as production from './modules/production.js';
import * as products from './modules/products.js';
import * as catalog from './modules/catalog.js';
import * as store from './modules/store.js';

const r = (fn) => ({ render: fn });

const ROUTES = [
  [/^$/, dashboard, 'dashboard'],
  [/^criar$/, create, 'criar'],
  [/^designs$/, designs, 'designs'],
  [/^design\/(\d+)$/, designDetail, 'designs'],
  [/^mockups$/, mockups, 'mockups'],
  [/^mockup\/(new|\d+)$/, mockupEditor, 'mockups'],
  [/^produtos$/, r(products.list), 'produtos'],
  [/^produto\/(new)$/, r(products.edit), 'produtos'],
  [/^produto\/(\d+)\/editar$/, r(products.edit), 'produtos'],
  [/^produto\/(\d+)$/, r(products.page), 'produtos'],
  [/^producao$/, r(production.list), 'producao'],
  [/^producao\/new$/, r(production.create), 'producao'],
  [/^producao\/(\d+)$/, r(production.detail), 'producao'],
  [/^catalogo$/, r(catalog.list), 'catalogo'],
  [/^catalogo\/(\d+)$/, r(catalog.editor), 'catalogo'],
  [/^loja$/, store, 'loja'],
  [/^config$/, settings, 'config'],
];

$('#nav').innerHTML = NAV.map((n) => `
  <a href="${n.href}" data-nav="${n.id}">${ICONS[n.id]}<span>${n.label}</span>${n.soon ? `<em>${n.soon}</em>` : ''}</a>`).join('');

let cleanup = null;
let seq = 0;

async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const p = path.replace(/\/$/, '');
  const match = ROUTES.map(([re, mod, nav]) => [p.match(re), mod, nav]).find(([m]) => m);
  if (!match) { location.replace('#/'); return; }
  const [m, mod, nav] = match;

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  revokeURLs();
  const my = ++seq;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  const view = $('#view');
  view.className = `view view-${nav}`;
  // Contêiner novo a cada rota: listeners da tela anterior morrem junto.
  const page = document.createElement('div');
  page.className = 'page';
  view.replaceChildren(page);
  try {
    const c = await mod.render(page, m.slice(1), query);
    if (my === seq) cleanup = c || null; else c?.();
  } catch (e) {
    console.error(e);
    if (my === seq) view.innerHTML = `<div class="empty"><h3>Algo deu errado</h3><p>${String(e.message || e)}</p></div>`;
  }
  if (my === seq) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

// Logo oficial no menu e na etiqueta da gola dos mockups.
async function applyLogo() {
  const l = await getLogo().catch(() => null);
  const mark = $('.brand-mark');
  mark.replaceChildren();
  if (l) {
    const img = new Image();
    img.src = tinted(l, '#f1eee8', 600).toDataURL('image/png');
    img.alt = 'EKKLESIA';
    mark.append(img);
    mark.classList.add('has-logo');
    setLabelLogo(tinted(l, '#c4a96b', 240));
  } else {
    mark.textContent = 'EKKLESIA';
    mark.classList.remove('has-logo');
    setLabelLogo(null);
  }
}
window.addEventListener('brand-logo', applyLogo);

// Sem login, nada do Estúdio é montado.
(async () => {
  if (!isAuthed()) await renderLogin();
  document.body.classList.remove('locked');
  $('#logout')?.addEventListener('click', logout);
  window.addEventListener('hashchange', route);
  applyLogo().finally(route);
})();

// Pede ao navegador para não apagar os dados locais sob pressão de espaço.
navigator.storage?.persist?.().catch(() => {});
