import { getSetting, setSetting, exportBackup, importBackup } from '../db.js';
import { $, esc, fmtBytes, toast, confirmDialog, download } from '../util.js';
import { pageHead, ICONS } from '../ui.js';
import { getLogo, saveLogo, processLogo, tinted } from '../brand.js';

const BRAND_FIELDS = [
  { k: 'brandName', label: 'Nome da marca', ph: 'EKKLESIA' },
  { k: 'tagline', label: 'Frase institucional', ph: 'Ex.: Vestir o que se crê.' },
  { k: 'apresentacao', label: 'Apresentação da marca (página 2 do catálogo)', ph: 'Quem é a EKKLESIA, o que ela acredita, para quem ela veste...', area: true },
  { k: 'site', label: 'Site', ph: 'https://' },
  { k: 'instagram', label: 'Instagram', ph: '@ekklesia' },
  { k: 'whatsapp', label: 'WhatsApp', ph: '+55 ...' },
];

export async function render(el) {
  const brand = await getSetting('brand', { brandName: 'EKKLESIA' });
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);

  el.innerHTML = `
    ${pageHead({ eyebrow: 'Configurações', title: 'Marca e dados' })}
    <section class="panel logo-panel">
      <div class="section-head"><h3>Logo oficial</h3>
        <div class="actions-row tight">
          <label class="btn primary sm">${ICONS.upload}<span id="logoBtn">Enviar logo</span><input type="file" id="logoFile" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" hidden></label>
          <button class="btn ghost sm" id="logoRm" hidden>Remover</button>
        </div>
      </div>
      <p class="hint">PNG transparente ou a logo clara sobre fundo escuro (ou escura sobre fundo claro). O sistema recorta o fundo e aplica a logo em branco, preto ou dourado: no menu, na etiqueta da gola dos mockups e na capa, apresentação e contracapa do catálogo.</p>
      <div class="logo-previews" id="logoPrev"></div>
    </section>
    <div class="settings-grid">
      <section class="panel">
        <h3>Marca</h3>
        <p class="hint">Usado na capa, na apresentação e nos botões do catálogo.</p>
        <form id="brand" class="form-stack">
          ${BRAND_FIELDS.map((f) => `<label class="field"><span>${f.label}</span>${f.area ? `<textarea name="${f.k}" rows="6" placeholder="${esc(f.ph)}">${esc(brand[f.k] || '')}</textarea>` : `<input name="${f.k}" value="${esc(brand[f.k] || '')}" placeholder="${esc(f.ph)}">`}</label>`).join('')}
          <div class="actions-row"><button class="btn primary">Salvar</button></div>
        </form>
      </section>
      <section class="panel">
        <h3>Dados e backup</h3>
        <p class="hint">Por enquanto, tudo fica salvo <b>somente neste navegador</b>. Faça backup com frequência e antes de limpar o navegador ou trocar de computador.</p>
        <dl class="kv">
          <dt>Espaço usado</dt><dd>${est ? `${fmtBytes(est.usage)} de ${fmtBytes(est.quota)}` : '—'}</dd>
          <dt>Proteção contra limpeza</dt><dd>${persisted ? 'Ativa' : 'Não garantida pelo navegador'}</dd>
        </dl>
        <div class="actions-row">
          <button class="btn" id="export">${ICONS.download}<span>Exportar backup</span></button>
          <label class="btn ghost">${ICONS.upload}<span>Restaurar backup</span><input type="file" id="import" accept=".json,application/json" hidden></label>
        </div>
      </section>
    </div>`;

  async function drawLogo() {
    const l = await getLogo();
    $('#logoRm', el).hidden = !l;
    $('#logoBtn', el).textContent = l ? 'Trocar logo' : 'Enviar logo';
    const box = $('#logoPrev', el);
    box.innerHTML = '';
    if (!l) { box.innerHTML = '<div class="logo-empty">Nenhuma logo enviada. Enquanto isso, o nome da marca é usado em texto.</div>'; return; }
    for (const [bg, color, label] of [['#0c0c0c', '#ffffff', 'Branca'], ['#f3f1ec', '#0c0c0c', 'Preta'], ['#151515', '#c4a96b', 'Dourada']]) {
      const fig = document.createElement('figure');
      fig.style.background = bg;
      fig.append(tinted(l, color, 600));
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      fig.append(cap);
      box.append(fig);
    }
  }
  $('#logoFile', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await saveLogo(await processLogo(file));
      toast('Logo salva.');
      drawLogo();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#logoRm', el).addEventListener('click', async () => {
    if (!await confirmDialog('Remover logo', 'Remover a logo? O nome da marca volta a aparecer em texto.', 'Remover', true)) return;
    await saveLogo(null);
    drawLogo();
  });
  drawLogo();

  $('#brand', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    await setSetting('brand', Object.fromEntries(new FormData(e.target)));
    toast('Dados da marca salvos.');
  });
  $('#export', el).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const blob = await exportBackup();
      download(blob, `ekklesia-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Backup exportado.');
    } finally { e.currentTarget.disabled = false; }
  });
  $('#import', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ok = await confirmDialog('Restaurar backup', 'Isso <b>substitui todos os dados atuais</b> deste navegador pelo conteúdo do backup. Continuar?', 'Restaurar', true);
    if (!ok) return;
    try {
      await importBackup(file);
      toast('Backup restaurado.');
      location.hash = '#/';
    } catch (err) { toast(err.message || 'Backup inválido.', 'err'); }
  });
}
