import { db, getSetting } from '../db.js';
import { $, $$, esc, objURL, toast, confirmDialog, slugify } from '../util.js';
import { CATEGORIAS, SIZES, TECNICAS, DISPONIBILIDADE, PRODUCT_STATUS, brl, parsePrice, installmentText, tecLabel, dispLabel, buyLink, DEFAULT_BRAND } from '../data.js';
import { COLORS } from '../garments.js';
import { productImages, nextSku, uniqueSlug } from '../products.js';
import { pageHead, empty, ICONS, pill } from '../ui.js';

const colorHex = (name) => COLORS.find((c) => c.label.toLowerCase() === String(name).toLowerCase())?.hex || '#777';
const statusPill = (p) => (p.status === 'ativo' ? pill('aprovado', 'Ativo') : pill('criacao', 'Rascunho'));

// ---------- lista ----------
export async function list(el) {
  const all = await db.products.orderBy('id').reverse().toArray();
  const covers = new Map(await Promise.all(all.map(async (p) => [p.id, (await productImages(p))[0]])));
  let filter = 'todos';
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Gerenciamento',
      title: 'Produtos',
      lede: 'Cada produto liga a arte, o arquivo de produção, os mockups e o link de venda.',
      actions: `<a class="btn primary" href="#/produto/new">${ICONS.plus}<span>Novo produto</span></a>`,
    })}
    <div class="toolbar"><div class="chips">
      ${[['todos', 'Todos'], ['ativo', 'Ativos'], ['rascunho', 'Rascunhos']].map(([id, l]) => `<button class="chip" data-f="${id}">${l} <b>${id === 'todos' ? all.length : all.filter((p) => p.status === id).length}</b></button>`).join('')}
    </div></div>
    <div id="list"></div>`;
  const draw = () => {
    $$('[data-f]', el).forEach((b) => b.classList.toggle('active', b.dataset.f === filter));
    const items = all.filter((p) => filter === 'todos' || p.status === filter);
    $('#list', el).innerHTML = items.length ? `<div class="grid">${items.map((p) => {
      const c = covers.get(p.id);
      return `<a class="card mockup-card" href="#/produto/${p.id}">
        <div class="thumb ${c?.kind === 'art' ? 'checker' : ''}">${c ? `<img src="${objURL(c.blob)}" alt="" loading="lazy" class="${c.kind === 'art' ? 'contain' : ''}">` : ''}</div>
        <div class="card-body"><div class="card-title">${esc(p.nome)}</div>
          <div class="card-meta"><span>${esc(p.sku || '')} · ${p.preco ? brl(p.preco) : 'sem preço'}</span>${statusPill(p)}</div></div></a>`;
    }).join('')}</div>` : all.length ? empty('Nada por aqui', 'Nenhum produto com esse filtro.')
      : empty('Nenhum produto ainda', 'Cadastre a primeira peça da coleção.', `<a class="btn primary" href="#/produto/new">${ICONS.plus}<span>Novo produto</span></a>`);
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
  draw();
}

// ---------- formulário (novo / editar) ----------
export async function edit(el, [idStr], query) {
  const isNew = idStr === 'new';
  let p = isNew ? {
    nome: '', sku: await nextSku(), slug: '', categoria: CATEGORIAS[0], descricao: '', material: '100% algodão', gramatura: '',
    tecnica: 'dtf', cores: [], tamanhos: ['P', 'M', 'G', 'GG'], medidas: {}, preco: null, parcelas: 3, semJuros: true,
    disponibilidade: 'disponivel', status: 'rascunho', linkCompra: '', designId: +query.design || null, productionFileId: null, mockupIds: [],
  } : await db.products.get(+idStr);
  if (!p) { el.innerHTML = empty('Produto não encontrado', '', '<a class="btn" href="#/produtos">Voltar</a>'); return; }
  p = structuredClone(p);
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
        <label class="field"><span>Descrição</span><textarea data-f="descricao" rows="4" placeholder="A ideia por trás da peça, o versículo, o caimento...">${esc(p.descricao)}</textarea></label>
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
        ${input('linkCompra', 'Link de compra', 'type="url" placeholder="https://loja.../produto"')}
        <p class="hint">Sem link, o botão do catálogo leva ao WhatsApp da marca (definido em Configurações).</p>
      </section>

      <section class="panel">
        <h3>Arte, produção e mockups</h3>
        <div class="form-grid two">
          <label class="field"><span>Design</span><select data-f="designId"><option value="">— nenhum —</option>${designs.map((d) => opt(d.id, d.name, p.designId)).join('')}</select></label>
          <label class="field"><span>Arquivo de produção</span><select data-f="productionFileId" id="pfSel"></select></label>
        </div>
        <div class="field"><span>Mockups (clique na ordem: o primeiro é a capa)</span><div class="mock-pick" id="mocks"></div></div>
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
    else if (f === 'preco') p.preco = parsePrice(t.value);
    else if (f === 'parcelas') p.parcelas = +t.value;
    else if (f === 'designId' || f === 'productionFileId') p[f] = t.value ? +t.value : null;
    else p[f] = t.value;
    if (f === 'slug') slugTouched = true;
    if (f === 'nome' && !slugTouched) $('[data-f="slug"]', el).value = p.slug = slugify(t.value);
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
    else if (b.dataset.mock) { const id = +b.dataset.mock; p.mockupIds = p.mockupIds.includes(id) ? p.mockupIds.filter((x) => x !== id) : [...p.mockupIds, id]; drawDynamic(); }
    else if (b.id === 'del') {
      if (!await confirmDialog('Excluir produto', `Excluir <b>${esc(p.nome)}</b>? Arte, mockups e arquivo de produção continuam salvos.`, 'Excluir', true)) return;
      await db.products.delete(p.id);
      const cats = await db.catalogs.toArray();
      for (const c of cats) if (c.productIds?.includes(p.id)) await db.catalogs.update(c.id, { productIds: c.productIds.filter((x) => x !== p.id) });
      toast('Produto excluído.');
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
    p.updatedAt = Date.now();
    p.createdAt ||= p.updatedAt;
    try {
      const id = await db.products.put(p);
      toast('Produto salvo.');
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
  const imgs = await productImages(p);
  const design = p.designId ? await db.designs.get(p.designId) : null;
  const pf = p.productionFileId ? await db.productionFiles.get(p.productionFileId) : null;
  const buy = buyLink(p, brand);
  const sizes = Object.keys(p.medidas || {});
  const missing = [!p.preco && 'preço', !imgs.length && 'imagem', !p.linkCompra && 'link de compra', !pf && 'arquivo de produção'].filter(Boolean);

  el.innerHTML = `
    <div class="product-top">
      <a class="back" href="#/produtos">${ICONS.back}<span>Produtos</span></a>
      <div class="actions-row tight"><a class="btn" href="#/produto/${p.id}/editar">Editar ficha</a></div>
    </div>
    ${missing.length ? `<p class="banner warn">Falta preencher: ${missing.join(', ')}.</p>` : ''}
    <article class="pdp">
      <div class="pdp-gallery">
        <div class="pdp-main ${imgs[0]?.kind === 'art' ? 'checker' : ''}">${imgs[0] ? `<img id="mainImg" src="${objURL(imgs[0].blob)}" alt="${esc(p.nome)}">` : '<span class="muted">Sem imagem</span>'}</div>
        ${imgs.length > 1 ? `<div class="pdp-thumbs">${imgs.map((im, i) => `<button data-img="${i}" class="${i ? '' : 'active'}"><img src="${objURL(im.blob)}" alt=""></button>`).join('')}</div>` : ''}
      </div>
      <div class="pdp-info">
        <p class="eyebrow">${esc(p.sku || '')} · ${esc(p.categoria)}</p>
        <h1>${esc(p.nome)}</h1>
        <div class="pdp-price">${p.preco ? brl(p.preco) : '<span class="muted">Sem preço</span>'}</div>
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

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-img]');
    if (!b) return;
    $('#mainImg', el).src = objURL(imgs[+b.dataset.img].blob);
    $('.pdp-main', el).classList.toggle('checker', imgs[+b.dataset.img].kind === 'art');
    $$('[data-img]', el).forEach((x) => x.classList.toggle('active', x === b));
  });
}
