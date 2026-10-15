// Motor de mockup: desenha a peça, aplica a estampa e por cima o sombreamento
// do tecido (dobras + textura), para a arte "assentar" no algodão.
import { W, H, TOP, geometry, areasFor } from './garments.js';
import { shade, luminance, canvasToBlob } from './util.js';

export const BACKGROUNDS = [
  { id: 'claro', label: 'Estúdio claro' },
  { id: 'escuro', label: 'Estúdio escuro' },
  { id: 'transparente', label: 'Transparente' },
];

let labelLogo = null;
export const setLabelLogo = (canvas) => { labelLogo = canvas; };

let noiseCanvas;
function noisePattern(ctx) {
  if (!noiseCanvas) {
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseCanvas.height = 160;
    const nctx = noiseCanvas.getContext('2d');
    const img = nctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 108 + Math.random() * 40;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
  }
  return ctx.createPattern(noiseCanvas, 'repeat');
}

function drawBackground(ctx, bg) {
  if (bg === 'transparente') return;
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H * 0.5, W * 0.95);
  if (bg === 'escuro') { g.addColorStop(0, '#2b2a28'); g.addColorStop(1, '#0f0f0e'); }
  else { g.addColorStop(0, '#f4f2ee'); g.addColorStop(1, '#d8d4cc'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Mancha elíptica suave (dobra ou brilho).
function smudge(ctx, x, y, rx, ry, rot, rgba) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba);
  g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

function drawFabric(ctx, geo, dark) {
  const { s, axis } = geo;
  const cx = W / 2, hw = s.armpit[0] * 1.08, hemY = s.hem[1];
  let g = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
  const side = dark ? 0.32 : 0.2;
  g.addColorStop(0, `rgba(0,0,0,${side})`);
  g.addColorStop(0.17, 'rgba(0,0,0,0.05)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(0.83, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, `rgba(0,0,0,${side})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  g = ctx.createLinearGradient(0, TOP, 0, hemY);
  g.addColorStop(0, `rgba(255,255,255,${dark ? 0.06 : 0.1})`);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const D = (a) => `rgba(0,0,0,${a})`, L = (a) => `rgba(255,255,255,${dark ? a * 0.7 : a})`;
  const [apx, apy] = s.armpit;
  for (const k of [1, -1]) {
    // dobras que saem da cava em direção ao peito
    smudge(ctx, cx + k * (apx - 55), apy + 70, 120, 13, k * 0.55, D(0.16));
    smudge(ctx, cx + k * (apx - 62), apy + 52, 110, 9, k * 0.55, L(0.09));
    smudge(ctx, cx + k * (apx - 40), apy + 150, 90, 10, k * 0.35, D(0.1));
    // manga
    const mx = cx + k * ((axis.a[0] + axis.b[0]) / 2), my = (axis.a[1] + axis.b[1]) / 2;
    smudge(ctx, mx, my, 55, 8, k > 0 ? axis.angle + 1.2 : Math.PI - axis.angle - 1.2, D(0.12));
  }
  smudge(ctx, cx, s.armpit[1] - 40, 230, 150, 0, L(0.07));
  smudge(ctx, cx - 70, hemY - 120, 150, 11, 0.07, D(0.11));
  smudge(ctx, cx - 76, hemY - 132, 140, 7, 0.07, L(0.06));
  smudge(ctx, cx + 95, hemY - 75, 125, 9, -0.06, D(0.09));
  smudge(ctx, cx + 30, s.waist[1] - 40, 160, 10, -0.04, D(0.06));

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = dark ? 0.35 : 0.5;
  ctx.fillStyle = noisePattern(ctx);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Desenha uma camada de arte dentro da área. Retorna a caixa (para guias e medidas).
function drawLayer(ctx, img, layer, area) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const fit = Math.min(area.w / iw, area.h / ih);
  const k = fit * layer.scale;
  const w = iw * k, h = ih * k;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(area.cx + layer.x, area.cy + layer.y);
  ctx.rotate(((area.rot + layer.rot) * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return { w, h };
}

function rotRect(ctx, cx, cy, w, h, rotDeg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * opts: { garment, view, color, bg, layers: [{ area, x, y, scale, rot, opacity, img }] }
 * Retorna medidas estimadas das estampas em cm.
 */
export function renderMockup(ctx, opts, { scale = 1, guides = false } = {}) {
  const geo = geometry(opts.garment, opts.view);
  const areas = areasFor(opts.garment, opts.view);
  const color = opts.color;
  const dark = luminance(color) < 0.35;
  const sizes = [];

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, opts.bg);

  // sombra projetada
  ctx.save();
  ctx.shadowColor = opts.bg === 'escuro' ? 'rgba(0,0,0,0.55)' : 'rgba(40,30,20,0.22)';
  ctx.shadowBlur = 48 * scale;
  ctx.shadowOffsetY = 26 * scale;
  ctx.fillStyle = color;
  ctx.fill(geo.body);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fill(geo.body);

  // interior da gola + etiqueta
  if (geo.inner) {
    ctx.save();
    ctx.clip(geo.inner);
    ctx.fillStyle = shade(color, dark ? -0.45 : -0.28);
    ctx.fill(geo.inner);
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(W / 2 - 26, TOP + 7, 52, 15);
    if (labelLogo) {
      const k = Math.min(44 / labelLogo.width, 11 / labelLogo.height);
      const lw = labelLogo.width * k, lh = labelLogo.height * k;
      ctx.drawImage(labelLogo, W / 2 - lw / 2, TOP + 14.5 - lh / 2, lw, lh);
    } else {
      ctx.fillStyle = '#c4a96b';
      ctx.font = '600 7px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EKKLESIA', W / 2, TOP + 17.5);
    }
    ctx.restore();
  }

  // estampas (recortadas pela peça, sem invadir o interior da gola)
  ctx.save();
  ctx.clip(geo.printable, 'evenodd');
  for (const layer of opts.layers || []) {
    const area = areas.find((a) => a.id === layer.area) || areas[0];
    if (!layer.img) continue;
    const box = drawLayer(ctx, layer.img, layer, area);
    sizes.push({ wCm: box.w / geo.ppc, hCm: box.h / geo.ppc });
  }
  ctx.restore();

  // tecido por cima da arte
  ctx.save();
  ctx.clip(geo.body);
  drawFabric(ctx, geo, dark);
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(color, dark ? 0.07 : -0.07);
  ctx.lineWidth = 18;
  ctx.translate(0, 9);
  ctx.stroke(geo.rib);
  ctx.translate(0, -9);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5;
  ctx.translate(0, 18);
  ctx.stroke(geo.rib);
  ctx.translate(0, -18);
  ctx.stroke(geo.seams);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.16)';
  ctx.stroke(geo.stitches);
  ctx.setLineDash([]);
  ctx.restore();

  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1.2;
  ctx.stroke(geo.body);

  if (guides) {
    const sel = opts.layers?.[0];
    const area = areas.find((a) => a.id === sel?.area);
    if (area) {
      ctx.strokeStyle = 'rgba(196,169,107,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 6]);
      rotRect(ctx, area.cx, area.cy, area.w, area.h, area.rot);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  return { sizes, ppc: geo.ppc };
}

export async function exportMockup(opts, { scale = 2, type = 'image/png', quality = 0.92 } = {}) {
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const o = type === 'image/jpeg' && opts.bg === 'transparente' ? { ...opts, bg: 'claro' } : opts;
  renderMockup(c.getContext('2d'), o, { scale });
  return canvasToBlob(c, type, quality);
}
