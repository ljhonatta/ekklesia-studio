import { esc, objURL, fmtDate } from './util.js';
import { statusLabel } from './db.js';
import { garmentById } from './garments.js';

const I = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  dashboard: I('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  criar: I('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  designs: I('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  produtos: I('<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>'),
  mockups: I('<path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 01-8 0z"/>'),
  producao: I('<path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  catalogo: I('<path d="M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z"/>'),
  config: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1.3z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: I('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  back: I('<path d="M15 18l-6-6 6-6"/>'),
};

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/' },
  { id: 'criar', label: 'Criar Arte', href: '#/criar' },
  { id: 'designs', label: 'Meus Designs', href: '#/designs' },
  { id: 'produtos', label: 'Produtos', href: '#/produtos', soon: 'F2' },
  { id: 'mockups', label: 'Mockups', href: '#/mockups' },
  { id: 'producao', label: 'Arquivos de Produção', href: '#/producao', soon: 'F2' },
  { id: 'catalogo', label: 'Catálogo', href: '#/catalogo', soon: 'F2' },
  { id: 'config', label: 'Configurações', href: '#/config' },
];

export const statusPill = (id) => `<span class="pill pill-${esc(id)}">${esc(statusLabel(id))}</span>`;

export function designCard(d, v) {
  return `
    <a class="card design-card" href="#/design/${d.id}">
      <div class="thumb checker">${v?.thumb ? `<img src="${objURL(v.thumb)}" alt="" loading="lazy">` : ''}</div>
      <div class="card-body">
        <div class="card-title">${esc(d.name)}</div>
        <div class="card-meta"><span>V${d.versionCount} · ${fmtDate(d.updatedAt)}</span>${statusPill(d.status)}</div>
      </div>
    </a>`;
}

export function mockupCard(m, designName) {
  const g = garmentById(m.garment);
  return `
    <a class="card mockup-card" href="#/mockup/${m.id}">
      <div class="thumb">${m.thumb ? `<img src="${objURL(m.thumb)}" alt="" loading="lazy">` : ''}</div>
      <div class="card-body">
        <div class="card-title">${esc(m.name || designName || 'Mockup')}</div>
        <div class="card-meta"><span>${esc(g.label)} · ${m.view === 'costas' ? 'Costas' : 'Frente'}</span><span class="swatch-dot" style="background:${esc(m.color)}"></span></div>
      </div>
    </a>`;
}

export const pageHead = ({ eyebrow, title, lede = '', actions = '' }) => `
  <header class="page-head">
    <div>
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${title}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ''}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;

export const empty = (title, text, action = '') => `
  <div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;
