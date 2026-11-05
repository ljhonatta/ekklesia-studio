import { db, getSetting, setSetting } from '../db.js';
import { $, $$, esc, objURL, toast, confirmDialog, modal, slugify } from '../util.js';
import { CATEGORIAS, SIZES, TECNICAS, DISPONIBILIDADE, PRODUCT_STATUS, brl, parsePrice, installmentText, tecLabel, dispLabel, buyLink, DEFAULT_BRAND, precoPorMargem, margemDe, pct } from '../data.js';
import { COLORS } from '../garments.js';
import { productImages, nextSku, uniqueSlug, duplicateProduct } from '../products.js';
import { getPresets, PRESET_GROUPS } from '../presets.js';
import { autoPublish, getLoja, linkVenda, isLinkLoja } from '../store-publish.js';

const GENEROS = ['Unissex', 'Masculino', 'Feminino'];
const generoFor = (cat) => (/feminina|babylook/i.test(cat) ? 'Feminino' : /masculina/i.test(cat) ? 'Masculino' : 'Unissex');
import { pageHead, empty, ICONS, pill } from '../ui.js';

export const DEFAULT_MARGENS = { normal: 80, lancamento: 77 };
const getMargens = async () => ({ ...DEFAULT_MARGENS, ...(await getSetting('margens', {})) });
// Preço que vale na loja agora: o de lançamento enquanto houver vagas.
const precoLanc = (p, loja) => (p.precoLancamento || (p.preco ? Math.round(p.preco * (1 - (p.lancDesconto ?? loja.lancDesconto ?? 40) / 100) * 100) / 100 : null));
const priceLine = (p, loja = {}) => {
  if (!p.preco) return 'sem preço';
  const m = margemDe(p.preco, p.custo);
  return p.lancamento ? `${brl(precoLanc(p, loja))} lanç. · ${brl(p.preco)}` : `${brl(p.preco)}${m != null ? ` · ${pct(m)}` : ''}`;
};

const colorHex = (name) => COLORS.find((c) => c.label.toLowerCase() === String(name).toLowerCase())?.hex || '#777';
const statusPill = (p) => (p.status === 'ativo' ? pill('aprovado', 'Ativo') : pill('criacao', 'Rascunho'));

// ---------- lista ----------
export async function list(el) {
  const all = await db.products.orderBy('id').reverse().toArray();
  const covers = new Map(await Promise.all(all.map(async (p) => [p.id, (await productImages(p))[0]])));
  const loja = await getSetting('loja', {});
  let filter = 'todos';
  const inFilter = (p) => filter === 'todos' || (filter === 'base' ? p.base : p.status === filter);
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Gerenciamento',
      title: 'Produtos',
      lede: 'Cada produto liga a arte, o arquivo de produção, os mockups e o link de venda.',
      actions: `<button class="btn" id="margem">Ajustar preços pela margem</button><a class="btn primary" href="#/produto/new">${ICONS.plus}<span>Novo produto</span></a>`,
    })}
    <div class="toolbar"><div class="chips">
      ${[['todos', 'Todos'], ['ativo', 'Ativos'], ['rascunho', 'Rascunhos'], ['base', 'Peças base']].map(([id, l]) => `<button class="chip" data-f="${id}">${l} <b>${id === 'todos' ? all.length : id === 'base' ? all.filter((p) => p.base).length : all.filter((p) => p.status === id).length}</b></button>`).join('')}
    </div></div>
    ${all.some((p) => p.base) ? '<p class="hint">Peças base = modelos do fornecedor com preço e ficha prontos. Abra uma, clique em <b>Duplicar</b>, troque a arte e deixe <b>Ativo</b> para ir à loja.</p>' : ''}
    <div id="list"></div>`;
  const draw = () => {
    $$('[data-f]', el).forEach((b) => b.classList.toggle('active', b.dataset.f === filter));
    const items = all.filter(inFilter);
    $('#list', el).innerHTML = items.length ? `<div class="grid">${items.map((p) => {
      const c = covers.get(p.id);
      return `<a class="card mockup-card" href="#/produto/${p.id}">
        <div class="thumb ${c?.kind === 'art' ? 'checker' : ''}">${c ? `<img src="${objURL(c.blob)}" alt="" loading="lazy" class="${c.kind === 'art' ? 'contain' : ''}">` : ''}</div>
        <div class="card-body"><div class="card-title">${esc(p.nome)}</div>
          <div class="card-meta"><span>${esc(p.sku || '')} · ${priceLine(p, loja)}</span>${statusPill(p)}</div></div></a>`;
    }).join('')}</div>` : all.length ? empty('Nada por aqui', 'Nenhum produto com esse filtro.')
      : empty('Nenhum produto ainda', 'Cadastre a primeira peça da coleção.', `<a class="btn primary" href="#/produto/new">${ICONS.plus}<span>Novo produto</span></a>`);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (b) { filter = b.dataset.f; draw(); }
    if (e.target.closest('#margem')) adjustMargins(all.filter(inFilter), filter === 'todos' ? 'todos os produtos' : 'os produtos deste filtro');
  });
  draw();
}

// Recalcula preço normal e de lançamento a partir do custo de cada peça.
async function adjustMargins(items, scopeLabel) {
  const m = await getMargens();
  const withCost = items.filter((p) => p.custo);
  if (!withCost.length) { toast('Nenhum produto com custo cadastrado neste filtro.', 'err'); return; }
  const ok = await modal({
    title: 'Ajustar preços pela margem',
    body: `<p>Vale para ${scopeLabel} que têm custo (${withCost.length}). Margem = quanto do preço de venda é lucro. O preço arredonda para cima em X9,99.</p>
      <div class="form-grid two">
        <label class="field"><span>Margem do preço normal (%)</span><input id="mN" inputmode="decimal" value="${m.normal}"></label>
        <label class="field"><span>Margem do preço de lançamento (%)</span><input id="mL" inputmode="decimal" value="${m.lancamento}"></label>
      </div><p class="hint" id="mEx"></p>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Aplicar', value: true, kind: 'primary' }],
    onOpen: (box) => {
      const ex = withCost[0];
      const upd = () => { $('#mEx', box).textContent = `Ex.: ${ex.nome} (custo ${brl(ex.custo)}) → ${brl(precoPorMargem(ex.custo, +$('#mN', box).value.replace(',', '.')))} normal · ${brl(precoPorMargem(ex.custo, +$('#mL', box).value.replace(',', '.')))} no lançamento.`; };
      box.addEventListener('input', upd); upd();
      m._box = box;
    },
  });
  if (!ok) return;
  const normal = +$('#mN', m._box).value.replace(',', '.'), lancamento = +$('#mL', m._box).value.replace(',', '.');
  if (!(normal > 0 && normal < 100 && lancamento > 0 && lancamento < 100)) { toast('Margens precisam ficar entre 1 e 99%.', 'err'); return; }
  await setSetting('margens', { normal, lancamento });
  await db.transaction('rw', db.products, async () => {
    for (const p of withCost) {
      await db.products.update(p.id, { preco: precoPorMargem(p.custo, normal), precoLancamento: precoPorMargem(p.custo, lancamento), margemNormal: normal, margemLancamento: lancamento });
    }
  });
  toast(`Preços de ${withCost.length} produto(s) atualizados.`);
  autoPublish();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---------- formulário (novo / editar) ----------
export async function edit(el, [idStr], query) {
  const isNew = idStr === 'new';
  let p = isNew ? {
    nome: '', sku: await nextSku(), slug: '', categoria: CATEGORIAS[0], descricao: '', material: '100% algodão', gramatura: '',
    tecnica: 'dtf', cores: [], tamanhos: ['P', 'M', 'G', 'GG'], medidas: {}, preco: null, parcelas: 3, semJuros: true,
    disponibilidade: 'disponivel', status: 'rascunho', linkCompra: '', designId: +query.design || null, productionFileId: null, mockupIds: [],
    genero: 'Unissex', versiculo: '', lancamento: false, lancDesconto: null, lancLimite: null, lancVendidos: 0,
    custo: null, precoLancamento: null, fotos: [],
  } : await db.products.get(+idStr);
  if (!p) { el.innerHTML = empty('Produto não encontrado', '', '<a class="btn" href="#/produtos">Voltar</a>'); return; }
  p = structuredClone(p);
  p.genero ||= generoFor(p.categoria);
  const loja = await getSetting('loja', {});
  const margens = await getMargens();
  const presets = await getPresets();
  let slugTouched = !isNew;

  const designs = await db.designs.orderBy('updatedAt').reverse().toArray();
  const mockups = await db.mockups.orderBy('updatedAt').reverse().toArray();
  const files = await db.productionFiles.toArray();
  if (isNew && p.designId) {
    p.mockupIds = mockups.filter((m) => m.designId === p.designId).slice(0, 3).map((m) => m.id);
    p.productionFileId = files.find((f) => f.designId === p.designId)?.id || null;
  }

  const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`;
  const input = (f, label, attrs = '') => `<label class="field"><span>${label}</span><input data-f="${f}" value="${esc(p[f] ?? '')}" ${attrs}></label>`;

  el.innerHTML = `
    <a class="back" href="${isNew ? '#/produtos' : `#/produto/${p.id}`}">${ICONS.back}<span>${isNew ? 'Produtos' : 'Voltar ao produto'}</span></a>
    ${pageHead({ eyebrow: 'Ficha técnica', title: isNew ? 'Novo produto' : esc(p.nome) })}
    <form class="product-form" id="form" novalidate>
      <section class="panel">
        <h3>Identificação</h3>
        <div class="form-grid three">
          ${input('nome', 'Nome do produto', 'required placeholder="Ex.: Camiseta Romanos 8:28"')}
          ${input('sku', 'Código / SKU')}
          <label class="field"><span>Categoria</span><select data-f="categoria">${CATEGORIAS.map((c) => opt(c, c, p.categoria)).join('')}</select></label>
        </div>
        <div class="form-grid two">
          <label class="field"><span>Público</span><select data-f="genero">${GENEROS.map((g) => opt(g, g, p.genero)).join('')}</select></label>
          ${input('versiculo', 'Versículo da peça (opcional)', 'placeholder="Ex.: Mc 16:15"')}
        </div>
        <label class="field"><span>Descrição</span><textarea data-f="descricao" id="descricao" rows="6" placeholder="A ideia por trás da peça, o versículo, o caimento...">${esc(p.descricao)}</textarea></label>
        <div class="presets-row">
          <span class="muted">Modelos de descrição</span>
          ${PRESET_GROUPS.map((g) => `<select data-preset="${g.id}" aria-label="${g.label}"><option value="">${g.label}</option>${presets.filter((x) => x.grupo === g.id).map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}</select>`).join('')}
          <button type="button" class="btn sm" id="applyPresets">Inserir no texto</button>
          <a class="link" href="#/config">Editar modelos</a>
        </div>
        <div class="form-grid three">
          ${input('slug', 'Endereço (URL)', 'placeholder="camiseta-romanos-8-28"')}
          <label class="field"><span>Status</span><select data-f="status">${PRODUCT_STATUS.map((s) => opt(s.id, s.label, p.status)).join('')}</select></label>
          <label class="field"><span>Disponibilidade</span><select data-f="disponibilidade">${DISPONIBILIDADE.map((s) => opt(s.id, s.label, p.disponibilidade)).join('')}</select></label>
        </div>
      </section>

      <section class="panel">
        <h3>Tecido e produção</h3>
        <div class="form-grid three">
          ${input('material', 'Material')}
          ${input('gramatura', 'Gramatura (g/m²)', 'inputmode="numeric" placeholder="Ex.: 180"')}
          <label class="field"><span>Técnica de produção</span><select data-f="tecnica">${TECNICAS.map((t) => opt(t.id, t.label, p.tecnica)).join('')}</select></label>
        </div>
        <div class="field"><span>Cores disponíveis</span>
          <div class="chips" id="cores">${COLORS.map((c) => `<button type="button" class="chip color" data-cor="${esc(c.label)}"><i style="background:${c.hex}"></i>${c.label}</button>`).join('')}</div>
          <input id="corExtra" placeholder="Outras cores, separadas por vírgula" value="${esc(p.cores.filter((c) => !COLORS.some((x) => x.label === c)).join(', '))}">
        </div>
        <div class="field"><span>Tamanhos</span>
          <div class="chips" id="tams">${SIZES.map((s) => `<button type="button" class="chip" data-tam="${s}">${s}</button>`).join('')}</div>
        </div>
        <div class="field"><span>Tabela de medidas (cm, opcional)</span><div id="medidas"></div></div>
      </section>

      <section class="panel">
        <h3>Preço e venda</h3>
        <div class="form-grid three">
          <label class="field"><span>Preço (R$)</span><input data-f="preco" inputmode="decimal" placeholder="129,90" value="${p.preco != null ? String(p.preco).replace('.', ',') : ''}"></label>
          <label class="field"><span>Parcelamento</span><select data-f="parcelas">${Array.from({ length: 12 }, (_, i) => opt(i + 1, i ? `${i + 1}x` : 'À vista', p.parcelas)).join('')}</select></label>
          <label class="toggle inline"><input type="checkbox" data-f="semJuros" ${p.semJuros !== false ? 'checked' : ''}><span>Sem juros</span></label>
        </div>
        <p class="hint" id="parcInfo"></p>
        <div class="form-grid three">
          <label class="field"><span>Custo da peça (R$)</span><input data-f="custo" inputmode="decimal" placeholder="29,00" value="${p.custo != null ? String(p.custo).replace('.', ',') : ''}"></label>
          <label class="field"><span>Margem desejada (%)</span><input id="margemAlvo" inputmode="decimal" value="${p.margemNormal ?? margens.normal}"></label>
          <button type="button" class="btn" id="calcPreco">Calcular preço pela margem</button>
        </div>
        <p class="hint" id="margemInfo"></p>
        ${p.fornecedor ? `<p class="hint">Fornecedor: <b>${esc(p.fornecedor.nome)}</b> · ${esc(p.fornecedor.ref)} · varejo ${brl(p.fornecedor.varejo)} · atacado ${brl(p.fornecedor.atacado)} · alto atacado ${brl(p.fornecedor.altoAtacado)} (custo usado). Só aparece aqui no Estúdio.</p>` : ''}
        ${input('linkCompra', 'Link de venda', 'type="url" placeholder="Gerado sozinho ao deixar Ativo"')}
        <p class="hint">Com status <b>Ativo</b>, o link do produto no site é criado sozinho ao salvar. Só preencha se quiser vender por outro link.</p>
      </section>

      <section class="panel">
        <h3>Loja online</h3>
        <p class="hint">Produtos com status <b>Ativo</b> vão para a loja ao publicar.</p>
        <label class="toggle"><input type="checkbox" data-f="lancamento" ${p.lancamento ? 'checked' : ''}><span>Lançamento com desconto para as primeiras unidades</span></label>
        <div class="form-grid three" id="lancBox">
          <label class="field"><span>Preço de lançamento (R$)</span><input data-f="precoLancamento" inputmode="decimal" placeholder="${p.custo ? String(precoPorMargem(p.custo, margens.lancamento)).replace('.', ',') : '129,99'}" value="${p.precoLancamento != null ? String(p.precoLancamento).replace('.', ',') : ''}"></label>
          <label class="field"><span>Primeiras unidades</span><input data-f="lancLimite" inputmode="numeric" placeholder="${loja.lancLimite ?? 50}" value="${esc(p.lancLimite ?? '')}"></label>
          <label class="field"><span>Já vendidas no lançamento</span><input data-f="lancVendidos" inputmode="numeric" value="${esc(p.lancVendidos ?? 0)}"></label>
        </div>
        <p class="hint" id="lancInfo"></p>
      </section>

      <section class="panel">
        <h3>Arte, produção e mockups</h3>
        <div class="form-grid two">
          <label class="field"><span>Design</span><select data-f="designId"><option value="">— nenhum —</option>${designs.map((d) => opt(d.id, d.name, p.designId)).join('')}</select></label>
          <label class="field"><span>Arquivo de produção</span><select data-f="productionFileId" id="pfSel"></select></label>
        </div>
        <div class="field"><span>Mockups (clique na ordem: o primeiro é a capa)</span><div class="mock-pick" id="mocks"></div></div>
        <div class="field" id="fotosBox"><span>Fotos da peça base (usadas na loja quando não há mockup nem arte)</span><div class="mock-pick" id="fotos"></div></div>
      </section>

      <div class="form-actions">
        ${!isNew ? '<button type="button" class="btn danger ghost" id="del">Excluir produto</button>' : '<span></span>'}
        <div class="actions-row"><a class="btn ghost" href="${isNew ? '#/produtos' : `#/produto/${p.id}`}">Cancelar</a><button class="btn primary" id="save">Salvar produto</button></div>
      </div>
    </form>`;

  const form = $('#form', el);

  function drawDynamic() {
    $$('[data-cor]', el).forEach((b) => b.classList.toggle('active', p.cores.includes(b.dataset.cor)));
    $$('[data-tam]', el).forEach((b) => b.classList.toggle('active', p.tamanhos.includes(b.dataset.tam)));
    const sizes = SIZES.filter((s) => p.tamanhos.includes(s));
    $('#medidas', el).innerHTML = sizes.length ? `<table class="size-table"><thead><tr><th></th>${sizes.map((s) => `<th>${s}</th>`).join('')}</tr></thead><tbody>
      ${[['largura', 'Largura'], ['comprimento', 'Comprimento']].map(([k, l]) => `<tr><th>${l}</th>${sizes.map((s) => `<td><input data-med="${s}:${k}" inputmode="decimal" value="${esc(p.medidas?.[s]?.[k] ?? '')}"></td>`).join('')}</tr>`).join('')}
      </tbody></table>` : '<p class="hint">Selecione os tamanhos.</p>';
    $('#parcInfo', el).textContent = installmentText(p) || (p.preco ? `${brl(p.preco)} à vista` : '');
    $('#lancBox', el).hidden = !p.lancamento;
    const lim = +(p.lancLimite ?? loja.lancLimite ?? 50), pl = precoLanc(p, loja);
    $('#lancInfo', el).textContent = p.lancamento && p.preco ? `Na loja: de ${brl(p.preco)} por ${brl(pl)} (−${Math.round((1 - pl / p.preco) * 100)}%) · restam ${Math.max(0, lim - (+p.lancVendidos || 0))} de ${lim}. Depois volta para ${brl(p.preco)}.` : '';
    const mN = margemDe(p.preco, p.custo), mL = p.lancamento ? margemDe(pl, p.custo) : null;
    $('#margemInfo', el).innerHTML = p.custo ? `Custo ${brl(p.custo)}${mN != null ? ` · margem no preço normal <b>${pct(mN)}</b> (lucro ${brl(p.preco - p.custo)})` : ''}${mL != null ? ` · no lançamento <b>${pct(mL)}</b> (lucro ${brl(pl - p.custo)})` : ''}` : 'Informe o custo para ver a margem.';
    $('#fotosBox', el).hidden = !p.fotos?.length;
    $('#fotos', el).innerHTML = (p.fotos || []).map((b, i) => `<button type="button" class="mock on" data-rmfoto="${i}" title="Remover esta foto"><img src="${objURL(b)}" alt=""><b>✕</b></button>`).join('');
    const pfs = files.filter((f) => !p.designId || f.designId === p.designId);
    $('#pfSel', el).innerHTML = `<option value="">— nenhum —</option>${pfs.map((f) => opt(f.id, `${f.name} · ${tecLabel(f.tecnica)} · ${f.widthCm}×${f.heightCm} cm`, p.productionFileId)).join('')}`;
    const ordered = [...mockups].sort((a, b) => (b.designId === p.designId) - (a.designId === p.designId));
    $('#mocks', el).innerHTML = ordered.length ? ordered.map((m) => {
      const i = p.mockupIds.indexOf(m.id);
      return `<button type="button" class="mock ${i >= 0 ? 'on' : ''}" data-mock="${m.id}"><img src="${objURL(m.thumb)}" alt="">${i >= 0 ? `<b>${i === 0 ? 'Capa' : i + 1}</b>` : ''}</button>`;
    }).join('') : '<p class="hint">Nenhum mockup salvo. <a class="link" href="#/mockup/new">Criar mockup</a></p>';
  }

  form.addEventListener('input', (e) => {
    const t = e.target, f = t.dataset.f;
    if (t.dataset.med) {
      const [s, k] = t.dataset.med.split(':');
      p.medidas[s] = { ...p.medidas[s], [k]: t.value.trim() };
      return;
    }
    if (t.id === 'corExtra') return;
    if (!f) return;
    if (f === 'semJuros') p.semJuros = t.checked;
    else if (f === 'lancamento') { p.lancamento = t.checked; drawDynamic(); return; }
    else if (['lancDesconto', 'lancLimite', 'lancVendidos'].includes(f)) { p[f] = t.value === '' ? null : Math.max(0, parseInt(t.value, 10) || 0); drawDynamic(); return; }
    else if (f === 'preco' || f === 'custo' || f === 'precoLancamento') { p[f] = parsePrice(t.value); drawDynamic(); return; }
    else if (f === 'parcelas') p.parcelas = +t.value;
    else if (f === 'designId' || f === 'productionFileId') p[f] = t.value ? +t.value : null;
    else p[f] = t.value;
    if (f === 'slug') slugTouched = true;
    if (f === 'nome' && !slugTouched) $('[data-f="slug"]', el).value = p.slug = slugify(t.value);
    if (f === 'categoria') { p.genero = generoFor(t.value); $('[data-f="genero"]', el).value = p.genero; }
    if (['preco', 'parcelas', 'semJuros', 'designId'].includes(f)) {
      if (f === 'designId' && files.find((x) => x.id === p.productionFileId)?.designId !== p.designId) p.productionFileId = null;
      drawDynamic();
    }
  });
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cor) { const c = b.dataset.cor; p.cores = p.cores.includes(c) ? p.cores.filter((x) => x !== c) : [...p.cores, c]; drawDynamic(); }
    else if (b.dataset.tam) { const s = b.dataset.tam; p.tamanhos = p.tamanhos.includes(s) ? p.tamanhos.filter((x) => x !== s) : [...p.tamanhos, s]; drawDynamic(); }
    else if (b.id === 'calcPreco') {
      const m = parseFloat($('#margemAlvo', el).value.replace(',', '.'));
      if (!p.custo) { toast('Informe o custo da peça.', 'err'); return; }
      if (!(m > 0 && m < 100)) { toast('Margem entre 1 e 99%.', 'err'); return; }
      p.preco = precoPorMargem(p.custo, m); p.margemNormal = m;
      $('[data-f="preco"]', el).value = String(p.preco).replace('.', ',');
      if (p.lancamento && p.precoLancamento == null) { p.precoLancamento = precoPorMargem(p.custo, margens.lancamento); $('[data-f="precoLancamento"]', el).value = String(p.precoLancamento).replace('.', ','); }
      drawDynamic();
    }
    else if (b.dataset.rmfoto) { p.fotos = p.fotos.filter((_, i) => i !== +b.dataset.rmfoto); drawDynamic(); }
    else if (b.id === 'applyPresets') {
      const chosen = $$('[data-preset]', el).map((sel) => presets.find((x) => x.id === sel.value)).filter(Boolean);
      if (!chosen.length) { toast('Escolha ao menos um modelo.', 'err'); return; }
      const tecido = chosen.find((x) => x.grupo === 'tecido');
      if (tecido) {
        if (tecido.material) { p.material = tecido.material; $('[data-f="material"]', el).value = p.material; }
        if (tecido.gramatura) { p.gramatura = tecido.gramatura; $('[data-f="gramatura"]', el).value = p.gramatura; }
      }
      const extra = chosen.map((x) => x.texto).filter((t) => !p.descricao.includes(t));
      p.descricao = [p.descricao.trim(), ...extra].filter(Boolean).join('\n\n');
      $('#descricao', el).value = p.descricao;
      $$('[data-preset]', el).forEach((sel) => { sel.value = ''; });
      toast('Modelos inseridos na descrição.');
    }
    else if (b.dataset.mock) { const id = +b.dataset.mock; p.mockupIds = p.mockupIds.includes(id) ? p.mockupIds.filter((x) => x !== id) : [...p.mockupIds, id]; drawDynamic(); }
    else if (b.id === 'del') {
      if (!await confirmDialog('Excluir produto', `Excluir <b>${esc(p.nome)}</b>? Arte, mockups e arquivo de produção continuam salvos.`, 'Excluir', true)) return;
      await db.products.delete(p.id);
      const cats = await db.catalogs.toArray();
      for (const c of cats) if (c.productIds?.includes(p.id)) await db.catalogs.update(c.id, { productIds: c.productIds.filter((x) => x !== p.id) });
      toast('Produto excluído.');
      if (p.status === 'ativo') autoPublish();
      location.hash = '#/produtos';
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    p.nome = p.nome.trim();
    if (!p.nome) { toast('Dê um nome ao produto.', 'err'); $('[data-f="nome"]', el).focus(); return; }
    const extra = $('#corExtra', el).value.split(',').map((s) => s.trim()).filter(Boolean);
    p.cores = [...p.cores.filter((c) => COLORS.some((x) => x.label === c)), ...extra];
    p.tamanhos = SIZES.filter((s) => p.tamanhos.includes(s));
    p.medidas = Object.fromEntries(Object.entries(p.medidas || {}).filter(([s, m]) => p.tamanhos.includes(s) && (m.largura || m.comprimento)));
    p.slug = await uniqueSlug(slugify(p.slug || p.nome), p.id);
    const lojaCfg = await getLoja();
    if (isLinkLoja(p.linkCompra, lojaCfg)) p.linkCompra = p.status === 'ativo' ? linkVenda(p, lojaCfg) : '';
    p.updatedAt = Date.now();
    p.createdAt ||= p.updatedAt;
    try {
      const id = await db.products.put(p);
      toast(p.status === 'ativo' ? 'Produto salvo.' : 'Produto salvo como rascunho (não aparece no site).');
      autoPublish();
      location.hash = `#/produto/${id}`;
    } catch (err) { console.error(err); toast('Não foi possível salvar.', 'err'); }
  });
  drawDynamic();
}

// ---------- página do produto ----------
export async function page(el, [idStr]) {
  const p = await db.products.get(+idStr);
  if (!p) { el.innerHTML = empty('Produto não encontrado', '', '<a class="btn" href="#/produtos">Voltar</a>'); return; }
  const brand = { ...DEFAULT_BRAND, ...(await getSetting('brand', {})) };
  const loja = await getSetting('loja', {});
  const imgs = await productImages(p);
  const design = p.designId ? await db.designs.get(p.designId) : null;
  const pf = p.productionFileId ? await db.productionFiles.get(p.productionFileId) : null;
  const buy = buyLink(p, brand);
  const sizes = Object.keys(p.medidas || {});
  const missing = [!p.preco && 'preço', !imgs.length && 'imagem', p.status === 'ativo' && !p.linkCompra && 'link de venda (salve a ficha)', !pf && 'arquivo de produção'].filter(Boolean);

  el.innerHTML = `
    <div class="product-top">
      <a class="back" href="#/produtos">${ICONS.back}<span>Produtos</span></a>
      <div class="actions-row tight">${p.base && p.peca ? '<button class="btn primary" id="withArt">Criar produto com arte</button>' : ''}<button class="btn" id="dup">Duplicar</button><a class="btn" href="#/produto/${p.id}/editar">Editar ficha</a></div>
    </div>
    ${p.base ? (p.peca
      ? '<p class="banner">Modelo base: clique em <b>Criar produto com arte</b>, escolha a arte e as cores. O Estúdio estampa em todas as fotos desta peça e já manda o produto para o site.</p><p class="hint" id="artProgress"></p>'
      : '<p class="banner">Peça base do fornecedor: clique em <b>Duplicar</b> para criar um produto com a sua arte (mesmo preço e ficha).</p>') : ''}
    ${p.status === 'ativo' && p.linkCompra ? `<p class="banner sale-link">À venda no site: <a class="link" href="${esc(p.linkCompra)}" target="_blank" rel="noopener">${esc(p.linkCompra)}</a> <button class="btn sm" id="copyLink">Copiar link</button></p>` : ''}
    ${missing.length ? `<p class="banner warn">Falta preencher: ${missing.join(', ')}.</p>` : ''}
    <article class="pdp">
      <div class="pdp-gallery">
        <div class="pdp-main ${imgs[0]?.kind === 'art' ? 'checker' : ''}">${imgs[0] ? `<img id="mainImg" src="${objURL(imgs[0].blob)}" alt="${esc(p.nome)}">` : '<span class="muted">Sem imagem</span>'}</div>
        ${imgs.length > 1 ? `<div class="pdp-thumbs">${imgs.map((im, i) => `<button data-img="${i}" class="${i ? '' : 'active'}"><img src="${objURL(im.blob)}" alt=""></button>`).join('')}</div>` : ''}
      </div>
      <div class="pdp-info">
        <p class="eyebrow">${esc(p.sku || '')} · ${esc(p.categoria)}</p>
        <h1>${esc(p.nome)}</h1>
        <div class="pdp-price">${p.preco ? (p.lancamento ? `${brl(precoLanc(p, loja))} <s class="muted">${brl(p.preco)}</s>` : brl(p.preco)) : '<span class="muted">Sem preço</span>'}</div>
        ${p.lancamento ? `<div class="muted">Lançamento: as primeiras ${p.lancLimite ?? loja.lancLimite ?? 50} peças (vendidas: ${p.lancVendidos || 0}).</div>` : ''}
        ${installmentText(p) ? `<div class="muted">${installmentText(p)}</div>` : ''}
        <div class="pdp-avail">${pill(p.disponibilidade === 'esgotado' ? 'producao' : 'aprovado', dispLabel(p.disponibilidade))} ${p.status === 'ativo' ? '' : pill('criacao', 'Rascunho')}</div>
        ${p.descricao ? `<p class="pdp-desc">${esc(p.descricao).replace(/\n/g, '<br>')}</p>` : ''}
        ${p.cores.length ? `<div class="pdp-block"><h4>Cores</h4><div class="chips">${p.cores.map((c) => `<span class="chip color static"><i style="background:${colorHex(c)}"></i>${esc(c)}</span>`).join('')}</div></div>` : ''}
        ${p.tamanhos.length ? `<div class="pdp-block"><h4>Tamanhos</h4><div class="chips">${p.tamanhos.map((s) => `<span class="chip static">${s}</span>`).join('')}</div></div>` : ''}
        ${sizes.length ? `<div class="pdp-block"><h4>Tabela de medidas (cm)</h4><table class="size-table view"><thead><tr><th></th>${sizes.map((s) => `<th>${s}</th>`).join('')}</tr></thead><tbody>
          <tr><th>Largura</th>${sizes.map((s) => `<td>${esc(p.medidas[s].largura || '—')}</td>`).join('')}</tr>
          <tr><th>Comprimento</th>${sizes.map((s) => `<td>${esc(p.medidas[s].comprimento || '—')}</td>`).join('')}</tr></tbody></table></div>` : ''}
        <dl class="kv">
          <dt>Material</dt><dd>${esc(p.material || '—')}${p.gramatura ? ` · ${esc(p.gramatura)} g/m²` : ''}</dd>
          <dt>Técnica</dt><dd>${tecLabel(p.tecnica)}</dd>
          ${p.custo ? `<dt>Custo · margem</dt><dd>${brl(p.custo)} · ${pct(margemDe(p.preco, p.custo))}${p.lancamento ? ` (lançamento ${pct(margemDe(precoLanc(p, loja), p.custo))})` : ''}</dd>` : ''}
        </dl>
        ${buy ? `<a class="btn primary lg block buy" href="${esc(buy.url)}" target="_blank" rel="noopener">${p.linkCompra ? 'COMPRAR AGORA' : 'COMPRAR PELO WHATSAPP'}</a>` : '<button class="btn lg block" disabled>Cadastre o link de compra</button>'}
      </div>
    </article>
    <section class="section">
      <div class="section-head"><h2>Fluxo da peça</h2></div>
      <div class="chain">
        <a class="chain-step ${design ? 'on' : ''}" href="${design ? `#/design/${design.id}` : `#/produto/${p.id}/editar`}"><small>Arte</small><b>${esc(design?.name || 'Não vinculada')}</b></a>
        <a class="chain-step ${pf ? 'on' : ''}" href="${pf ? `#/producao/${pf.id}` : design ? `#/producao/new?design=${design.id}` : `#/produto/${p.id}/editar`}"><small>Produção</small><b>${pf ? `${tecLabel(pf.tecnica)} · ${pf.widthCm}×${pf.heightCm} cm${pf.status === 'pronto' ? ' · pronto' : ' · em revisão'}` : design ? 'Criar arquivo' : 'Não vinculado'}</b></a>
        <a class="chain-step ${p.mockupIds?.length ? 'on' : ''}" href="${p.mockupIds?.length ? `#/mockup/${p.mockupIds[0]}` : `#/mockup/new${design ? `?design=${design.id}` : ''}`}"><small>Mockups</small><b>${p.mockupIds?.length || 0} imagem(ns)</b></a>
        <a class="chain-step" href="#/catalogo"><small>Catálogo</small><b>Adicionar a um catálogo</b></a>
        <span class="chain-step ${p.linkCompra ? 'on' : ''}"><small>Venda</small><b>${p.linkCompra ? 'Link cadastrado' : 'Sem link'}</b></span>
      </div>
    </section>`;

  el.addEventListener('click', async (e) => {
    if (e.target.closest('#withArt')) {
      const btn = e.target.closest('#withArt');
      const { applyArtFlow, createProductWithArt } = await import('./apply-art.js');
      const opts = await applyArtFlow(p);
      if (!opts) return;
      btn.disabled = true;
      const prog = $('#artProgress', el);
      try {
        const id = await createProductWithArt(p, opts, (m) => { prog.textContent = `Estampando ${m}…`; });
        toast(opts.ativo ? 'Produto criado e indo para o site.' : 'Produto criado como rascunho.');
        location.hash = `#/produto/${id}`;
      } catch (err) { console.error(err); toast(err.message, 'err'); prog.textContent = ''; btn.disabled = false; }
      return;
    }
    if (e.target.closest('#copyLink')) { navigator.clipboard.writeText(p.linkCompra).then(() => toast('Link copiado.')); return; }
    if (e.target.closest('#dup')) {
      const id = await duplicateProduct(p.id);
      toast('Cópia criada. Troque o nome e a arte.');
      location.hash = `#/produto/${id}/editar`;
      return;
    }
    const b = e.target.closest('[data-img]');
    if (!b) return;
    $('#mainImg', el).src = objURL(imgs[+b.dataset.img].blob);
    $('.pdp-main', el).classList.toggle('checker', imgs[+b.dataset.img].kind === 'art');
    $$('[data-img]', el).forEach((x) => x.classList.toggle('active', x === b));
  });
}
