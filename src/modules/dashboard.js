import { db, currentVersions } from '../db.js';
import { designCard, mockupCard, pageHead, empty, ICONS } from '../ui.js';
import { esc } from '../util.js';
import { getSetting } from '../db.js';

const FLOW = [
  ['Ideia', true], ['Arte', true], ['Mockup', true], ['Produção', true], ['Produto', true], ['Catálogo', true], ['Venda', false],
];

export async function render(el) {
  const [nDesigns, nVersions, nMockups, nProducts, published] = await Promise.all([
    db.designs.count(), db.versions.count(), db.mockups.count(), db.products.count(),
    db.designs.where('status').equals('publicado').count(),
  ]);
  const nActive = await db.products.where('status').equals('ativo').count();
  const lastCat = (await db.catalogs.reverse().sortBy('updatedAt'))[0];
  const recent = await db.designs.orderBy('updatedAt').reverse().limit(6).toArray();
  const vs = await currentVersions(recent);
  const recentMockups = await db.mockups.orderBy('updatedAt').reverse().limit(4).toArray();
  const names = new Map((await db.designs.bulkGet(recentMockups.map((m) => m.designId).filter(Boolean))).filter(Boolean).map((d) => [d.id, d.name]));

  const stat = (n, label, note = '') => `<div class="stat"><div class="stat-n">${n}</div><div class="stat-l">${label}</div>${note ? `<div class="stat-note">${note}</div>` : ''}</div>`;

  const hasCloud = !!(await getSetting('lojaToken', ''));
  el.innerHTML = `
    ${hasCloud ? '' : `<div class="cloud-banner"><span><b>Nuvem desligada neste aparelho.</b> Conecte para ver aqui as artes, mockups e produtos feitos nos outros aparelhos.</span><a class="btn primary sm" href="#/config">Conectar nuvem</a></div>`}
    ${pageHead({
      eyebrow: 'EKKLESIA STUDIO',
      title: 'Da ideia à <em>peça</em>.',
      lede: 'Arte, mockup e produção, cada um no seu lugar.',
      actions: `<a class="btn primary lg" href="#/criar">${ICONS.plus}<span>Criar novo design</span></a>`,
    })}
    <ol class="flow">${FLOW.map(([s, on]) => `<li class="${on ? 'on' : ''}">${s}</li>`).join('')}</ol>
    <section class="stats">
      ${stat(nDesigns, 'Designs', `${nVersions} versões`)}
      ${stat(nMockups, 'Mockups gerados')}
      ${stat(nProducts, 'Produtos cadastrados', `${nActive} ativos`)}
      ${stat(published, 'Publicados')}
    </section>
    <section class="section">
      <div class="section-head"><h2>Últimos designs</h2><a class="link" href="#/designs">Ver todos</a></div>
      ${recent.length ? `<div class="grid">${recent.map((d) => designCard(d, vs.get(d.id))).join('')}</div>`
        : empty('Nenhum design ainda', 'Comece enviando a primeira arte da coleção.', `<a class="btn primary" href="#/criar">${ICONS.upload}<span>Enviar arte</span></a>`)}
    </section>
    ${recentMockups.length ? `
    <section class="section">
      <div class="section-head"><h2>Mockups recentes</h2><a class="link" href="#/mockups">Ver todos</a></div>
      <div class="grid">${recentMockups.map((m) => mockupCard(m, names.get(m.designId))).join('')}</div>
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>Catálogo atual</h2></div>
      ${lastCat ? `<a class="cat-row" href="#/catalogo/${lastCat.id}"><span class="cat-cover"><b>${esc(lastCat.title || 'Sem título')}</b></span><span><b>${esc(lastCat.title || 'Sem título')}</b><small>${lastCat.productIds?.length || 0} peças · abrir e exportar PDF</small></span></a>`
        : `<div class="note-card">Nenhum catálogo ainda. <a class="link" href="#/catalogo">Criar catálogo</a></div>`}
    </section>`;
}
