import { db } from '../db.js';
import { $, $$, esc, objURL, toast, modal, confirmDialog } from '../util.js';
import { mockupCard, pageHead, empty, ICONS } from '../ui.js';
import { TIPOS_FOTO, VISTAS_FOTO, MODELOS, vistaLabel, photoLabel, importImages, importPack, detectAll } from '../photos.js';

export async function render(el, _p, query) {
  let tab = query.tab === 'pecas' ? 'pecas' : 'salvos';
  let photos = await db.photos.orderBy('id').toArray();
  const list = await db.mockups.orderBy('updatedAt').reverse().toArray();
  const names = new Map((await db.designs.bulkGet([...new Set(list.map((m) => m.designId).filter(Boolean))])).filter(Boolean).map((d) => [d.id, d.name]));
  let fTipo = '', fVista = '', fModelo = '';

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Mockup Studio',
      title: 'Mockups',
      lede: 'Imagens de apresentação para Instagram, site e catálogo, feitas sobre as peças reais do fornecedor ou sobre silhuetas. Não são arquivo de produção.',
      actions: `<a class="btn primary" href="#/mockup/new">${ICONS.plus}<span>Novo mockup</span></a>`,
    })}
    <div class="tabs" role="tablist">
      <button data-tab="salvos">Mockups salvos <b>${list.length}</b></button>
      <button data-tab="pecas">Peças reais <b id="nPhotos">${photos.length}</b></button>
    </div>
    <div id="body"></div>`;

  function drawTabs() {
    $$('[data-tab]', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    history.replaceState(null, '', tab === 'pecas' ? '#/mockups?tab=pecas' : '#/mockups');
    $('#nPhotos', el).textContent = photos.length;
    if (tab === 'salvos') {
      $('#body', el).innerHTML = list.length ? `<div class="grid">${list.map((m) => mockupCard(m, names.get(m.designId))).join('')}</div>`
        : empty('Nenhum mockup ainda', 'Escolha uma peça, aplique uma arte e salve.', `<a class="btn primary" href="#/mockup/new">${ICONS.plus}<span>Novo mockup</span></a>`);
      return;
    }
    const shown = photos.filter((p) => (!fTipo || p.tipo === fTipo) && (!fVista || p.vista === fVista) && (!fModelo || p.modelo === fModelo));
    const count = (k, v) => photos.filter((p) => p[k] === v).length;
    const pending = photos.filter((p) => !p.pose).length;
    $('#body', el).innerHTML = `
      <div class="toolbar">
        <div class="filters">
          <select id="fTipo"><option value="">Todas as peças (${photos.length})</option>${TIPOS_FOTO.filter((t) => count('tipo', t)).map((t) => `<option value="${t}" ${t === fTipo ? 'selected' : ''}>${t} (${count('tipo', t)})</option>`).join('')}</select>
          <select id="fVista"><option value="">Todas as vistas</option>${VISTAS_FOTO.map((v) => `<option value="${v.id}" ${v.id === fVista ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          <select id="fModelo"><option value="">Masculino e feminino</option>${MODELOS.map((m) => `<option value="${m.id}" ${m.id === fModelo ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
        </div>
        <div class="actions-row tight">
          ${photos.length ? `<button class="btn" id="aiAll" title="Detecta ombros, quadril e braços de cada foto para posicionar as áreas de estampa">Detectar áreas com IA${pending ? ` (${pending})` : ''}</button>` : ''}
          <label class="btn">${ICONS.upload}<span>Importar fotos</span><input type="file" id="impImgs" accept="image/*" multiple hidden></label>
          <label class="btn">${ICONS.upload}<span>Importar pacote</span><input type="file" id="impPack" accept=".json,application/json" hidden></label>
        </div>
      </div>
      <p class="hint" id="progress"></p>
      ${photos.length ? shown.length ? `<div class="grid photos">${shown.map((p) => `
        <button class="card photo-card" data-edit="${p.id}">
          <div class="thumb"><img src="${objURL(p.thumb)}" alt="" loading="lazy"></div>
          <div class="card-body"><div class="card-title">${esc(photoLabel(p))}</div>
            <div class="card-meta"><span>${p.pose?.ok ? '<i class="dot ok" title="Áreas detectadas por IA"></i> ' : ''}${vistaLabel(p.vista)}${p.modelo ? ` · ${p.modelo === 'feminino' ? 'Fem.' : 'Masc.'}` : ''}</span>${p.corHex ? `<span class="swatch-dot" style="background:${esc(p.corHex)}"></span>` : ''}</div></div>
        </button>`).join('')}</div>` : empty('Nada por aqui', 'Nenhuma foto com esses filtros.')
        : empty('Nenhuma peça real ainda', 'Importe as fotos das peças do fornecedor. Elas ficam salvas só neste navegador e viram base de mockup.', '')}`;
  }

  async function reload() { photos = await db.photos.orderBy('id').toArray(); drawTabs(); }

  // IA: detecta o corpo em cada foto ainda não analisada.
  async function runAI(force = false) {
    const btn = $('#aiAll', el);
    if (btn) btn.disabled = true;
    const prog = (i, n) => { const p = $('#progress', el); if (p) p.textContent = `IA analisando foto ${i} de ${n}… (a primeira vez baixa o modelo, ~9 MB)`; };
    try {
      const r = await detectAll(prog, { force });
      toast(r.total ? `IA analisou ${r.total} foto(s): corpo encontrado em ${r.ok}${r.fail ? `, ${r.fail} sem corpo visível (closes)` : ''}.` : 'Todas as fotos já foram analisadas.');
    } catch (err) { toast(err.message || 'Falha na IA.', 'err'); }
    reload();
  }

  async function editPhoto(id) {
    const p = photos.find((x) => x.id === id);
    let form = null;
    const opt = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`;
    const res = await modal({
      title: 'Peça real',
      wide: true,
      body: `
        <div class="photo-edit">
          <img src="${objURL(p.image)}" alt="">
          <form class="form-stack" id="pf">
            <label class="field"><span>Nome</span><input name="name" value="${esc(p.name)}"></label>
            <label class="field"><span>Tipo de peça</span><select name="tipo">${TIPOS_FOTO.map((t) => opt(t, t, p.tipo)).join('')}</select></label>
            <label class="field"><span>Cor</span><input name="cor" value="${esc(p.cor)}" placeholder="Ex.: preta"></label>
            <label class="field"><span>Vista</span><select name="vista">${VISTAS_FOTO.map((v) => opt(v.id, v.label, p.vista)).join('')}</select></label>
            <label class="field"><span>Modelo</span><select name="modelo">${opt('', '—', p.modelo)}${MODELOS.map((m) => opt(m.id, m.label, p.modelo)).join('')}</select></label>
            <p class="hint">${p.w} × ${p.h} px${p.sourceFile ? ` · ${esc(p.sourceFile)}` : ''}</p>
          </form>
        </div>`,
      actions: [{ label: 'Excluir', value: 'del', kind: 'danger ghost' }, { label: 'Usar no mockup', value: 'use' }, { label: 'Salvar', value: 'save', kind: 'primary' }],
      onOpen: (m) => { form = m.querySelector('#pf'); },
    });
    const vals = form ? Object.fromEntries(new FormData(form)) : null;
    if (res === 'save' || res === 'use') {
      if (vals) await db.photos.update(id, vals);
      if (res === 'use') { location.hash = `#/mockup/new?photo=${id}`; return; }
      toast('Peça atualizada.');
      reload();
    } else if (res === 'del') {
      if (!await confirmDialog('Excluir foto', 'Excluir esta peça real? Mockups já salvos com ela continuam como imagem.', 'Excluir', true)) return;
      await db.photos.delete(id);
      reload();
    }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; drawTabs(); return; }
    const c = e.target.closest('[data-edit]');
    if (c) editPhoto(+c.dataset.edit);
    if (e.target.closest('#aiAll')) runAI(!photos.some((p) => !p.pose));
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'fTipo') { fTipo = t.value; drawTabs(); }
    if (t.id === 'fVista') { fVista = t.value; drawTabs(); }
    if (t.id === 'fModelo') { fModelo = t.value; drawTabs(); }
    if (t.id === 'impImgs' || t.id === 'impPack') {
      const files = [...t.files];
      t.value = '';
      if (!files.length) return;
      const prog = (i, n) => { const p = $('#progress', el); if (p) p.textContent = `Importando ${i} de ${n}…`; };
      try {
        const r = t.id === 'impPack' ? await importPack(files[0], prog) : await importImages(files, prog);
        toast(`${r.added} foto(s) importada(s)${r.skipped ? `, ${r.skipped} ignorada(s) (repetidas ou inválidas)` : ''}.`);
      } catch (err) { toast(err.message || 'Falha ao importar.', 'err'); }
      await reload();
      if (photos.some((p) => !p.pose)) runAI();
    }
  });
  drawTabs();
}
