import { createDesign, STATUS } from '../db.js';
import { $, esc, objURL, fmtBytes, prepareArtFile, nameFromFile, toast, ACCEPT_ATTR } from '../util.js';
import { pageHead, ICONS } from '../ui.js';

const STYLES = ['Streetwear', 'Minimalista', 'Vintage', 'Old School', 'Editorial', 'Luxury', 'Graffiti', 'Tipográfico', 'Ilustração', 'Grunge', 'Monocromático', 'Experimental'];

export async function render(el) {
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Criar arte', title: 'Nova arte', lede: 'Envie uma arte pronta. A arte enviada é guardada como V1 e nunca é sobrescrita.' })}
    <div class="create-grid">
      <section class="panel">
        <label class="dropzone" id="drop">
          <input type="file" id="file" accept="${ACCEPT_ATTR}" hidden>
          <div class="dz-empty" id="dzEmpty">
            ${ICONS.upload}
            <strong>Arraste a arte aqui</strong>
            <span>ou clique para escolher · PNG, JPG, WEBP ou SVG</span>
          </div>
          <div class="dz-preview checker" id="dzPreview" hidden><img id="previewImg" alt="Prévia da arte"></div>
        </label>
        <div class="meta-row" id="meta"></div>
        <div class="form-grid">
          <label class="field"><span>Nome da arte</span><input id="name" placeholder="Ex.: EKKLESIA CROSS 01" autocomplete="off"></label>
          <label class="field"><span>Status</span>
            <select id="status">${STATUS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
          </label>
        </div>
        <div class="actions-row">
          <button class="btn primary" id="save" disabled>Salvar design</button>
        </div>
      </section>
      <aside class="panel ai-teaser">
        <p class="eyebrow">AI Design Studio · Fase 3</p>
        <h3>Descreva a ideia, a IA desenha.</h3>
        <p class="muted">Aqui você vai escrever a ideia da estampa e escolher estilo, composição e área. Artes tipográficas virão em SVG vetorial, já prontas para produção.</p>
        <div class="chips static">${STYLES.map((s) => `<span class="chip">${s}</span>`).join('')}</div>
      </aside>
    </div>`;

  let art = null;
  const input = $('#file', el), drop = $('#drop', el);

  async function take(file) {
    if (!file) return;
    try {
      art = await prepareArtFile(file);
    } catch (e) { art = null; toast(e.message, 'err'); return; }
    $('#previewImg', el).src = objURL(art.preview || art.original);
    $('#dzEmpty', el).hidden = true;
    $('#dzPreview', el).hidden = false;
    const nameInput = $('#name', el);
    if (!nameInput.value) nameInput.value = nameFromFile(file.name);
    $('#meta', el).innerHTML = `
      <span>${esc(art.fileName)}</span><span>${art.width} × ${art.height} px</span><span>${fmtBytes(art.size)}</span>
      <span class="${art.hasAlpha === false ? 'warn' : ''}">${art.hasAlpha ? 'Fundo transparente' : art.hasAlpha === false ? 'Sem transparência' : ''}</span>`;
    $('#save', el).disabled = false;
  }

  input.addEventListener('change', () => take(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files[0]); });

  $('#save', el).addEventListener('click', async (e) => {
    if (!art) return;
    const name = $('#name', el).value.trim() || nameFromFile(art.fileName);
    e.currentTarget.disabled = true;
    try {
      const id = await createDesign(name, art, $('#status', el).value);
      toast('Design salvo como V1.');
      location.hash = `#/design/${id}`;
    } catch (err) {
      console.error(err);
      toast('Não foi possível salvar o design.', 'err');
      e.currentTarget.disabled = false;
    }
  });
}
