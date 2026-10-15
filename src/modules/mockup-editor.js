import { db, artBlob, currentVersions } from '../db.js';
import { $, $$, esc, objURL, loadImage, toast, modal, download, slugify, canvasToBlob } from '../util.js';
import { GARMENTS, VIEWS, COLORS, garmentById, areasFor, defaultArea, W, H } from '../garments.js';
import { renderMockup, exportMockup, BACKGROUNDS } from '../compose.js';
import { ICONS } from '../ui.js';

const newLayer = (view) => ({ area: defaultArea(view), x: 0, y: 0, scale: 1, rot: 0, opacity: 1 });

const SLIDERS = [
  { k: 'x', label: 'X', min: -400, max: 400, step: 1 },
  { k: 'y', label: 'Y', min: -500, max: 500, step: 1 },
  { k: 'scale', label: 'Escala', min: 0.1, max: 3, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { k: 'rot', label: 'Rotação', min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
  { k: 'opacity', label: 'Opacidade', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
];

export async function render(el, [param], query) {
  const isNew = param === 'new';
  let rec = isNew ? null : await db.mockups.get(+param);
  if (!isNew && !rec) { el.innerHTML = '<div class="empty"><h3>Mockup não encontrado</h3><a class="btn" href="#/mockups">Voltar</a></div>'; return; }

  const st = rec
    ? { garment: rec.garment, view: rec.view, color: rec.color, bg: rec.bg, designId: rec.designId, versionId: rec.layers?.[0]?.versionId ?? null, layer: { ...newLayer(rec.view), ...rec.layers?.[0] } }
    : { garment: GARMENTS[0].id, view: 'frente', color: COLORS[0].hex, bg: 'claro', designId: +query.design || null, versionId: +query.version || null, layer: newLayer('frente') };
  delete st.layer.versionId;

  let design = null, version = null, img = null;

  async function loadArt() {
    design = st.designId ? await db.designs.get(st.designId) : null;
    if (design && !st.versionId) st.versionId = design.currentVersionId;
    version = design && st.versionId ? await db.versions.get(st.versionId) : null;
    img = version ? await loadImage(artBlob(version)) : null;
  }
  await loadArt();

  el.innerHTML = `
    <div class="editor">
      <aside class="ed-left">
        <a class="back" href="#/mockups">${ICONS.back}<span>Mockups</span></a>
        <div class="ed-group"><h4>Peça</h4>
          <div class="list" id="garments">${GARMENTS.map((g) => `<button data-garment="${g.id}">${g.label}</button>`).join('')}</div>
          <p class="hint">Short, conjunto, moletom e boné entram nas próximas fases.</p>
        </div>
        <div class="ed-group"><h4>Vista</h4>
          <div class="seg" id="views">${VIEWS.map((v) => `<button data-view="${v.id}">${v.label}</button>`).join('')}</div>
        </div>
        <div class="ed-group"><h4>Cor da peça</h4>
          <div class="swatches" id="colors">
            ${COLORS.map((c) => `<button data-color="${c.hex}" title="${c.label}" style="--c:${c.hex}"></button>`).join('')}
            <label class="swatch-custom" title="Outra cor"><input type="color" id="customColor"></label>
          </div>
          <div class="color-name" id="colorName"></div>
        </div>
        <div class="ed-group"><h4>Fundo</h4>
          <div class="seg seg-wrap" id="bgs">${BACKGROUNDS.map((b) => `<button data-bg="${b.id}">${b.label}</button>`).join('')}</div>
        </div>
      </aside>

      <section class="ed-center">
        <div class="ed-canvas-wrap"><canvas id="cv" tabindex="0" aria-label="Prévia do mockup. Arraste para mover a estampa."></canvas></div>
        <div class="ed-status" id="status"></div>
      </section>

      <aside class="ed-right">
        <div class="ed-group"><h4>Arte</h4><div id="artBox"></div></div>
        <div class="ed-group"><h4>Área de impressão</h4><div class="list list-2" id="areas"></div></div>
        <div class="ed-group"><div class="ed-row"><h4>Ajustes</h4><button class="link" id="reset">Resetar</button></div>
          ${SLIDERS.map((s) => `
            <label class="slider"><span>${s.label}</span>
              <input type="range" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}">
              <output data-o="${s.k}"></output>
            </label>`).join('')}
          <div class="size-est" id="size"></div>
        </div>
        <div class="ed-group ed-actions">
          <button class="btn primary" id="save">${rec ? 'Salvar alterações' : 'Salvar mockup'}</button>
          <div class="ed-row">
            <button class="btn" data-export="image/png">${ICONS.download}<span>PNG</span></button>
            <button class="btn" data-export="image/jpeg">${ICONS.download}<span>JPG</span></button>
          </div>
        </div>
      </aside>
    </div>`;

  const cv = $('#cv', el);
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr;
  cv.height = H * dpr;

  // Mantém a proporção 5:6 do palco cabendo no espaço disponível.
  const wrap = $('.ed-canvas-wrap', el);
  const fit = () => {
    const cs = getComputedStyle(wrap);
    const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const w = Math.max(120, Math.min(aw, (ah * W) / H));
    cv.style.width = `${w}px`;
    cv.style.height = `${(w * H) / W}px`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);

  const opts = () => ({
    garment: st.garment, view: st.view, color: st.color, bg: st.bg,
    layers: img ? [{ ...st.layer, img }] : [],
  });

  let raf = 0;
  function paint() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const { sizes } = renderMockup(ctx, opts(), { scale: dpr, guides: !!img });
      const s = sizes[0];
      $('#size', el).innerHTML = s ? `Tamanho estimado da estampa: <b>${s.wCm.toFixed(1)} × ${s.hCm.toFixed(1)} cm</b> <small>(peça tam. M)</small>` : '';
    });
  }

  function syncControls() {
    $$('[data-garment]', el).forEach((b) => b.classList.toggle('active', b.dataset.garment === st.garment));
    $$('[data-view]', el).forEach((b) => b.classList.toggle('active', b.dataset.view === st.view));
    $$('[data-bg]', el).forEach((b) => b.classList.toggle('active', b.dataset.bg === st.bg));
    $$('[data-color]', el).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === st.color.toLowerCase()));
    $('#customColor', el).value = st.color;
    $('#colorName', el).textContent = COLORS.find((c) => c.hex.toLowerCase() === st.color.toLowerCase())?.label || st.color.toUpperCase();
    $('#areas', el).innerHTML = areasFor(st.garment, st.view).map((a) => `<button data-area="${a.id}" class="${a.id === st.layer.area ? 'active' : ''}">${a.label}</button>`).join('');
    for (const s of SLIDERS) {
      $(`[data-k="${s.k}"]`, el).value = st.layer[s.k];
      $(`[data-o="${s.k}"]`, el).textContent = s.fmt ? s.fmt(st.layer[s.k]) : Math.round(st.layer[s.k]);
    }
    $$('[data-k]', el).forEach((i) => { i.disabled = !img; });
    $('#artBox', el).innerHTML = img
      ? `<div class="art-pick"><img src="${objURL(version.thumb)}" class="checker" alt="">
           <div><b>${esc(design.name)}</b><small>V${version.n}${version.id === design.currentVersionId ? ' · atual' : ''}</small>
           <button class="link" id="pick">Trocar arte</button></div></div>
         ${version.hasAlpha === false ? '<p class="hint warn">Esta arte não tem fundo transparente.</p>' : ''}`
      : `<button class="btn block" id="pick">${ICONS.plus}<span>Escolher arte</span></button>
         ${st.designId && !design ? '<p class="hint warn">A arte original deste mockup foi excluída.</p>' : ''}`;
    $('#status', el).textContent = `${garmentById(st.garment).label} · ${st.view === 'costas' ? 'Costas' : 'Frente'}${img ? ` · ${areasFor(st.garment, st.view).find((a) => a.id === st.layer.area)?.label}` : ''}`;
  }

  const update = () => { syncControls(); paint(); };

  async function pickArt() {
    const designs = await db.designs.orderBy('updatedAt').reverse().toArray();
    if (!designs.length) {
      const go = await modal({ title: 'Nenhuma arte ainda', body: '<p>Envie uma arte primeiro para aplicá-la na peça.</p>', actions: [{ label: 'Cancelar', value: false }, { label: 'Enviar arte', value: true, kind: 'primary' }] });
      if (go) location.hash = '#/criar';
      return;
    }
    const vs = await currentVersions(designs);
    const chosen = await modal({
      title: 'Escolher arte',
      wide: true,
      actions: [],
      body: `<div class="pick-grid">${designs.map((d) => `
        <button class="pick" data-pick="${d.id}"><span class="thumb checker">${vs.get(d.id) ? `<img src="${objURL(vs.get(d.id).thumb)}" alt="">` : ''}</span><span>${esc(d.name)}</span><small>V${d.versionCount}</small></button>`).join('')}</div>`,
      onOpen: (m, close) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) close(+b.dataset.pick); }),
    });
    if (!chosen) return;
    st.designId = chosen;
    st.versionId = null;
    await loadArt();
    update();
  }

  // ---- eventos ----
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.garment) { st.garment = d.garment; update(); }
    else if (d.view && d.view !== st.view) { st.view = d.view; st.layer = { ...newLayer(d.view), opacity: st.layer.opacity }; update(); }
    else if (d.color) { st.color = d.color; update(); }
    else if (d.bg) { st.bg = d.bg; update(); }
    else if (d.area) { st.layer = { ...st.layer, area: d.area, x: 0, y: 0, rot: 0 }; update(); }
    else if (b.id === 'pick') pickArt();
    else if (b.id === 'reset') { st.layer = { ...newLayer(st.view), area: st.layer.area }; update(); }
    else if (b.id === 'save') save(b);
    else if (d.export) {
      const blob = await exportMockup(opts(), { type: d.export });
      const ext = d.export === 'image/png' ? 'png' : 'jpg';
      download(blob, `${slugify(design?.name || 'mockup')}-${st.garment}-${st.view}.${ext}`);
    }
  });
  $('#customColor', el).addEventListener('input', (e) => { st.color = e.target.value; update(); });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.k;
    if (!k) return;
    st.layer[k] = +e.target.value;
    const s = SLIDERS.find((x) => x.k === k);
    $(`[data-o="${k}"]`, el).textContent = s.fmt ? s.fmt(st.layer[k]) : Math.round(st.layer[k]);
    paint();
  });

  // arrastar para mover / roda para escalar / setas para ajuste fino
  let drag = null;
  const toStage = () => W / cv.getBoundingClientRect().width;
  cv.addEventListener('pointerdown', (e) => {
    if (!img) return;
    drag = { x: e.clientX, y: e.clientY, lx: st.layer.x, ly: st.layer.y, k: toStage() };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    st.layer.x = Math.round(drag.lx + (e.clientX - drag.x) * drag.k);
    st.layer.y = Math.round(drag.ly + (e.clientY - drag.y) * drag.k);
    paint();
  });
  const endDrag = () => { if (drag) { drag = null; cv.classList.remove('dragging'); syncControls(); } };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    if (!img) return;
    e.preventDefault();
    st.layer.scale = Math.min(3, Math.max(0.1, +(st.layer.scale * (e.deltaY < 0 ? 1.04 : 0.96)).toFixed(3)));
    update();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    if (!img) return;
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: ['x', -step], ArrowRight: ['x', step], ArrowUp: ['y', -step], ArrowDown: ['y', step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    st.layer[mv[0]] += mv[1];
    update();
  });

  async function save(btn) {
    btn.disabled = true;
    try {
      const full = await exportMockup(opts(), { scale: 1, type: 'image/png' });
      const tc = document.createElement('canvas');
      tc.width = 480; tc.height = Math.round(480 * (H / W));
      renderMockup(tc.getContext('2d'), opts(), { scale: 480 / W });
      const thumb = await canvasToBlob(tc, 'image/jpeg', 0.85);
      const now = Date.now();
      const data = {
        name: design ? `${design.name} · ${garmentById(st.garment).label}` : garmentById(st.garment).label,
        designId: st.designId || null, garment: st.garment, view: st.view, color: st.color, bg: st.bg,
        layers: img ? [{ ...st.layer, versionId: version.id }] : [],
        render: full, thumb, updatedAt: now,
      };
      if (rec) { await db.mockups.update(rec.id, data); rec = { ...rec, ...data }; }
      else {
        const id = await db.mockups.add({ ...data, createdAt: now });
        rec = { id, ...data };
        history.replaceState(null, '', `#/mockup/${id}`);
        btn.textContent = 'Salvar alterações';
      }
      toast('Mockup salvo.');
    } catch (err) {
      console.error(err);
      toast('Não foi possível salvar o mockup.', 'err');
    } finally { btn.disabled = false; }
  }

  update();
  if (!img && isNew && !st.designId) pickArt();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
