import { db, getSetting, setSetting } from '../db.js';
import { $, esc, toast, fmtDateTime } from '../util.js';
import { pageHead, ICONS } from '../ui.js';
import { getLoja, getToken, publishStore, testConnection } from '../store-publish.js';

const FIELDS = [
  ['Pagamento (Pix)', [
    { k: 'pixChave', label: 'Chave Pix', ph: 'CNPJ, CPF, e-mail, telefone (+55...) ou chave aleatória', req: true },
    { k: 'pixNome', label: 'Nome do recebedor (até 25 letras)', ph: 'EKKLESIA' },
    { k: 'pixCidade', label: 'Cidade do recebedor', ph: 'RONDONOPOLIS' },
    { k: 'entradaPct', label: 'Entrada mínima (%)', ph: '50', num: true },
    { k: 'whatsapp', label: 'WhatsApp que recebe os pedidos', ph: '+55 66 9...' },
  ]],
  ['Lançamento e frete', [
    { k: 'lancDesconto', label: 'Desconto padrão de lançamento (%)', ph: '40', num: true },
    { k: 'lancLimite', label: 'Válido para as primeiras (unidades)', ph: '50', num: true },
    { k: 'freteGratisAcima', label: 'Frete grátis acima de (R$)', ph: '299', num: true },
    { k: 'prazoProducao', label: 'Prazo de produção (aparece na loja)', ph: 'Ex.: até 20 dias úteis após a entrada' },
  ]],
  ['Capa da loja', [
    { k: 'heroTitulo', label: 'Título', ph: 'Vista o que você crê' },
    { k: 'heroDestaque', label: 'Palavra em dourado', ph: 'EKKLESIA' },
    { k: 'heroVersiculo', label: 'Versículo', ph: '"Ide por todo o mundo..." — Mc 16:15' },
    { k: 'heroTexto', label: 'Texto', ph: '', area: true },
    { k: 'faixa', label: 'Faixa corrida (separe com ✦)', ph: '' },
    { k: 'manifesto', label: 'Manifesto', ph: '', area: true },
  ]],
];

export async function render(el) {
  const loja = await getLoja();
  const token = await getToken();
  const last = await getSetting('lojaUltima', null);
  const ativos = (await db.products.toArray()).filter((p) => p.status === 'ativo' && p.preco).length;
  const url = `https://${loja.dominio}`;

  const field = (f) => `<label class="field"><span>${f.label}${f.req ? ' *' : ''}</span>${f.area
    ? `<textarea name="${f.k}" rows="3" placeholder="${esc(f.ph)}">${esc(loja[f.k] ?? '')}</textarea>`
    : `<input name="${f.k}" value="${esc(loja[f.k] ?? '')}" placeholder="${esc(f.ph)}" ${f.num ? 'inputmode="numeric"' : ''}>`}</label>`;

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Venda',
      title: 'Loja online',
      lede: `Os produtos <b>ativos</b> do Estúdio viram a loja em <a class="link" href="${url}" target="_blank" rel="noopener">${esc(loja.dominio)}</a>. Pagamento por Pix, com entrada ou valor total.`,
      actions: `<button class="btn primary lg" id="publish">${ICONS.upload}<span>Publicar na loja</span></button>`,
    })}
    <div class="publish-status panel">
      <div><b>${ativos}</b> produto(s) ativo(s) com preço prontos para a loja.</div>
      <div class="muted" id="pubInfo">${last ? `Última publicação: ${fmtDateTime(last.at)} · ${last.produtos} peças${last.mudancas ? ` · ${last.mudancas} arquivo(s) atualizado(s)` : ' · sem mudanças'}` : 'Ainda não publicado.'}</div>
      <div class="muted" id="pubProgress"></div>
    </div>
    <form id="lojaForm" class="store-grid">
      ${FIELDS.map(([title, fs]) => `<section class="panel form-stack"><h3>${title}</h3>${fs.map(field).join('')}</section>`).join('')}
      <section class="panel form-stack">
        <h3>Conexão com a loja (GitHub)</h3>
        <label class="field"><span>Repositório</span><input name="repo" value="${esc(loja.repo)}"></label>
        <label class="field"><span>Domínio</span><input name="dominio" value="${esc(loja.dominio)}"></label>
        <label class="field"><span>Token do GitHub (fica só neste navegador)</span><input type="password" id="token" value="${esc(token)}" autocomplete="off" placeholder="github_pat_..."></label>
        <p class="hint">Crie em github.com → Settings → Developer settings → <b>Fine-grained tokens</b>: acesso só ao repositório <b>${esc(loja.repo)}</b>, permissão <b>Contents: Read and write</b>. O token não vai para backups nem para a loja.</p>
        <label class="toggle"><input type="checkbox" name="auto" ${loja.auto ? 'checked' : ''}><span>Publicar automaticamente ao salvar um produto</span></label>
        <div class="actions-row"><button type="button" class="btn" id="test">Testar conexão</button></div>
      </section>
      <div class="form-actions"><span></span><button class="btn primary">Salvar configurações</button></div>
    </form>`;

  const form = $('#lojaForm', el);
  async function saveForm() {
    const fd = new FormData(form);
    const next = { ...loja };
    for (const [k, v] of fd.entries()) next[k] = typeof v === 'string' ? v.trim() : v;
    next.auto = form.auto.checked;
    for (const k of ['entradaPct', 'lancDesconto', 'lancLimite', 'freteGratisAcima']) next[k] = next[k] === '' ? loja[k] : Math.max(0, +String(next[k]).replace(',', '.') || 0);
    next.entradaPct = Math.min(100, Math.max(1, next.entradaPct));
    next.pixNome = next.pixNome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().slice(0, 25);
    next.pixCidade = next.pixCidade.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().slice(0, 15);
    await setSetting('loja', next);
    await setSetting('lojaToken', $('#token', el).value.trim());
    Object.assign(loja, next);
    form.pixNome.value = next.pixNome;
    form.pixCidade.value = next.pixCidade;
  }
  form.addEventListener('submit', async (e) => { e.preventDefault(); await saveForm(); toast('Configurações da loja salvas.'); });
  $('#test', el).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await saveForm(); const r = await testConnection(); toast(`Conectado a ${r.full_name}.`); } catch (err) { toast(err.message, 'err'); }
    e.currentTarget.disabled = false;
  });
  $('#publish', el).addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const prog = $('#pubProgress', el);
    try {
      await saveForm();
      const r = await publishStore((m) => { prog.textContent = m; });
      prog.textContent = '';
      toast(r.changed ? `Loja atualizada: ${r.produtos} peças. Entra no ar em cerca de 1 minuto.` : 'A loja já estava atualizada.');
      const l = await getSetting('lojaUltima', null);
      $('#pubInfo', el).textContent = `Última publicação: ${fmtDateTime(l.at)} · ${l.produtos} peças${l.mudancas ? ` · ${l.mudancas} arquivo(s) atualizado(s)` : ' · sem mudanças'}`;
    } catch (err) { prog.textContent = ''; toast(err.message, 'err'); }
    b.disabled = false;
  });
}
