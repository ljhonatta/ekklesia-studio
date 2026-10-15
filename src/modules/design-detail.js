import { db, STATUS, artBlob, addVersion, setCurrentVersion, deleteDesign } from '../db.js';
import { $, esc, objURL, fmtBytes, fmtDateTime, prepareArtFile, toast, confirmDialog, download, slugify, ACCEPT_ATTR } from '../util.js';
import { mockupCard, ICONS, empty } from '../ui.js';

const ORIGIN = { upload: 'Upload', 'ia-svg': 'IA · SVG', 'ia-imagem': 'IA · imagem', edit: 'Edição' };
const PRINT_CM = 28; // largura típica de uma estampa grande

export async function render(el, [idStr]) {
  const id = +idStr;
  let design = await db.designs.get(id);
  if (!design) { el.innerHTML = empty('Design não encontrado', 'Ele pode ter sido excluído.', '<a class="btn" href="#/designs">Voltar à biblioteca</a>'); return; }
  let versions = await db.versions.where('designId').equals(id).sortBy('n');
  const mockups = await db.mockups.where('designId').equals(id).reverse().sortBy('updatedAt');
  let viewing = design.currentVersionId;
  let bg = 'checker';

  el.innerHTML = `
    <a class="back" href="#/designs">${ICONS.back}<span>Meus designs</span></a>
    <header class="detail-head">
      <input class="title-input" id="name" value="${esc(design.name)}" aria-label="Nome do design">
      <div class="detail-head-actions">
        <select id="status" aria-label="Status">${STATUS.map((s) => `<option value="${s.id}" ${s.id === design.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        <a class="btn primary" id="apply" href="#">Aplicar em produto</a>
      </div>
    </header>
    <div class="detail-grid">
      <section class="stage-card">
        <div class="stage-toolbar">
          <div class="seg" id="bgSeg">
            <button data-bg="checker" class="active">Xadrez</button><button data-bg="light">Claro</button><button data-bg="dark">Escuro</button>
          </div>
          <button class="btn ghost sm" id="dl">${ICONS.download}<span>Baixar original</span></button>
        </div>
        <div class="art-stage checker" id="stage"><img id="art" alt=""></div>
        <div class="meta-row" id="meta"></div>
      </section>
      <aside class="side">
        <div class="panel">
          <div class="section-head"><h3>Versões</h3><label class="btn sm">${ICONS.upload}<span>Nova versão</span><input type="file" id="newVersion" accept="${ACCEPT_ATTR}" hidden></label></div>
          <ol class="versions" id="versions"></ol>
          <p class="hint">Versões nunca são apagadas automaticamente. “Tornar atual” só muda qual versão é usada.</p>
        </div>
        <div class="panel">
          <h3>Pronto para produção?</h3>
          <div id="prod"></div>
          <p class="hint">Isto é a <b>arte</b>. O arquivo técnico para a gráfica fica separado em Arquivos de Produção (Fase 2).</p>
        </div>
      </aside>
    </div>
    <section class="section">
      <div class="section-head"><h2>Mockups com esta arte</h2></div>
      ${mockups.length ? `<div class="grid">${mockups.map((m) => mockupCard(m, design.name)).join('')}</div>` : '<p class="muted">Nenhum mockup ainda. Use “Aplicar em produto”.</p>'}
    </section>
    <section class="danger-zone">
      <button class="btn danger ghost sm" id="del">Excluir design</button>
    </section>`;

  const current = () => versions.find((v) => v.id === viewing) || versions[versions.length - 1];

  function draw() {
    const v = current();
    $('#art', el).src = objURL(artBlob(v));
    $('#apply', el).href = `#/mockup/new?design=${id}&version=${v.id}`;
    $('#meta', el).innerHTML = `
      <span>V${v.n}</span><span>${esc(v.fileName)}</span><span>${v.width} × ${v.height} px</span>
      <span>${fmtBytes(v.size)}</span><span>${(v.mime.split('/')[1] || '').replace('svg+xml', 'svg').toUpperCase()}</span>`;
    $('#versions', el).innerHTML = versions.slice().reverse().map((x) => `
      <li class="${x.id === viewing ? 'viewing' : ''}">
        <button class="v-main" data-view="${x.id}">
          <img src="${objURL(x.thumb)}" alt="" class="checker">
          <span><b>V${x.n}</b> ${x.id === design.currentVersionId ? '<em class="tag">atual</em>' : ''}<small>${ORIGIN[x.origin] || x.origin} · ${fmtDateTime(x.createdAt)}</small></span>
        </button>
        ${x.id !== design.currentVersionId ? `<button class="btn ghost sm" data-current="${x.id}">Tornar atual</button>` : ''}
      </li>`).join('');

    const isVector = v.mime === 'image/svg+xml';
    const maxCm = (v.width / 300) * 2.54;
    const dpiAt = Math.round(v.width / (PRINT_CM / 2.54));
    const checks = [
      [v.hasAlpha !== false, v.hasAlpha === false ? 'Sem fundo transparente: o mockup mostrará um retângulo.' : 'Fundo transparente.'],
      [isVector || dpiAt >= 300, isVector ? 'Vetor (SVG): escala sem perder qualidade.' : `${dpiAt} DPI numa estampa de ${PRINT_CM} cm · a 300 DPI vai até ${maxCm.toFixed(1)} cm.`],
    ];
    $('#prod', el).innerHTML = `<ul class="checks">${checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'warn'}">${t}</li>`).join('')}</ul>`;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { viewing = +b.dataset.view; draw(); }
    else if (b.dataset.current) {
      await setCurrentVersion(id, +b.dataset.current);
      design = await db.designs.get(id);
      viewing = design.currentVersionId;
      toast(`V${current().n} agora é a versão atual.`);
      draw();
    } else if (b.dataset.bg) {
      bg = b.dataset.bg;
      el.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('active', x === b));
      $('#stage', el).className = `art-stage ${bg}`;
    } else if (b.id === 'dl') {
      const v = current();
      download(v.original, v.fileName || `${slugify(design.name)}-v${v.n}`);
    } else if (b.id === 'del') {
      const ok = await confirmDialog('Excluir design', `Excluir <b>${esc(design.name)}</b> e todas as ${versions.length} versões? Os mockups já salvos continuam como imagem. Isso não pode ser desfeito.`, 'Excluir', true);
      if (!ok) return;
      await deleteDesign(id);
      toast('Design excluído.');
      location.hash = '#/designs';
    }
  });

  $('#name', el).addEventListener('change', async (e) => {
    const name = e.target.value.trim();
    if (!name) { e.target.value = design.name; return; }
    await db.designs.update(id, { name, updatedAt: Date.now() });
    design.name = name;
    toast('Nome salvo.');
  });
  $('#status', el).addEventListener('change', async (e) => {
    await db.designs.update(id, { status: e.target.value, updatedAt: Date.now() });
    design.status = e.target.value;
    toast(`Status: ${e.target.selectedOptions[0].text}.`);
  });
  $('#newVersion', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const art = await prepareArtFile(file);
      await addVersion(id, art, 'upload');
      design = await db.designs.get(id);
      versions = await db.versions.where('designId').equals(id).sortBy('n');
      viewing = design.currentVersionId;
      toast(`V${design.versionCount} adicionada. As anteriores continuam salvas.`);
      draw();
    } catch (err) { toast(err.message, 'err'); }
  });

  draw();
}

