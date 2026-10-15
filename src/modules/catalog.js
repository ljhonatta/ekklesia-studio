import { db, getSetting } from '../db.js';
import { $, esc, objURL, toast, download, slugify, confirmDialog, fmtDate } from '../util.js';
import { brl, buyLink, DEFAULT_BRAND } from '../data.js';
import { productImages } from '../products.js';
import { buildCatalogPDF } from '../pdf-catalog.js';
import { pageHead, empty, ICONS } from '../ui.js';

// ---------- lista ----------
export async function list(el) {
  const cats = await db.catalogs.reverse().sortBy('updatedAt');
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Catálogo',
      title: 'Catálogos',
      lede: 'Escolha as peças e o catálogo é montado: capa, apresentação da marca, ficha de cada peça, botões de compra e QR Codes.',
      actions: `<button class="btn primary" id="new">${ICONS.plus}<span>Novo catálogo</span></button>`,
    })}
    ${cats.length ? `<div class="cat-list">${cats.map((c) => `
      <a class="cat-row" href="#/catalogo/${c.id}">
        <span class="cat-cover"><b>${esc(c.title || 'Sem título')}</b></span>
        <span><b>${esc(c.title || 'Sem título')}</b><small>${c.productIds?.length || 0} peças · atualizado em ${fmtDate(c.updatedAt)}</small></span>
      </a>`).join('')}</div>`
      : empty('Nenhum catálogo ainda', 'Crie o primeiro com os produtos cadastrados.', `<button class="btn primary" id="new2">${ICONS.plus}<span>Novo catálogo</span></button>`)}`;
  el.addEventListener('click', async (e) => {
    if (!e.target.closest('#new, #new2')) return;
    const products = await db.products.toArray();
    const now = Date.now();
    const id = await db.catalogs.add({
      title: `Coleção ${new Date().getFullYear()}`, subtitle: '',
      productIds: products.filter((p) => p.status === 'ativo').map((p) => p.id),
      createdAt: now, updatedAt: now,
    });
    location.hash = `#/catalogo/${id}`;
  });
}

// ---------- editor ----------
export async function editor(el, [idStr]) {
  const id = +idStr;
  let cat = await db.catalogs.get(id);
  if (!cat) { el.innerHTML = empty('Catálogo não encontrado', '', '<a class="btn" href="#/catalogo">Voltar</a>'); return; }
  const brand = { ...DEFAULT_BRAND, ...(await getSetting('brand', {})) };
  const products = await db.products.orderBy('id').reverse().toArray();
  const byId = new Map(products.map((p) => [p.id, p]));
  const covers = new Map(await Promise.all(products.map(async (p) => [p.id, (await productImages(p))[0]])));
  cat.productIds = (cat.productIds || []).filter((x) => byId.has(x));
  let pdfURL = null, timer = 0, building = 0;

  el.innerHTML = `
    <a class="back" href="#/catalogo">${ICONS.back}<span>Catálogos</span></a>
    <div class="cat-editor">
      <section class="cat-side">
        <div class="panel form-stack">
          <label class="field"><span>Título do catálogo</span><input id="title" value="${esc(cat.title)}"></label>
          <label class="field"><span>Frase da capa</span><input id="subtitle" value="${esc(cat.subtitle)}" placeholder="${esc(brand.tagline || 'Usa a frase institucional da marca')}"></label>
        </div>
        <div class="panel">
          <div class="section-head"><h3>Peças no catálogo</h3><span class="muted" id="count"></span></div>
          <ol class="cat-items" id="items"></ol>
          <h4 class="sub">Adicionar</h4>
          <div class="cat-add" id="add"></div>
        </div>
        <div class="panel" id="warnBox" hidden><h3>Atenção</h3><ul class="checks" id="warns"></ul></div>
      </section>
      <section class="cat-preview">
        <div class="cat-toolbar">
          <span class="muted" id="status">Gerando prévia…</span>
          <div class="actions-row tight">
            <a class="btn ghost" id="open" target="_blank" rel="noopener">Abrir em nova aba</a>
            <button class="btn primary" id="pdf">${ICONS.download}<span>Exportar PDF</span></button>
          </div>
        </div>
        <iframe id="frame" title="Prévia do catálogo em PDF"></iframe>
        <p class="hint only-mobile">No celular, toque em “Abrir em nova aba” para ver o PDF.</p>
      </section>
    </div>
    <section class="danger-zone"><button class="btn danger ghost sm" id="del">Excluir catálogo</button></section>`;

  const thumb = (p) => {
    const c = covers.get(p.id);
    return c ? `<img src="${objURL(c.blob)}" alt="" class="${c.kind === 'art' ? 'checker contain' : ''}">` : '<span class="noimg"></span>';
  };

  function drawLists() {
    const sel = cat.productIds.map((x) => byId.get(x));
    $('#count', el).textContent = `${sel.length}`;
    $('#items', el).innerHTML = sel.length ? sel.map((p, i) => `
      <li>${thumb(p)}<span><b>${esc(p.nome)}</b><small>${esc(p.sku || '')} · ${p.preco ? brl(p.preco) : 'sem preço'}</small></span>
        <div class="row-actions">
          <button class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Subir">↑</button>
          <button class="icon-btn" data-down="${i}" ${i < sel.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button>
          <button class="icon-btn" data-rm="${p.id}" aria-label="Remover">×</button>
        </div></li>`).join('') : '<li class="muted">Nenhuma peça. Adicione abaixo.</li>';
    const rest = products.filter((p) => !cat.productIds.includes(p.id));
    $('#add', el).innerHTML = rest.length ? rest.map((p) => `<button class="add-row" data-add="${p.id}">${thumb(p)}<span>${esc(p.nome)}</span>${ICONS.plus}</button>`).join('')
      : products.length ? '<p class="hint">Todas as peças já estão no catálogo.</p>' : '<p class="hint">Nenhum produto cadastrado. <a class="link" href="#/produto/new">Cadastrar produto</a></p>';
    const warns = [];
    for (const p of sel) {
      if (!buyLink(p, brand)) warns.push(`<b>${esc(p.nome)}</b>: sem link de compra e sem WhatsApp da marca. Ficará sem botão.`);
      else if (!p.linkCompra) warns.push(`<b>${esc(p.nome)}</b>: sem link de compra. O botão leva ao WhatsApp.`);
      if (!covers.get(p.id)) warns.push(`<b>${esc(p.nome)}</b>: sem imagem.`);
      if (!p.preco) warns.push(`<b>${esc(p.nome)}</b>: sem preço.`);
    }
    if (!brand.apresentacao) warns.push('Apresentação da marca vazia. <a class="link" href="#/config">Preencher em Configurações</a>.');
    if (!brand.site && !brand.instagram && !brand.whatsapp) warns.push('Site, Instagram e WhatsApp não cadastrados: a contracapa ficará sem botões.');
    $('#warnBox', el).hidden = !warns.length;
    $('#warns', el).innerHTML = warns.map((w) => `<li class="warn">${w}</li>`).join('');
  }

  async function save(patch = {}) {
    cat = { ...cat, ...patch, updatedAt: Date.now() };
    await db.catalogs.put(cat);
    drawLists();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 500);
  }
  async function rebuild() {
    const my = ++building;
    $('#status', el).textContent = 'Gerando prévia…';
    try {
      const blob = await buildCatalogPDF(cat, brand);
      if (my !== building) return;
      if (pdfURL) URL.revokeObjectURL(pdfURL);
      pdfURL = URL.createObjectURL(blob);
      $('#frame', el).src = pdfURL;
      $('#open', el).href = pdfURL;
      $('#status', el).textContent = `${cat.productIds.length + 3} páginas · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
    } catch (err) {
      console.error(err);
      if (my === building) $('#status', el).textContent = err.message || 'Falha ao gerar a prévia.';
    }
  }

  $('#title', el).addEventListener('input', (e) => save({ title: e.target.value }));
  $('#subtitle', el).addEventListener('input', (e) => save({ subtitle: e.target.value }));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ids = [...cat.productIds];
    if (b.dataset.add) save({ productIds: [...ids, +b.dataset.add] });
    else if (b.dataset.rm) save({ productIds: ids.filter((x) => x !== +b.dataset.rm) });
    else if (b.dataset.up) { const i = +b.dataset.up; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; save({ productIds: ids }); }
    else if (b.dataset.down) { const i = +b.dataset.down; [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; save({ productIds: ids }); }
    else if (b.id === 'pdf') {
      b.disabled = true;
      try {
        const blob = await buildCatalogPDF(cat, brand);
        download(blob, `${slugify(brand.brandName || 'ekklesia')}-${slugify(cat.title || 'catalogo')}.pdf`);
      } catch (err) { console.error(err); toast(err.message || 'Falha ao exportar.', 'err'); }
      b.disabled = false;
    } else if (b.id === 'del') {
      if (!await confirmDialog('Excluir catálogo', `Excluir <b>${esc(cat.title)}</b>? Os produtos continuam cadastrados.`, 'Excluir', true)) return;
      await db.catalogs.delete(id);
      location.hash = '#/catalogo';
    }
  });

  drawLists();
  rebuild();
  return () => { clearTimeout(timer); building++; if (pdfURL) URL.revokeObjectURL(pdfURL); };
}
