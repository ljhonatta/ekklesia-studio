// Gerador IA: ideia + referências → imagens (GPT Image). O resultado vira arte
// em Meus Designs (nunca sobrescreve nada) ou referência para a próxima rodada.
import { db, createDesign, artBlob } from '../db.js';
import { $, $$, esc, objURL, toast, download, prepareArtFile } from '../util.js';
import { pageHead, ICONS, pickDesign } from '../ui.js';
import { getKey, getIA, generateImages, improvePrompt } from '../openai.js';

const MODES = [
  { id: 'arte', label: 'Arte para estampa', hint: 'Arte isolada, fundo transparente, pronta para produção.',
    wrap: (p) => `Arte de estampa para camiseta streetwear, isolada e centralizada, sem camiseta e sem pessoa, fundo transparente, contornos limpos e alta definição para impressão DTF/serigrafia. ${p}` },
  { id: 'mockup', label: 'Foto realista', hint: 'Modelo ou peça fotografada, com cara de foto de verdade.',
    wrap: (p) => `Fotografia realista de moda (e-commerce/campanha), luz natural, tecido com textura e dobras reais, estampa aplicada com caimento natural. ${p}` },
  { id: 'livre', label: 'Livre', hint: 'Post, capa, campanha: sem regras.', wrap: (p) => p },
];
const SIZES = [['1024x1024', 'Quadrado'], ['1024x1536', 'Retrato'], ['1536x1024', 'Paisagem']];

// fica entre visitas à tela (só nesta sessão)
const S = { mode: 'arte', idea: '', before: null, refs: [], results: [], size: '1024x1024', quality: 'high', n: 2, transparent: true };

export async function render(el) {
  const key = await getKey();
  const ia = await getIA();
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Criar com IA', title: 'Gerador IA', lede: `Escreva a ideia, junte referências e a IA cria as imagens${ia.imageModel ? ` (${esc(ia.imageModel)})` : ''}. O que ficar bom vai para Meus Designs.` })}
    ${key ? '' : `<p class="banner warn">Falta a chave da OpenAI. <a class="link" href="#/config">Configurações → Inteligência artificial</a></p>`}
    <div class="ai-grid">
      <section class="panel form-stack">
        <div class="seg seg-full" id="mode">${MODES.map((m) => `<button data-mode="${m.id}">${m.label}</button>`).join('')}</div>
        <p class="hint" id="modeHint"></p>
        <label class="field"><span>Ideia</span><textarea id="idea" rows="6" placeholder="Ex.: leão de Judá com coroa de espinhos, traço de gravura antiga, frase &quot;O LEÃO DA TRIBO DE JUDÁ VENCEU&quot; em arco, preto e dourado"></textarea></label>
        <div class="actions-row"><button class="btn" id="improve">Melhorar ideia com GPT</button><button class="link" id="undoIdea" hidden>Voltar ao meu texto</button></div>
        <div class="field"><span>Referências (até 10): estilo, pose, peça, logo…</span>
          <div class="ref-row" id="refs"></div>
          <div class="actions-row">
            <label class="btn sm">${ICONS.upload}<span>Enviar imagens</span><input type="file" id="refFile" accept="image/*" multiple hidden></label>
            <button class="btn sm" id="refDesign">De Meus Designs</button>
          </div>
        </div>
        <div class="form-grid three">
          <label class="field"><span>Formato</span><select id="size">${SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="field"><span>Qualidade</span><select id="quality"><option value="high">Alta</option><option value="medium">Média</option><option value="low">Rascunho (rápido)</option></select></label>
          <label class="field"><span>Quantas</span><select id="n">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join('')}</select></label>
        </div>
        <label class="toggle small" id="transpBox"><input type="checkbox" id="transparent"><span>Fundo transparente</span></label>
        <button class="btn primary lg" id="go">Gerar imagens</button>
        <p class="hint">Cada imagem consome crédito da conta OpenAI (qualidade alta custa mais). Leva de 20 s a 1 min.</p>
      </section>
      <section class="ai-results" id="results"></section>
    </div>`;

  const sync = () => {
    $$('[data-mode]', el).forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));
    $('#modeHint', el).textContent = MODES.find((m) => m.id === S.mode).hint;
    $('#transpBox', el).hidden = S.mode !== 'arte';
    $('#undoIdea', el).hidden = S.before == null;
  };
  const drawRefs = () => {
    $('#refs', el).innerHTML = S.refs.map((b, i) => `<span class="ref"><img src="${objURL(b)}" alt=""><b>${i + 1}</b><button data-rmref="${i}" aria-label="Remover">✕</button></span>`).join('') || '<span class="muted">Nenhuma. Sem referência, a IA cria só pela ideia.</span>';
  };
  const drawResults = (busy = 0) => {
    $('#results', el).innerHTML = (busy ? `<div class="ai-busy">${Array.from({ length: busy }, () => '<div class="ai-card loading"><span>Gerando…</span></div>').join('')}</div>` : '')
      + (S.results.length ? `<div class="ai-cards">${S.results.map((r, i) => `
        <figure class="ai-card ${r.transparent ? 'checker' : ''}"><img src="${objURL(r.blob)}" alt="">
          <figcaption>
            <button class="btn sm primary" data-save="${i}" ${r.designId ? 'disabled' : ''}>${r.designId ? 'Salvo' : 'Salvar em Meus Designs'}</button>
            <button class="btn sm" data-mock="${i}">Fazer mockup</button>
            <button class="btn sm ghost" data-ref="${i}">Usar como referência</button>
            <button class="btn sm ghost" data-dl="${i}">Baixar</button>
          </figcaption></figure>`).join('')}</div>`
        : busy ? '' : '<div class="empty-ai"><b>As imagens aparecem aqui.</b><span class="muted">Dica: diga estilo, cores, texto exato entre aspas e onde vai a estampa.</span></div>');
  };

  $('#idea', el).value = S.idea;
  $('#size', el).value = S.size; $('#quality', el).value = S.quality; $('#n', el).value = S.n; $('#transparent', el).checked = S.transparent;
  sync(); drawRefs(); drawResults();

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'idea') S.idea = t.value;
    if (t.id === 'size') S.size = t.value;
    if (t.id === 'quality') S.quality = t.value;
    if (t.id === 'n') S.n = +t.value;
    if (t.id === 'transparent') S.transparent = t.checked;
  });
  $('#refFile', el).addEventListener('change', (e) => {
    S.refs.push(...[...e.target.files].filter((f) => f.type.startsWith('image/')));
    S.refs = S.refs.slice(0, 10);
    e.target.value = '';
    drawRefs();
  });

  async function saveResult(i) {
    const r = S.results[i];
    if (r.designId) return r.designId;
    const name = (S.idea.split(/[.,\n]/)[0] || 'Arte IA').trim().slice(0, 40).toUpperCase() || 'ARTE IA';
    const file = new File([r.blob], `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ia.png`, { type: 'image/png' });
    r.designId = await createDesign(name, await prepareArtFile(file));
    await db.versions.where('designId').equals(r.designId).modify({ origin: 'ia', note: r.prompt.slice(0, 500) });
    return r.designId;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) { S.mode = b.dataset.mode; S.transparent = S.mode === 'arte'; $('#transparent', el).checked = S.transparent; sync(); }
    else if (b.dataset.rmref) { S.refs.splice(+b.dataset.rmref, 1); drawRefs(); }
    else if (b.id === 'refDesign') {
      const id = await pickDesign('Usar como referência');
      if (!id) return;
      const d = await db.designs.get(id);
      const v = await db.versions.get(d.currentVersionId);
      if (v) { S.refs.push(artBlob(v)); S.refs = S.refs.slice(0, 10); drawRefs(); }
    }
    else if (b.id === 'undoIdea') { S.idea = S.before; S.before = null; $('#idea', el).value = S.idea; sync(); }
    else if (b.id === 'improve') {
      if (!S.idea.trim()) { toast('Escreva a ideia primeiro.', 'err'); return; }
      b.disabled = true; b.textContent = 'Pensando…';
      try {
        const better = await improvePrompt(S.idea, { mode: S.mode, refs: S.refs.length });
        S.before = S.idea; S.idea = better; $('#idea', el).value = better; sync();
      } catch (err) { toast(err.message, 'err'); }
      b.disabled = false; b.textContent = 'Melhorar ideia com GPT';
    }
    else if (b.id === 'go') {
      if (!S.idea.trim()) { toast('Escreva a ideia.', 'err'); $('#idea', el).focus(); return; }
      b.disabled = true;
      drawResults(S.n);
      const prompt = MODES.find((m) => m.id === S.mode).wrap(S.idea.trim())
        + (S.refs.length ? ` Use as ${S.refs.length} imagem(ns) anexada(s) como referência (na ordem em que foram enviadas).` : '');
      const transparent = S.mode === 'arte' && S.transparent;
      try {
        const blobs = await generateImages({ prompt, refs: S.refs, size: S.size, quality: S.quality, n: S.n, transparent });
        S.results.unshift(...blobs.map((blob) => ({ blob, prompt, transparent })));
        S.results = S.results.slice(0, 24);
        toast(`${blobs.length} imagem(ns) pronta(s).`);
      } catch (err) { toast(err.message, 'err'); }
      if (el.isConnected) drawResults();
      b.disabled = false;
    }
    else if (b.dataset.save) {
      b.disabled = true;
      try { await saveResult(+b.dataset.save); toast('Salvo em Meus Designs.'); drawResults(); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
    }
    else if (b.dataset.mock) { const id = await saveResult(+b.dataset.mock); location.hash = `#/mockup/new?design=${id}`; }
    else if (b.dataset.ref) { S.refs.push(S.results[+b.dataset.ref].blob); S.refs = S.refs.slice(0, 10); drawRefs(); toast('Adicionada às referências.'); }
    else if (b.dataset.dl) download(S.results[+b.dataset.dl].blob, `ekklesia-ia-${Date.now()}.png`);
  });
}
