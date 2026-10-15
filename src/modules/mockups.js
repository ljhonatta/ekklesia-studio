import { db } from '../db.js';
import { mockupCard, pageHead, empty, ICONS } from '../ui.js';

export async function render(el) {
  const list = await db.mockups.orderBy('updatedAt').reverse().toArray();
  const names = new Map((await db.designs.bulkGet([...new Set(list.map((m) => m.designId).filter(Boolean))])).filter(Boolean).map((d) => [d.id, d.name]));
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Mockup Studio',
      title: 'Mockups',
      lede: 'Imagens de apresentação para Instagram, site e catálogo. Não são arquivo de produção.',
      actions: `<a class="btn primary" href="#/mockup/new">${ICONS.plus}<span>Novo mockup</span></a>`,
    })}
    ${list.length ? `<div class="grid">${list.map((m) => mockupCard(m, names.get(m.designId))).join('')}</div>`
      : empty('Nenhum mockup ainda', 'Escolha uma peça, aplique uma arte e salve.', `<a class="btn primary" href="#/mockup/new">${ICONS.plus}<span>Novo mockup</span></a>`)}`;
}
