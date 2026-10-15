import { $, revokeURLs } from './util.js';
import { NAV, ICONS } from './ui.js';
import * as dashboard from './modules/dashboard.js';
import * as create from './modules/create.js';
import * as designs from './modules/designs.js';
import * as designDetail from './modules/design-detail.js';
import * as mockups from './modules/mockups.js';
import * as mockupEditor from './modules/mockup-editor.js';
import * as settings from './modules/settings.js';
import { produtos, producao, catalogo } from './modules/upcoming.js';

const ROUTES = [
  [/^$/, dashboard, 'dashboard'],
  [/^criar$/, create, 'criar'],
  [/^designs$/, designs, 'designs'],
  [/^design\/(\d+)$/, designDetail, 'designs'],
  [/^mockups$/, mockups, 'mockups'],
  [/^mockup\/(new|\d+)$/, mockupEditor, 'mockups'],
  [/^produtos$/, produtos, 'produtos'],
  [/^producao$/, producao, 'producao'],
  [/^catalogo$/, catalogo, 'catalogo'],
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

window.addEventListener('hashchange', route);
route();

// Pede ao navegador para não apagar os dados locais sob pressão de espaço.
navigator.storage?.persist?.().catch(() => {});
