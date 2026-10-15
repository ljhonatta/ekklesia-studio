import { db, artBlob, currentVersions } from '../db.js';
import { $, $$, esc, objURL, loadImage, toast, modal, download, slugify, canvasToBlob } from '../util.js';
import { GARMENTS, VIEWS, COLORS, garmentById, areasFor, defaultArea, W as VW, H as VH } from '../garments.js';
import { renderMockup, BACKGROUNDS } from '../compose.js';
import { renderPhotoMockup, photoAreas, photoLabel, detectPhoto, needsAnalysis, estimateYaw, dragDelta, TIPOS_FOTO, VISTAS_FOTO } from '../photos.js';
import { ICONS } from '../ui.js';

const newLayer = (area) => ({ area, x: 0, y: 0, scale: 1, rot: 0, opacity: 1, blend: 'normal', fabric: 0.6, warp: 0.5, tint: null, clip: true, yaw: null });
const TINTS = [['#111111', 'Preto'], ['#ffffff', 'Branco'], ['#c4a96b', 'Dourado'], ['#8a8a8a', 'Cinza']];

const SLIDERS = [
  { k: 'x', label: 'X', step: 1 },
  { k: 'y', label: 'Y', step: 1 },
  { k: 'scale', label: 'Escala', min: 0.1, max: 3, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { k: 'rot', label: 'Rotação', min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
  { k: 'opacity', label: 'Opacidade', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { k: 'fabric', label: 'Luz/sombra', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, photo: true },
  { k: 'yaw', label: 'Giro 3D', min: -60, max: 60, step: 1, fmt: (v) => `${Math.round(v)}°`, photo: true },
  { k: 'warp', label: 'Seguir dobras', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, photo: true },
];

export async function render(el, [param], query) {
  const isNew = param === 'new';
  let rec = isNew ? null : await db.mockups.get(+param);
  if (!isNew && !rec) { el.innerHTML = '<div class="empty"><h3>Mockup não encontrado</h3><a class="btn" href="#/mockups">Voltar</a></div>'; return; }

  const photos = await db.photos.orderBy('id').toArray();
  const st = rec
    ? {
      source: rec.source || 'vector', photoId: rec.photoId || null,
      garment: rec.garment || GARMENTS[0].id, view: rec.view || 'frente', color: rec.color || COLORS[0].hex, bg: rec.bg || 'claro',
      designId: rec.designId, versionId: rec.layers?.[0]?.versionId ?? null,
      layer: { ...newLayer(defaultArea(rec.view || 'frente')), ...rec.layers?.[0] },
    }
    : {
      source: query.photo || (photos.length && query.source !== 'vector') ? 'photo' : 'vector',
      photoId: +query.photo || (photos.find((p) => p.vista === 'frente') || photos[0])?.id || null,
      garment: GARMENTS[0].id, view: 'frente', color: COLORS[0].hex, bg: 'claro',
      designId: +query.design || null, versionId: +query.version || null, layer: newLayer('principal'),
    };
  delete st.layer.versionId;
  if (st.source === 'vector' && isNew) st.layer.area = defaultArea('frente');

  let design = null, version = null, img = null;
  let photo = null, photoImg = null, photoMask = null;
  const tintCache = new Map();
  let filterTipo = '', filterVista = '';
  let calibrating = false, calRect = null, showAll = false, aiState = '';

  async function loadArt() {
    design = st.designId ? await db.designs.get(st.designId) : null;
    if (design && !st.versionId) st.versionId = design.currentVersionId;
    version = design && st.versionId ? await db.versions.get(st.versionId) : null;
    img = version ? await loadImage(artBlob(version)) : null;
  }
  async function loadPhoto() {
    photo = st.photoId ? photos.find((p) => p.id === st.photoId) || await db.photos.get(st.photoId) : null;
    photoImg = photo ? await loadImage(photo.image) : null;
    photoMask = photo?.shirt?.ok && photo.shirt.mask ? await loadImage(photo.shirt.mask) : null;
    if (st.source === 'photo' && !photo) st.source = 'vector';
  }
  await Promise.all([loadArt(), loadPhoto()]);

  async function runDetect() {
    if (!photo || aiState === 'running') return;
    const target = photo;
    aiState = 'running';
    syncControls();
    try {
      await detectPhoto(target);
      if (photo === target) photoMask = target.shirt?.ok ? await loadImage(target.shirt.mask) : null;
      const i = photos.findIndex((x) => x.id === target.id);
      if (i >= 0) photos[i] = target;
      aiState = '';
      if (target.pose.ok) toast(target.shirt?.ok ? `IA encontrou o corpo e a ${photoLabel(target).toLowerCase()}.` : 'IA encontrou o corpo; a roupa não ficou clara, use “Ajustar na foto” se precisar.');
    } catch (e) { console.error(e); aiState = 'error'; }
    if (photo === target) update();
  }
  const missingPhoto = rec?.source === 'photo' && !photo;

  el.innerHTML = `
    <div class="editor">
      <aside class="ed-left">
        <a class="back" href="#/mockups">${ICONS.back}<span>Mockups</span></a>
        <div class="ed-group">
          <div class="seg seg-full" id="srcSeg"><button data-src="photo">Peças reais</button><button data-src="vector">Silhuetas</button></div>
        </div>
        <div id="leftPhoto">
          <div class="ed-group">
            <div class="filters">
              <select id="fTipo" aria-label="Tipo de peça"><option value="">Todas as peças</option>${TIPOS_FOTO.map((t) => `<option>${t}</option>`).join('')}</select>
              <select id="fVista" aria-label="Vista"><option value="">Todas as vistas</option>${VISTAS_FOTO.map((v) => `<option value="${v.id}">${v.label}</option>`).join('')}</select>
            </div>
            <div class="photo-grid" id="photoGrid"></div>
          </div>
        </div>
        <div id="leftVector">
          <div class="ed-group"><h4>Peça</h4>
            <div class="list" id="garments">${GARMENTS.map((g) => `<button data-garment="${g.id}">${g.label}</button>`).join('')}</div>
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
        </div>
      </aside>

      <section class="ed-center">
        <div class="ed-canvas-wrap"><canvas id="cv" tabindex="0" aria-label="Prévia do mockup. Arraste para mover a estampa."></canvas></div>
        <div class="ed-status" id="status"></div>
      </section>

      <aside class="ed-right">
        ${missingPhoto ? '<p class="hint warn">A foto original deste mockup foi excluída.</p>' : ''}
        <div class="ed-group"><h4>Arte</h4><div id="artBox"></div></div>
        <div class="ed-group"><div class="ed-row"><h4>Área de impressão</h4><button class="link" id="calib">Ajustar na foto</button></div>
          <div class="ai-status photo-only" id="aiStatus"></div>
          <div class="list list-2" id="areas"></div>
          <p class="hint warn" id="handWarn" hidden>A mão do modelo está na frente desta área. A estampa vai passar por cima da mão: prefira outra área ou outra foto.</p>
          <p class="hint" id="calibHint" hidden>Arraste na foto um retângulo sobre a área selecionada. O ajuste fica salvo para esta foto.</p>
          <div class="ed-row photo-only area-tools">
            <label class="toggle small"><input type="checkbox" id="showAll"><span>Ver todas as áreas</span></label>
            <button class="link" id="undoManual" hidden>Voltar ao automático</button>
          </div>
        </div>
        <div class="ed-group"><div class="ed-row"><h4>Ajustes</h4><button class="link" id="reset">Resetar</button></div>
          ${SLIDERS.map((s) => `
            <label class="slider ${s.photo ? 'photo-only' : ''}"><span>${s.label}${s.k === 'yaw' ? ' <button class="link mini" id="yawAuto">auto</button>' : ''}</span>
              <input type="range" data-k="${s.k}" ${s.min != null ? `min="${s.min}" max="${s.max}"` : ''} step="${s.step}">
              <output data-o="${s.k}"></output>
            </label>`).join('')}
          <div class="field"><span>Cor da arte</span>
            <div class="tints" id="tints"><button data-tint="" title="Cores originais">Original</button>${TINTS.map(([h, l]) => `<button data-tint="${h}" title="${l}" style="--c:${h}"></button>`).join('')}<label class="tint-custom" title="Outra cor"><input type="color" id="tintColor"></label></div>
          </div>
          <label class="toggle small photo-only"><input type="checkbox" id="clipToggle" checked><span>Só onde tem roupa (não cobre braço, mão ou fundo)</span></label>
          <div class="field photo-only"><span>Tinta</span>
            <div class="seg seg-wrap" id="blendSeg"><button data-blend="normal">Normal</button><button data-blend="multiply">Absorvida (peça clara)</button></div>
          </div>
          <div class="size-est" id="size"></div>
        </div>
        <div class="ed-group ed-actions">
          <label class="field"><span>Nome do mockup</span><input id="mockName" placeholder="Nome gerado pela peça"></label>
          <div class="ed-row">
            <button class="btn primary" id="save">${rec ? 'Salvar' : 'Salvar mockup'}</button>
            <button class="btn" id="saveNew" ${rec ? '' : 'hidden'}>Salvar como novo</button>
          </div>
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
  const isPhoto = () => st.source === 'photo' && photo;
  const dims = () => (isPhoto() ? { W: photo.w, H: photo.h } : { W: VW, H: VH });
  const paintScale = () => (isPhoto() ? Math.min(dpr, 1400 / photo.w) : dpr);
  const areas = () => (isPhoto() ? photoAreas(photo, st.layer.yaw ?? undefined) : areasFor(st.garment, st.view));
  // arte recolorida (cor sólida) quando escolhida
  const artImg = () => {
    if (!img || !st.layer.tint) return img;
    const key = `${version.id}:${st.layer.tint}`;
    if (!tintCache.has(key)) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = st.layer.tint;
      x.fillRect(0, 0, c.width, c.height);
      tintCache.clear(); tintCache.set(key, c);
    }
    return tintCache.get(key);
  };

  const wrap = $('.ed-canvas-wrap', el);
  function fit() {
    const { W, H } = dims();
    const cs = getComputedStyle(wrap);
    const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const w = Math.max(120, Math.min(aw, (ah * W) / H));
    cv.style.width = `${w}px`;
    cv.style.height = `${(w * H) / W}px`;
  }
  function resizeCanvas() {
    const { W, H } = dims();
    const s = paintScale();
    if (cv.width !== Math.round(W * s) || cv.height !== Math.round(H * s)) { cv.width = Math.round(W * s); cv.height = Math.round(H * s); }
    fit();
  }
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);

  const opts = () => (isPhoto()
    ? { photo, img: photoImg, mask: photoMask, layers: img ? [{ ...st.layer, tint: null, img: artImg() }] : [], showArea: true, showAllAreas: showAll, showMask: showAll }
    : { garment: st.garment, view: st.view, color: st.color, bg: st.bg, layers: img ? [{ ...st.layer, img: artImg() }] : [] });
  const draw = (c, scale, guides, fast = false) => (isPhoto() ? renderPhotoMockup(c, opts(), { scale, guides, fast }) : renderMockup(c, opts(), { scale, guides }));

  let raf = 0;
  function paint() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const s = paintScale();
      const { sizes } = draw(ctx, s, true, !!drag);
      if (calRect) {
        ctx.save();
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.fillStyle = 'rgba(196,169,107,0.18)';
        ctx.strokeStyle = '#c4a96b';
        ctx.lineWidth = 2 / s;
        ctx.fillRect(calRect.x, calRect.y, calRect.w, calRect.h);
        ctx.strokeRect(calRect.x, calRect.y, calRect.w, calRect.h);
        ctx.restore();
      }
      const sz = sizes[0];
      $('#size', el).innerHTML = sz?.wCm ? `Tamanho estimado da estampa: <b>${sz.wCm.toFixed(1)} × ${sz.hCm.toFixed(1)} cm</b> <small>(peça tam. M)</small>` : '';
    });
  }

  function drawPhotoGrid() {
    const list = photos.filter((p) => (!filterTipo || p.tipo === filterTipo) && (!filterVista || p.vista === filterVista));
    $('#photoGrid', el).innerHTML = photos.length
      ? list.length ? list.map((p) => `<button data-photo="${p.id}" class="${p.id === st.photoId ? 'active' : ''}" title="${esc(photoLabel(p))}"><img src="${objURL(p.thumb)}" alt="${esc(photoLabel(p))}" loading="lazy"></button>`).join('')
        : '<p class="hint">Nenhuma foto com esse filtro.</p>'
      : '<p class="hint">Nenhuma peça real importada. <a class="link" href="#/mockups?tab=pecas">Importar fotos</a></p>';
  }

  function syncControls() {
    const ph = isPhoto();
    $$('[data-src]', el).forEach((b) => b.classList.toggle('active', b.dataset.src === (ph ? 'photo' : 'vector')));
    $('#leftPhoto', el).hidden = !ph && st.source !== 'photo';
    $('#leftVector', el).hidden = ph || st.source === 'photo';
    $$('.photo-only', el).forEach((x) => { x.hidden = !ph; });
    $('#calib', el).hidden = !ph;
    $('#calib', el).textContent = calibrating ? 'Cancelar ajuste' : 'Ajustar na foto';
    $('#calibHint', el).hidden = !calibrating;
    cv.classList.toggle('calibrating', calibrating);
    $$('[data-garment]', el).forEach((b) => b.classList.toggle('active', b.dataset.garment === st.garment));
    $$('[data-view]', el).forEach((b) => b.classList.toggle('active', b.dataset.view === st.view));
    $$('[data-bg]', el).forEach((b) => b.classList.toggle('active', b.dataset.bg === st.bg));
    $$('[data-blend]', el).forEach((b) => b.classList.toggle('active', b.dataset.blend === (st.layer.blend || 'normal')));
    $$('[data-color]', el).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === st.color.toLowerCase()));
    $$('[data-photo]', el).forEach((b) => b.classList.toggle('active', +b.dataset.photo === st.photoId));
    $('#customColor', el).value = st.color;
    $('#colorName', el).textContent = COLORS.find((c) => c.hex.toLowerCase() === st.color.toLowerCase())?.label || st.color.toUpperCase();
    const ar = areas();
    if (!ar.some((a) => a.id === st.layer.area)) st.layer.area = ar[0].id;
    $('#areas', el).innerHTML = ar.map((a) => `<button data-area="${a.id}" class="${a.id === st.layer.area ? 'active' : ''} ${a.hidden ? 'dim' : ''}" title="${a.cmW ? `${a.cmW} × ${a.cmH} cm (padrão)` : ''}${a.hidden ? ' · fica escondida pelo giro do corpo' : ''}${a.manual ? ' · ajustada à mão' : ''}">${a.label}${a.manual ? ' ✎' : ''}</button>`).join('');
    $$('[data-tint]', el).forEach((b) => b.classList.toggle('active', (b.dataset.tint || null) === (st.layer.tint || null)));
    $('#clipToggle', el).checked = st.layer.clip !== false;
    $('#clipToggle', el).disabled = !photoMask;
    const nameInput = $('#mockName', el);
    nameInput.placeholder = autoName();
    const { W, H } = dims();
    for (const s of SLIDERS) {
      const input = $(`[data-k="${s.k}"]`, el);
      if (s.k === 'x') { input.min = -W / 2; input.max = W / 2; }
      if (s.k === 'y') { input.min = -H / 2; input.max = H / 2; }
      const v = s.k === 'yaw' ? (st.layer.yaw ?? (ph ? estimateYaw(photo) : 0)) : (st.layer[s.k] ?? 0);
      input.value = v;
      input.disabled = !img;
      $(`[data-o="${s.k}"]`, el).textContent = s.fmt ? s.fmt(v) : Math.round(v);
    }
    $('#artBox', el).innerHTML = img
      ? `<div class="art-pick"><img src="${objURL(version.thumb)}" class="checker" alt="">
           <div><b>${esc(design.name)}</b><small>V${version.n}${version.id === design.currentVersionId ? ' · atual' : ''}</small>
           <button class="link" id="pick">Trocar arte</button></div></div>
         ${version.hasAlpha === false ? '<p class="hint warn">Esta arte não tem fundo transparente. Use “Remover fundo” na página do design.</p>' : ''}`
      : `<button class="btn block" id="pick">${ICONS.plus}<span>Escolher arte</span></button>
         ${st.designId && !design ? '<p class="hint warn">A arte original deste mockup foi excluída.</p>' : ''}`;
    const cur = ar.find((a) => a.id === st.layer.area);
    $('#handWarn', el).hidden = !(ph && cur?.handOver);
    $('#undoManual', el).hidden = !(ph && cur?.manual);
    $('#showAll', el).checked = showAll;
    if (ph) {
      $('#aiStatus', el).innerHTML = aiState === 'running' ? '<span class="dot pulse"></span>IA analisando o corpo na foto…'
        : aiState === 'error' ? '<span class="dot err"></span>Não foi possível carregar a IA. <button class="link" id="aiRun">Tentar de novo</button>'
          : photo.pose?.ok ? `<span class="dot ok"></span>${photo.shirt?.ok ? `IA encontrou o corpo e a roupa (${esc(photoLabel(photo).toLowerCase())}). Áreas no padrão de serigrafia.` : 'IA encontrou o corpo; a roupa não ficou nítida.'} <button class="link" id="aiRun">Detectar de novo</button>`
            : photo.pose ? '<span class="dot warn"></span>A IA não achou o corpo (close ou recorte). Use “Ajustar na foto”. <button class="link" id="aiRun">Tentar de novo</button>'
              : '<span class="dot"></span><button class="link" id="aiRun">Detectar áreas com IA</button>';
    }
    const areaLabel = img ? ` · ${cur?.label}` : '';
    $('#status', el).textContent = ph ? `${photoLabel(photo)} · foto real${areaLabel}` : `${garmentById(st.garment).label} · ${st.view === 'costas' ? 'Costas' : 'Frente'}${areaLabel}`;
  }

  const update = () => { resizeCanvas(); syncControls(); paint(); };

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
    if (d.src) {
      if (d.src === 'photo' && !photos.length) { location.hash = '#/mockups?tab=pecas'; return; }
      st.source = d.src;
      if (d.src === 'photo' && !photo) { st.photoId = photos[0].id; await loadPhoto(); }
      st.layer = { ...st.layer, area: d.src === 'photo' ? 'principal' : defaultArea(st.view), x: 0, y: 0 };
      calibrating = false;
      update();
    } else if (d.photo) {
      st.photoId = +d.photo;
      await loadPhoto();
      st.layer = { ...st.layer, x: 0, y: 0, rot: 0 };
      calibrating = false;
      update();
      if (needsAnalysis(photo)) runDetect();
    } else if (d.garment) { st.garment = d.garment; update(); }
    else if (d.view && d.view !== st.view) { st.view = d.view; st.layer = { ...newLayer(defaultArea(d.view)), opacity: st.layer.opacity }; update(); }
    else if (d.color) { st.color = d.color; update(); }
    else if (d.bg) { st.bg = d.bg; update(); }
    else if (d.blend) { st.layer.blend = d.blend; update(); }
    else if (d.area) { st.layer = { ...st.layer, area: d.area, x: 0, y: 0, rot: 0 }; update(); }
    else if (b.id === 'calib') { calibrating = !calibrating; calRect = null; update(); }
    else if (b.id === 'aiRun') runDetect();
    else if (b.id === 'undoManual') {
      const ov = { ...(photo.areaOverrides || {}) };
      delete ov[st.layer.area];
      const patch = { areaOverrides: ov };
      if (st.layer.area === 'principal') patch.area = null;
      Object.assign(photo, patch);
      await db.photos.update(photo.id, patch);
      update();
    }
    else if (b.id === 'pick') pickArt();
    else if (b.id === 'reset') { st.layer = { ...newLayer(st.layer.area), blend: st.layer.blend }; update(); }
    else if (b.id === 'save') save(b);
    else if (b.id === 'saveNew') save(b, true);
    else if (b.id === 'yawAuto') { e.preventDefault(); st.layer.yaw = null; update(); }
    else if (b.dataset.tint !== undefined && b.closest('#tints')) { st.layer.tint = b.dataset.tint || null; update(); }
    else if (d.export) {
      const blob = await renderBlob(d.export);
      const ext = d.export === 'image/png' ? 'png' : 'jpg';
      const what = isPhoto() ? slugify(photoLabel(photo)) : `${st.garment}-${st.view}`;
      download(blob, `${slugify(design?.name || 'mockup')}-${what}.${ext}`);
    }
  });
  $('#customColor', el).addEventListener('input', (e) => { st.color = e.target.value; update(); });
  $('#showAll', el).addEventListener('change', (e) => { showAll = e.target.checked; paint(); });
  $('#clipToggle', el).addEventListener('change', (e) => { st.layer.clip = e.target.checked; paint(); });
  $('#fTipo', el).addEventListener('change', (e) => { filterTipo = e.target.value; drawPhotoGrid(); syncControls(); });
  $('#fVista', el).addEventListener('change', (e) => { filterVista = e.target.value; drawPhotoGrid(); syncControls(); });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'tintColor') { st.layer.tint = e.target.value; update(); return; }
    const k = e.target.dataset?.k;
    if (!k) return;
    st.layer[k] = +e.target.value;
    const s = SLIDERS.find((x) => x.k === k);
    $(`[data-o="${k}"]`, el).textContent = s.fmt ? s.fmt(st.layer[k]) : Math.round(st.layer[k]);
    paint();
  });

  // arrastar para mover (ou desenhar a área ao ajustar) / roda para escalar / setas
  let drag = null;
  const toStage = (e) => {
    const r = cv.getBoundingClientRect();
    const { W } = dims();
    const k = W / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (calibrating) {
      const p = toStage(e);
      drag = { cal: true, x0: p.x, y0: p.y };
      calRect = { x: p.x, y: p.y, w: 0, h: 0 };
    } else {
      if (!img) return;
      const ar = isPhoto() ? areas() : null;
      drag = { x: e.clientX, y: e.clientY, lx: st.layer.x, ly: st.layer.y, k: toStage(e).k, area: ar?.find((a) => a.id === st.layer.area), frame: ar?.frame };
    }
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.cal) {
      const p = toStage(e);
      calRect = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
    } else {
      let dx = (e.clientX - drag.x) * drag.k, dy = (e.clientY - drag.y) * drag.k;
      if (drag.area) ({ dx, dy } = dragDelta(drag.area, drag.frame, dx, dy));
      st.layer.x = Math.round(drag.lx + dx);
      st.layer.y = Math.round(drag.ly + dy);
    }
    paint();
  });
  const endDrag = async () => {
    if (!drag) return;
    const wasCal = drag.cal;
    drag = null;
    cv.classList.remove('dragging');
    if (wasCal && calRect && calRect.w > 10 && calRect.h > 10) {
      const cur = areas().find((a) => a.id === st.layer.area);
      const rect = { cx: (calRect.x + calRect.w / 2) / photo.w, cy: (calRect.y + calRect.h / 2) / photo.h, w: calRect.w / photo.w, h: calRect.h / photo.h, rot: cur?.rot || 0 };
      const patch = { areaOverrides: { ...(photo.areaOverrides || {}), [st.layer.area]: rect } };
      if (st.layer.area === 'principal') patch.area = null;
      Object.assign(photo, patch);
      await db.photos.update(photo.id, patch);
      calibrating = false; calRect = null;
      st.layer = { ...st.layer, x: 0, y: 0 };
      toast(`${cur?.label || 'Área'} ajustada para esta foto.`);
      update();
      return;
    }
    if (wasCal) { calRect = null; paint(); return; }
    syncControls();
    paint();
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    if (!img || calibrating) return;
    e.preventDefault();
    st.layer.scale = Math.min(3, Math.max(0.1, +(st.layer.scale * (e.deltaY < 0 ? 1.04 : 0.96)).toFixed(3)));
    syncControls(); paint();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    if (!img) return;
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: ['x', -step], ArrowRight: ['x', step], ArrowUp: ['y', -step], ArrowDown: ['y', step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    st.layer[mv[0]] += mv[1];
    syncControls(); paint();
  });

  async function renderBlob(type = 'image/png', scale) {
    const { W, H } = dims();
    const s = scale ?? (isPhoto() ? 1 : 2);
    const c = document.createElement('canvas');
    c.width = Math.round(W * s); c.height = Math.round(H * s);
    const cx = c.getContext('2d');
    if (!isPhoto() && type === 'image/jpeg' && st.bg === 'transparente') renderMockup(cx, { ...opts(), bg: 'claro' }, { scale: s });
    else draw(cx, s, false);
    return canvasToBlob(c, type, 0.92);
  }

  const autoName = () => {
    const what = isPhoto() ? photoLabel(photo) : garmentById(st.garment).label;
    return design ? `${design.name} · ${what}` : what;
  };
  async function save(btn, asNew = false) {
    btn.disabled = true;
    try {
      const { W } = dims();
      const full = await renderBlob('image/png', 1);
      const tc = document.createElement('canvas');
      const { H } = dims();
      tc.width = 480; tc.height = Math.round(480 * (H / W));
      draw(tc.getContext('2d'), 480 / W, false);
      const thumb = await canvasToBlob(tc, 'image/jpeg', 0.85);
      const now = Date.now();
      const data = {
        name: $('#mockName', el).value.trim() || autoName(),
        source: isPhoto() ? 'photo' : 'vector', photoId: isPhoto() ? photo.id : null, photoName: isPhoto() ? photoLabel(photo) : null,
        designId: st.designId || null, garment: st.garment, view: isPhoto() ? (photo.vista === 'costas' ? 'costas' : 'frente') : st.view, color: st.color, bg: st.bg,
        layers: img ? [{ ...st.layer, versionId: version.id }] : [],
        render: full, thumb, updatedAt: now,
      };
      if (rec && !asNew) { await db.mockups.update(rec.id, data); rec = { ...rec, ...data }; toast('Alterações salvas neste mockup.'); }
      else {
        const id = await db.mockups.add({ ...data, createdAt: now });
        rec = { id, ...data };
        history.replaceState(null, '', `#/mockup/${id}`);
        $('#save', el).textContent = 'Salvar';
        $('#saveNew', el).hidden = false;
        toast(asNew ? 'Salvo como um novo mockup.' : 'Mockup salvo. Para fazer outro, use “Salvar como novo”.');
      }
    } catch (err) {
      console.error(err);
      toast('Não foi possível salvar o mockup.', 'err');
    } finally { btn.disabled = false; }
  }

  drawPhotoGrid();
  if (rec?.name) $('#mockName', el).value = rec.name;
  update();
  if (isPhoto() && needsAnalysis(photo)) runDetect();
  if (!img && isNew && !st.designId) pickArt();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
