import { getSetting, setSetting, exportBackup, importBackup } from '../db.js';
import { $, esc, fmtBytes, toast, confirmDialog, download } from '../util.js';
import { pageHead, ICONS } from '../ui.js';

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
