import { getSetting, setSetting, exportBackup, importBackup } from '../db.js';
import { $, esc, fmtBytes, toast, confirmDialog, download } from '../util.js';
import { pageHead, ICONS } from '../ui.js';
import { getLogo, saveLogo, processLogo, tinted } from '../brand.js';
import { getPresets, savePresets, PRESET_GROUPS, DEFAULT_PRESETS } from '../presets.js';
import { syncNow, onStatus, getConf, setConf } from '../sync.js';
import { logout } from '../auth.js';

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
    <section class="panel cloud-panel">
      <div class="section-head"><h3>Nuvem: o Estúdio igual no celular e no computador</h3>
        <div class="actions-row tight"><button class="btn primary sm" id="syncBtn">Sincronizar agora</button><button class="btn ghost sm" id="logoutBtn">Sair da conta</button></div></div>
      <p class="hint">Artes, mockups, produtos, fotos das peças e configurações ficam salvos no repositório <b>privado</b> do GitHub e sincronizam sozinhos entre os aparelhos. Em cada aparelho, cole o mesmo token uma vez.</p>
      <div class="form-grid two">
        <label class="field"><span>Token do GitHub (o mesmo da Loja online)</span><span class="secret"><input type="password" id="cloudToken" autocomplete="off" placeholder="github_pat_..."><button type="button" class="btn ghost sm" id="tokShow">Mostrar</button><button type="button" class="btn ghost sm" id="tokCopy">Copiar</button></span></label>
        <label class="field"><span>Repositório de dados (privado)</span><input id="cloudRepo"></label>
      </div>
      <p class="hint">No token fine-grained, dê acesso aos repositórios <b>ekklesia-studio-dados</b> e <b>ekklesia-loja</b>, com <b>Contents: Read and write</b>.</p>
      <p class="sync-line" id="syncLine"></p>
    </section>
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
    <section class="panel presets-panel">
      <div class="section-head"><h3>Modelos de descrição</h3>
        <div class="actions-row tight"><button class="btn ghost sm" id="presetsReset">Restaurar padrões</button><button class="btn primary sm" id="presetsSave">Salvar modelos</button></div></div>
      <p class="hint">Textos prontos por tecido, modelagem, estampa, cuidados e produção. No cadastro do produto, escolha e clique em “Inserir no texto”. No tecido, material e gramatura também são preenchidos.</p>
      <div id="presets"></div>
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
    $('#logoRm', el).hidden = !l || l.padrao;
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

  // ---- nuvem ----
  $('#cloudToken', el).value = await getSetting('lojaToken', '');
  $('#cloudRepo', el).value = getConf().repo;
  let unsub = null;
  unsub = onStatus((s) => {
    const line = $('#syncLine', el);
    if (!line || !el.isConnected) { setTimeout(() => unsub?.()); return; }
    line.className = `sync-line ${s.state}`;
    line.textContent = s.state === 'ok' ? `Tudo sincronizado às ${new Date(s.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : s.state === 'running' ? (s.msg || 'Sincronizando…') : s.state === 'error' ? `Erro: ${s.msg}` : s.state === 'off' ? 'Nuvem desligada: cole o token para ligar.' : s.state === 'offline' ? 'Sem internet: as mudanças ficam neste aparelho e sobem quando voltar.' : '';
  });
  $('#syncBtn', el).addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const tk = $('#cloudToken', el).value.replace(/\s+/g, '');
    $('#cloudToken', el).value = tk;
    await setSetting('lojaToken', tk);
    if (tk && !/^(github_pat_|ghp_)/.test(tk)) toast('Esse texto não parece um token do GitHub (começa com github_pat_).', 'err');
    setConf({ repo: $('#cloudRepo', el).value.trim() || getConf().repo });
    try { const r = await syncNow(); if (!r.off) toast(r.pulled || r.pushed ? `Sincronizado: ${r.pushed || 0} enviado(s), ${r.pulled || 0} recebido(s).` : 'Já estava tudo sincronizado.'); } catch (err) { toast(err.message, 'err'); }
    b.disabled = false;
  });
  $('#logoutBtn', el).addEventListener('click', logout);
  $('#tokShow', el).addEventListener('click', (e) => { const i = $('#cloudToken', el); i.type = i.type === 'password' ? 'text' : 'password'; e.currentTarget.textContent = i.type === 'password' ? 'Mostrar' : 'Ocultar'; });
  $('#tokCopy', el).addEventListener('click', async () => {
    const v = $('#cloudToken', el).value.trim();
    if (!v) { toast('Nenhum token neste aparelho.', 'err'); return; }
    try { await navigator.clipboard.writeText(v); toast('Token copiado. Cole no Estúdio do outro aparelho.'); } catch { toast('Não deu para copiar: use Mostrar e copie à mão.', 'err'); }
  });

  // ---- modelos de descrição ----
  let presets = structuredClone(await getPresets());
  const pbox = $('#presets', el);
  function drawPresets() {
    pbox.innerHTML = PRESET_GROUPS.map((g) => `
      <div class="preset-group"><h4>${g.label}</h4>
        ${presets.map((x, i) => (x.grupo !== g.id ? '' : `
          <div class="preset-item" data-i="${i}">
            <input data-k="nome" value="${esc(x.nome)}" placeholder="Nome do modelo">
            ${g.id === 'tecido' ? `<input data-k="material" value="${esc(x.material || '')}" placeholder="Material"><input data-k="gramatura" value="${esc(x.gramatura || '')}" placeholder="g/m²" class="short">` : ''}
            <textarea data-k="texto" rows="2" placeholder="Texto que entra na descrição">${esc(x.texto)}</textarea>
            <button class="icon-btn" data-del="${i}" aria-label="Excluir modelo">✕</button>
          </div>`)).join('')}
        <button class="link" data-add="${g.id}">+ Adicionar modelo de ${g.label.toLowerCase()}</button>
      </div>`).join('');
  }
  pbox.addEventListener('input', (e) => { const it = e.target.closest('[data-i]'); if (it && e.target.dataset.k) presets[+it.dataset.i][e.target.dataset.k] = e.target.value; });
  pbox.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.del) { presets.splice(+b.dataset.del, 1); drawPresets(); }
    if (b.dataset.add) { presets.push({ id: `u${Date.now()}`, grupo: b.dataset.add, nome: '', texto: '' }); drawPresets(); pbox.querySelector(`[data-i="${presets.length - 1}"] input`)?.focus(); }
  });
  $('#presetsSave', el).addEventListener('click', async () => { await savePresets(presets.filter((x) => x.nome.trim() || x.texto.trim())); toast('Modelos de descrição salvos.'); });
  $('#presetsReset', el).addEventListener('click', async () => {
    if (!await confirmDialog('Restaurar modelos', 'Voltar aos modelos de descrição padrão? Os seus ajustes nos modelos serão perdidos.', 'Restaurar', true)) return;
    presets = structuredClone(DEFAULT_PRESETS); await savePresets(presets); drawPresets();
  });
  drawPresets();

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
