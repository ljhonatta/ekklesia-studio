// Criar produto com arte a partir de uma peça base: escolhe a arte das costas e/ou
// da frente, as posições e as cores; o Estúdio estampa em todas as fotos daquela
// peça (modelo vestindo), salva os mockups e cria o produto pronto para o site.
import { db, artBlob } from '../db.js';
import { $, $$, esc, toast, modal, loadImage, canvasToBlob, slugify } from '../util.js';
import { renderPhotoMockup, isBack, needsAnalysis, detectPhoto } from '../photos.js';
import { analyzeArt, dtfLayer, drawAt, inkLayer, INKS } from '../production-pack.js';
import { nextSku, uniqueSlug } from '../products.js';
import { autoPublish, getLoja, linkVenda } from '../store-publish.js';

export const PECAS = {
  'oversize-masc': 'Oversized masculina',
  'oversize-fem': 'Oversized feminina',
  'tech-fem': 'Camiseta Tech feminina',
};
const BACK_AREAS = [['total', 'Costas inteiras (justo, sem manga)'], ['principal', 'Costas central (A3)'], ['costas-superior', 'Costas superior'], ['nuca', 'Nuca']];
const FRONT_AREAS = [['peito-esquerdo', 'Peito esquerdo'], ['peito-central', 'Peito central'], ['peito-direito', 'Peito direito'], ['principal', 'Estampa grande (A3)'], ['total', 'Frente inteira (justo)']];

export const photosOf = (peca) => db.photos.filter((p) => p.peca === peca).toArray();

const lum = (rgb) => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : 128);
// A luz do estúdio deixa camisa clara amarelada/escura na foto: a cor cadastrada decide.
const CLARAS = /branc|off|bege|areia|claro|clara|água|agua|creme|nude|lil[aá]s|cinza$/i;
const ESCURAS = /pret|marinho|militar|chumbo|marrom|vinho|royal|vermelh|pink|roxo|grafite/i;
const tomDe = (photo) => (ESCURAS.test(photo.cor || '') ? 'escura' : CLARAS.test(photo.cor || '') ? 'clara' : lum(photo.shirt?.rgb) < 115 ? 'escura' : lum(photo.shirt?.rgb) > 170 ? 'clara' : 'media');

// Arte pronta para a camisa: cores originais (fundo removido) ou tinta trocada
// para ter contraste (arte preta em camisa escura vira off-white e vice-versa).
async function artFor(version, tom, auto, cache) {
  const shirtDark = tom === 'escura', shirtLight = tom === 'clara';
  let a = cache.get(version.id);
  if (!a) {
    const blob = artBlob(version);
    const img = await loadImage(blob);
    const info = await analyzeArt(blob);
    a = { img, info, out: new Map() };
    cache.set(version.id, a);
  }
  const { img, info } = a;
  let mode = 'cor';
  if (auto && !info.colorida) {
    if (info.inkDark && shirtDark) mode = 'off-white';
    else if (!info.inkDark && shirtLight) mode = 'preta';
  }
  if (!a.out.has(mode)) {
    const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    let c;
    if (mode === 'cor') c = dtfLayer(img, w, h, info);
    else { const d = drawAt(img, w, h); c = inkLayer(d.c, d.x, info, { mode: 'tinta', ink: INKS[mode].rgb }); }
    a.out.set(mode, await loadImage(await canvasToBlob(c, 'image/png')));
  }
  return { img: a.out.get(mode), mode };
}

export async function applyArtFlow(base) {
  const photos = await photosOf(base.peca);
  if (!photos.length) { toast('Esta peça ainda não tem fotos de modelo. Importe em Mockups → Peças reais.', 'err'); return; }
  const designs = await db.designs.orderBy('updatedAt').reverse().toArray();
  if (!designs.length) { toast('Envie uma arte primeiro (Criar Arte ou Gerador IA).', 'err'); return; }
  const cores = [...new Set(photos.map((p) => p.cor))];
  const count = (c, back) => photos.filter((p) => p.cor === c && isBack(p) === back).length;
  const dOpt = (sel) => `<option value="">— nenhuma —</option>${designs.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}`;
  const aOpt = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  let read = null;
  const ok = await modal({
    title: `Criar produto com arte · ${PECAS[base.peca] || base.nome}`, wide: true,
    body: `<div class="apply-art">
      <div class="form-grid two">
        <label class="field"><span>Arte das costas</span><select id="aBack">${dOpt(designs[0]?.id)}</select></label>
        <label class="field"><span>Posição nas costas</span><select id="pBack">${aOpt(BACK_AREAS)}</select></label>
        <label class="field"><span>Arte da frente</span><select id="aFront">${dOpt(null)}</select></label>
        <label class="field"><span>Posição na frente</span><select id="pFront">${aOpt(FRONT_AREAS)}</select></label>
      </div>
      <div class="field"><span>Cores (fotos de costas · frente)</span><div class="chips" id="cores">${cores.map((c) => `<label class="chip"><input type="checkbox" value="${esc(c)}" checked> ${esc(c)} <small>${count(c, true)}·${count(c, false)}</small></label>`).join('')}</div></div>
      <label class="toggle small"><input type="checkbox" id="auto" checked><span>Cor da arte automática (arte preta vira off-white em camisa escura; arte clara vira preta em camisa clara; artes coloridas ficam como estão)</span></label>
      <div class="form-grid two">
        <label class="field"><span>Nome do produto</span><input id="nome" placeholder="Ex.: Oversized Maranata"></label>
        <label class="field"><span>Preço</span><input disabled value="${base.precoLancamento ? `R$ ${String(base.precoLancamento).replace('.', ',')} no lançamento · ` : ''}R$ ${String(base.preco).replace('.', ',')}"></label>
      </div>
      <label class="toggle"><input type="checkbox" id="ativo" checked><span>Já colocar à venda no site (Ativo)</span></label>
      <p class="hint" id="aInfo"></p>
    </div>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Gerar mockups e criar produto', value: true, kind: 'primary' }],
    onOpen: (m) => {
      const upd = () => {
        const back = +$('#aBack', m).value, front = +$('#aFront', m).value;
        const sel = $$('#cores input:checked', m).map((i) => i.value);
        const n = photos.filter((p) => sel.includes(p.cor) && (isBack(p) ? back : front)).length;
        $('#aInfo', m).textContent = n ? `Vai gerar ${n} mockup(s).` : 'Escolha ao menos uma arte e uma cor com foto daquele lado.';
        const nm = $('#nome', m);
        if (!nm.dataset.touched) nm.value = `${(PECAS[base.peca] || 'Oversized').split(' ')[0]} ${designs.find((d) => d.id === (back || front))?.name || ''}`.trim();
      };
      $('#nome', m).addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
      m.addEventListener('change', upd);
      upd();
      read = () => ({ back: +$('#aBack', m).value || null, front: +$('#aFront', m).value || null, pBack: $('#pBack', m).value, pFront: $('#pFront', m).value, cores: $$('#cores input:checked', m).map((i) => i.value), auto: $('#auto', m).checked, nome: $('#nome', m).value.trim(), ativo: $('#ativo', m).checked });
    },
  });
  return ok ? read() : null;
}

/**
 * Gera os mockups e cria o produto. opts: { back, front, pBack, pFront, cores, auto, nome, ativo }
 * Retorna o id do produto.
 */
export async function createProductWithArt(base, opts, onProgress = () => {}) {
  const photos = (await photosOf(base.peca)).filter((p) => opts.cores.includes(p.cor) && (isBack(p) ? opts.back : opts.front));
  if (!photos.length) throw new Error('Nenhuma foto com arte para gerar.');
  const vBack = opts.back ? await db.versions.get((await db.designs.get(opts.back)).currentVersionId) : null;
  const vFront = opts.front ? await db.versions.get((await db.designs.get(opts.front)).currentVersionId) : null;
  // lado da arte principal primeiro (capa), cor por cor
  const side = (p) => (isBack(p) === !!opts.back ? 0 : 1);
  photos.sort((a, b) => side(a) - side(b) || opts.cores.indexOf(a.cor) - opts.cores.indexOf(b.cor));
  const cache = new Map();
  const mockupIds = [];
  let i = 0;
  for (const photo of photos) {
    onProgress(`${++i}/${photos.length} · ${photo.cor} (${isBack(photo) ? 'costas' : 'frente'})`);
    if (needsAnalysis(photo)) await detectPhoto(photo);
    const back = isBack(photo);
    const v = back ? vBack : vFront;
    const area = back ? opts.pBack : opts.pFront;
    const { img: art, mode } = await artFor(v, tomDe(photo), opts.auto, cache);
    const pImg = await loadImage(photo.image);
    const mask = photo.shirt?.ok ? await loadImage(photo.shirt.mask) : null;
    const torsoMask = photo.shirt?.torsoMask ? await loadImage(photo.shirt.torsoMask) : null;
    const scale = area === 'total' ? 0.98 : area === 'principal' ? 1.15 : 1;
    const layer = { area, x: 0, y: 0, scale, rot: 0, opacity: 1, blend: 'normal', fabric: 0.6, warp: 0.5, tint: null, clip: true, yaw: null };
    const c = document.createElement('canvas');
    c.width = photo.w; c.height = photo.h;
    renderPhotoMockup(c.getContext('2d'), { photo, img: pImg, mask, torsoMask, layers: [{ ...layer, img: art }] }, { scale: 1 });
    const t = document.createElement('canvas');
    t.width = 480; t.height = Math.round(480 * (photo.h / photo.w));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    const d = await db.designs.get(v.designId);
    const now = Date.now();
    mockupIds.push(await db.mockups.add({
      name: `${d.name} · ${PECAS[base.peca] || 'Camiseta'} ${photo.cor} (${back ? 'costas' : 'frente'})`, source: 'photo', photoId: photo.id, photoName: `${photo.cor}`,
      designId: v.designId, garment: 'camiseta', view: back ? 'costas' : 'frente', color: photo.cor, bg: null, inkMode: mode,
      layers: [{ ...layer, versionId: v.id }], render: await canvasToBlob(c, 'image/jpeg', 0.9), thumb: await canvasToBlob(t, 'image/jpeg', 0.85), createdAt: now, updatedAt: now,
    }));
    await new Promise((r) => setTimeout(r));
  }
  onProgress('Criando o produto…');
  const { id: _, createdAt, updatedAt, ...rest } = base;
  const nome = opts.nome || `${PECAS[base.peca]} ${(await db.designs.get(opts.back || opts.front)).name}`;
  const now = Date.now();
  const p = {
    ...structuredClone({ ...rest, fotos: [] }), nome, sku: await nextSku(), slug: await uniqueSlug(slugify(nome)),
    status: opts.ativo ? 'ativo' : 'rascunho', base: false, baseId: base.id, designId: opts.back || opts.front, productionFileId: null,
    mockupIds, cores: opts.cores, lancVendidos: 0, createdAt: now, updatedAt: now,
  };
  p.linkCompra = opts.ativo ? linkVenda(p, await getLoja()) : '';
  const id = await db.products.add(p);
  if (opts.ativo) autoPublish();
  return id;
}

// ---------- caminho direto: da arte para o(s) produto(s) ----------
const POSICOES = [
  ['costas:total', 'Costas inteiras (justo, sem manga)'], ['costas:principal', 'Costas central (A3)'], ['costas:costas-superior', 'Costas superior'],
  ['frente:peito-esquerdo', 'Peito esquerdo (logo)'], ['frente:peito-central', 'Peito central'], ['frente:principal', 'Frente grande (A3)'], ['frente:total', 'Frente inteira (justo)'],
];
const NOME_PECA = { 'oversize-masc': 'Oversized', 'oversize-fem': 'Oversized Feminina', 'tech-fem': 'Tech Feminina' };
const titulo = (s) => s.toLowerCase().replace(/(^|[\s·\-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** "Lançar como produto" a partir de uma arte: um produto por modelo marcado. Retorna os ids. */
export async function launchFlow(designId, onProgress = () => {}) {
  const design = await db.designs.get(designId);
  const bases = (await db.products.toArray()).filter((p) => p.base && p.peca);
  if (!bases.length) { toast('Nenhum modelo base com fotos ainda. Sincronize a nuvem.', 'err'); return []; }
  const allPhotos = await db.photos.toArray();
  const designs = (await db.designs.orderBy('updatedAt').reverse().toArray()).filter((d) => d.id !== designId);
  const v = await db.versions.get(design.currentVersionId);
  const info = await analyzeArt(artBlob(v));
  const wide = v.width / v.height > 1.6; // logo deitado: peito por padrão
  let read = null;
  const ok = await modal({
    title: 'Lançar como produto', wide: true,
    body: `<div class="apply-art">
      <div class="launch-head"><span class="thumb checker"><img src="${URL.createObjectURL(v.thumb)}" alt=""></span>
        <div><b>${esc(design.name)}</b><small class="muted">${info.colorida ? 'Arte colorida (vai em cores originais)' : `Tinta ${info.inkDark ? 'escura' : 'clara'}${info.accents.length ? ` + ${info.accents.map((a) => a.name).join(', ')}` : ''}: troca sozinha conforme a cor da camisa`}</small></div></div>
      <label class="field"><span>Nome do produto</span><input id="lNome" value="${esc(titulo(design.name))}"></label>
      <div class="field"><span>Modelos</span><div class="chips" id="lBases">${bases.map((b) => {
        const n = allPhotos.filter((p) => p.peca === b.peca).length;
        return `<label class="chip"><input type="checkbox" value="${b.id}" ${n ? 'checked' : 'disabled'}> ${esc(NOME_PECA[b.peca] || b.nome)} <small>${n} fotos · R$ ${String(b.precoLancamento || b.preco).replace('.', ',')}</small></label>`;
      }).join('')}</div></div>
      <div class="form-grid two">
        <label class="field"><span>Onde vai esta arte</span><select id="lPos">${POSICOES.map(([k, l]) => `<option value="${k}" ${k === (wide ? 'frente:peito-esquerdo' : 'costas:total') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Logo no outro lado (opcional)</span><select id="lExtra"><option value="">— nenhum —</option>${designs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
      </div>
      <label class="toggle small"><input type="checkbox" id="lAuto" checked><span>Cor da arte automática pela cor da camisa</span></label>
      <label class="toggle"><input type="checkbox" id="lAtivo" checked><span>Já colocar à venda no site (Ativo)</span></label>
      <p class="hint">Um produto por modelo, com todas as cores e fotos daquele modelo. O logo do outro lado vai no peito esquerdo (arte nas costas) ou nas costas superiores (arte na frente).</p>
    </div>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Lançar', value: true, kind: 'primary' }],
    onOpen: (m) => {
      read = () => ({
        nome: $('#lNome', m).value.trim() || titulo(design.name), bases: $$('#lBases input:checked', m).map((i) => +i.value),
        pos: $('#lPos', m).value, extra: +$('#lExtra', m).value || null, auto: $('#lAuto', m).checked, ativo: $('#lAtivo', m).checked,
      });
    },
  });
  if (!ok) return [];
  const o = read();
  if (!o.bases.length) { toast('Marque ao menos um modelo.', 'err'); return []; }
  const [lado, area] = o.pos.split(':');
  const ids = [];
  for (const bid of o.bases) {
    const base = bases.find((b) => b.id === bid);
    const cores = [...new Set(allPhotos.filter((p) => p.peca === base.peca).map((p) => p.cor))];
    const opts = lado === 'costas'
      ? { back: designId, pBack: area, front: o.extra, pFront: 'peito-esquerdo' }
      : { front: designId, pFront: area, back: o.extra, pBack: 'costas-superior' };
    const nome = `${NOME_PECA[base.peca] || 'Camiseta'} ${o.nome}`;
    ids.push(await createProductWithArt(base, { ...opts, cores, auto: o.auto, nome, ativo: o.ativo }, (msg) => onProgress(`${NOME_PECA[base.peca]}: ${msg}`)));
  }
  return ids;
}
