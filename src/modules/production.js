import { db, artBlob } from '../db.js';
import { $, esc, objURL, loadImage, toast, download, confirmDialog } from '../util.js';
import { TECNICAS, AREAS, tecLabel } from '../data.js';
import { checks, dominantColors, heightFor, effectiveDpi, isVector, renderProductionPNG, productionPDF, fileBase, targetPixels } from '../production.js';
import { pageHead, empty, ICONS, pickDesign, pill } from '../ui.js';

const AI_NOTE = 'Uma imagem gerada por IA ou um mockup <b>não</b> são, automaticamente, arquivos técnicos. Este arquivo é preparado a partir da arte original, no tamanho real, e fica separado do mockup.';

// ---------- lista ----------
export async function list(el) {
  const files = await db.productionFiles.reverse().sortBy('updatedAt');
  const vs = new Map((await db.versions.bulkGet(files.map((f) => f.versionId))).filter(Boolean).map((v) => [v.id, v]));
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Arquivo de produção',
      title: 'Arquivos de Produção',
      lede: 'O que vai para a gráfica: arte no tamanho real, em 300 DPI, com técnica, área e cores. Nunca o mockup.',
      actions: `<button class="btn primary" id="new">${ICONS.plus}<span>Novo arquivo</span></button>`,
    })}
    ${files.length ? `<div class="grid">${files.map((f) => {
      const v = vs.get(f.versionId);
      return `<a class="card design-card" href="#/producao/${f.id}">
        <div class="thumb checker">${v ? `<img src="${objURL(v.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="card-body"><div class="card-title">${esc(f.name)}</div>
          <div class="card-meta"><span>${tecLabel(f.tecnica)} · ${f.widthCm}×${f.heightCm} cm</span>${f.status === 'pronto' ? pill('aprovado', 'Pronto') : pill('criacao', 'Em revisão')}</div></div></a>`;
    }).join('')}</div>` : empty('Nenhum arquivo de produção', 'Crie a partir de uma arte aprovada.', `<button class="btn primary" id="new2">${ICONS.plus}<span>Novo arquivo</span></button>`)}`;
  el.addEventListener('click', async (e) => {
    if (!e.target.closest('#new, #new2')) return;
    const id = await pickDesign('Arte para produção');
    if (id) location.hash = `#/producao/new?design=${id}`;
  });
}

// ---------- criar (a partir de um design) ----------
export async function create(el, _p, query) {
  const design = await db.designs.get(+query.design);
  if (!design) { location.replace('#/producao'); return; }
  const v = await db.versions.get(+query.version || design.currentVersionId);
  const img = await loadImage(artBlob(v));
  const widthCm = Math.min(28, isVector(v) ? 28 : Math.max(5, +((v.width / 300) * 2.54).toFixed(1)));
  const now = Date.now();
  const id = await db.productionFiles.add({
    designId: design.id, versionId: v.id, name: `${design.name} V${v.n}`,
    tecnica: 'dtf', area: 'Estampa grande (frente)', widthCm, heightCm: heightFor(v, widthCm),
    colors: dominantColors(img), notes: '', status: 'revisao', createdAt: now, updatedAt: now,
  });
  toast('Arquivo de produção criado. Revise as informações.');
  location.replace(`#/producao/${id}`);
}

// ---------- detalhe ----------
export async function detail(el, [idStr]) {
  const id = +idStr;
  let pf = await db.productionFiles.get(id);
  if (!pf) { el.innerHTML = empty('Arquivo não encontrado', '', '<a class="btn" href="#/producao">Voltar</a>'); return; }
  const v = await db.versions.get(pf.versionId);
  const design = await db.designs.get(pf.designId);
  if (!v) { el.innerHTML = empty('Arte original não encontrada', 'A versão usada por este arquivo foi excluída.', '<a class="btn" href="#/producao">Voltar</a>'); return; }
  const products = await db.products.filter((p) => p.productionFileId === id).toArray();

  el.innerHTML = `
    <a class="back" href="#/producao">${ICONS.back}<span>Arquivos de Produção</span></a>
    <header class="detail-head">
      <input class="title-input" id="name" value="${esc(pf.name)}" aria-label="Nome do arquivo">
      <div class="detail-head-actions">
        <label class="toggle"><input type="checkbox" id="ready" ${pf.status === 'pronto' ? 'checked' : ''}><span>Revisado e pronto para a gráfica</span></label>
      </div>
    </header>
    <p class="banner">${AI_NOTE}</p>
    <div class="detail-grid">
      <section class="stage-card">
        <div class="art-stage checker"><img src="${objURL(artBlob(v))}" alt=""></div>
        <div class="meta-row">
          <span>Arte: <a class="link" href="#/design/${pf.designId}">${esc(design?.name || '—')}</a> V${v.n}</span>
          <span>${v.width} × ${v.height} px</span><span>${isVector(v) ? 'SVG (vetor)' : v.mime.split('/')[1].toUpperCase()}</span>
        </div>
      </section>
      <aside class="side">
        <div class="panel form-stack" id="form">
          <label class="field"><span>Técnica</span><select data-f="tecnica">${TECNICAS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
          <p class="hint" id="tecDesc"></p>
          <label class="field"><span>Área de aplicação</span><select data-f="area">${AREAS.map((a) => `<option>${a}</option>`).join('')}</select></label>
          <div class="form-grid two">
            <label class="field"><span>Largura (cm)</span><input data-f="widthCm" type="number" min="1" max="120" step="0.1"></label>
            <label class="field"><span>Altura (cm)</span><input id="h" type="number" disabled></label>
          </div>
          <div class="field"><span>Cores</span><div class="color-list" id="colors"></div></div>
          <label class="field"><span>Observações para a gráfica</span><textarea data-f="notes" rows="3" placeholder="Ex.: Pantone, posição a 8 cm da gola..."></textarea></label>
        </div>
        <div class="panel">
          <h3>Checklist</h3>
          <ul class="checks" id="checks"></ul>
        </div>
        <div class="panel">
          <h3>Exportar</h3>
          <div class="export-list">
            <button class="btn block" data-x="png">${ICONS.download}<span>PNG transparente · 300 DPI</span></button>
            <button class="btn block" data-x="pdf">${ICONS.download}<span>PDF de produção (1:1)</span></button>
            <button class="btn ghost block" data-x="orig">${ICONS.download}<span>Arte original (${isVector(v) ? 'SVG' : v.mime.split('/')[1].toUpperCase()})</span></button>
          </div>
          <p class="hint" id="pxInfo"></p>
        </div>
        ${products.length ? `<div class="panel"><h3>Usado em</h3><ul class="plain">${products.map((p) => `<li><a class="link" href="#/produto/${p.id}">${esc(p.nome)}</a></li>`).join('')}</ul></div>` : ''}
      </aside>
    </div>
    <section class="danger-zone"><button class="btn danger ghost sm" id="del">Excluir arquivo de produção</button></section>`;

  const form = $('#form', el);
  const save = async (patch) => {
    pf = { ...pf, ...patch, updatedAt: Date.now() };
    await db.productionFiles.put(pf);
    draw();
  };
  function draw() {
    for (const i of form.querySelectorAll('[data-f]')) if (document.activeElement !== i) i.value = pf[i.dataset.f] ?? '';
    $('#h', el).value = pf.heightCm;
    $('#tecDesc', el).textContent = TECNICAS.find((t) => t.id === pf.tecnica)?.desc || '';
    $('#colors', el).innerHTML = `${(pf.colors || []).map((c, i) => `<span class="color-chip"><i style="background:${esc(c)}"></i>${esc(c.toUpperCase())}<button data-rm="${i}" aria-label="Remover cor">×</button></span>`).join('')}
      <label class="color-add" title="Adicionar cor">+<input type="color" id="addColor"></label>`;
    $('#checks', el).innerHTML = checks(v, pf).map((c) => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'warn' : 'info'}">${c.text}</li>`).join('');
    const t = targetPixels(pf);
    $('#pxInfo', el).textContent = `O PNG terá ${t.w} × ${t.h} px a ${t.dpi} DPI${t.dpi < 300 ? ' (reduzido pelo limite de memória do navegador)' : ''}.${!isVector(v) && effectiveDpi(v, pf.widthCm) < 300 ? ' A arte original tem menos resolução: ela será ampliada, não ganha detalhe.' : ''}`;
  }

  form.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    if (f === 'widthCm') {
      const w = Math.min(120, Math.max(1, +e.target.value || pf.widthCm));
      save({ widthCm: w, heightCm: heightFor(v, w) });
    } else save({ [f]: e.target.value });
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'addColor') save({ colors: [...(pf.colors || []), e.target.value] });
    if (e.target.id === 'ready') { save({ status: e.target.checked ? 'pronto' : 'revisao' }); toast(e.target.checked ? 'Marcado como pronto para a gráfica.' : 'Voltou para revisão.'); }
  });
  $('#name', el).addEventListener('change', (e) => { const n = e.target.value.trim(); if (n) save({ name: n }); else e.target.value = pf.name; });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rm) { const colors = [...pf.colors]; colors.splice(+b.dataset.rm, 1); save({ colors }); }
    else if (b.dataset.x) {
      b.disabled = true;
      try {
        if (b.dataset.x === 'png') { const { blob } = await renderProductionPNG(v, pf); download(blob, `${fileBase(pf)}-300dpi.png`); }
        if (b.dataset.x === 'pdf') download(await productionPDF(v, pf), `${fileBase(pf)}-producao.pdf`);
        if (b.dataset.x === 'orig') download(v.original, v.fileName);
      } catch (err) { console.error(err); toast(err.message || 'Falha ao exportar.', 'err'); }
      b.disabled = false;
    } else if (b.id === 'del') {
      if (!await confirmDialog('Excluir arquivo de produção', `Excluir <b>${esc(pf.name)}</b>? A arte original não é afetada.`, 'Excluir', true)) return;
      await db.productionFiles.delete(id);
      await db.products.where('id').anyOf(products.map((p) => p.id)).modify({ productionFileId: null });
      toast('Arquivo excluído.');
      location.hash = '#/producao';
    }
  });
  draw();
}

