import { db, STATUS, currentVersions } from '../db.js';
import { $, $$ } from '../util.js';
import { designCard, pageHead, empty, ICONS } from '../ui.js';

export async function render(el, _p, query) {
  const all = await db.designs.orderBy('updatedAt').reverse().toArray();
  const vs = await currentVersions(all);
  let filter = query.status || 'todos';
  let term = '';

  const count = (id) => (id === 'todos' ? all.length : all.filter((d) => d.status === id).length);
  const filters = [{ id: 'todos', label: 'Todos' }, ...STATUS];

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Biblioteca',
      title: 'Meus designs',
      actions: `<a class="btn primary" href="#/criar">${ICONS.plus}<span>Novo design</span></a>`,
    })}
    <div class="toolbar">
      <div class="chips" role="tablist">${filters.map((f) => `<button class="chip" data-f="${f.id}">${f.label} <b>${count(f.id)}</b></button>`).join('')}</div>
      <input class="search" id="q" type="search" placeholder="Buscar por nome">
    </div>
    <div id="list"></div>`;

  function draw() {
    $$('[data-f]', el).forEach((b) => b.classList.toggle('active', b.dataset.f === filter));
    const t = term.toLowerCase();
    const list = all.filter((d) => (filter === 'todos' || d.status === filter) && (!t || d.name.toLowerCase().includes(t)));
    $('#list', el).innerHTML = list.length
      ? `<div class="grid">${list.map((d) => designCard(d, vs.get(d.id))).join('')}</div>`
      : all.length ? empty('Nada por aqui', 'Nenhum design com esse filtro.')
        : empty('Biblioteca vazia', 'Envie sua primeira arte para começar.', `<a class="btn primary" href="#/criar">${ICONS.upload}<span>Enviar arte</span></a>`);
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    history.replaceState(null, '', filter === 'todos' ? '#/designs' : `#/designs?status=${filter}`);
    draw();
  });
  $('#q', el).addEventListener('input', (e) => { term = e.target.value; draw(); });
  draw();
}
