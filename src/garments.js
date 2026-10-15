// Moldes das peças. FASE 1: silhuetas vetoriais provisórias (sem fotos).
// Para trocar por fotos reais, ver assets/garments/README.md — as áreas de
// impressão continuam valendo, só a base desenhada muda.

export const W = 1000;   // tamanho lógico do palco de mockup
export const H = 1200;
const CX = W / 2;
export const TOP = 160;         // altura da gola na costura do ombro
const PPC = 10.5;        // px por cm no palco (peças em tamanho M)

// Medidas reais aproximadas (tam. M, peça estendida) em cm, relativas ao centro:
// [meia-largura, queda a partir da gola]. Convertidas para px abaixo.
const CM = {
  masculina: { neck: 8.5, neckFront: 9, neckBack: 2, shoulder: [22, 4], sleeveOut: [39.2, 16], sleeveIn: [29.5, 29.9], armpit: [26, 24], waist: [25.5, 46], hem: [26, 74] },
  feminina:  { neck: 9, neckFront: 10, neckBack: 2, shoulder: [19, 4], sleeveOut: [31.3, 12.6], sleeveIn: [23.9, 23.3], armpit: [23, 19.5], waist: [20.5, 40], hem: [23, 66] },
  babylook:  { neck: 8.5, neckFront: 9, neckBack: 2, shoulder: [17.5, 3.5], sleeveOut: [26.8, 9.3], sleeveIn: [21, 18.7], armpit: [20.5, 17], waist: [18, 34], hem: [20.5, 58] },
  oversized: { neck: 9.5, neckFront: 8.5, neckBack: 2, shoulder: [28, 8], sleeveOut: [43.3, 20.9], sleeveIn: [31.8, 34.8], armpit: [30, 30], waist: [30, 46], hem: [30, 76] },
};
const px = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k,
  Array.isArray(v) ? [v[0] * PPC, TOP + v[1] * PPC] : v * PPC]));
const SHAPES = Object.fromEntries(Object.entries(CM).map(([k, v]) => [k, px(v)]));

export const GARMENTS = [
  { id: 'camiseta-masculina', label: 'Camiseta masculina', group: 'Camisetas', shape: SHAPES.masculina },
  { id: 'camiseta-feminina', label: 'Camiseta feminina', group: 'Camisetas', shape: SHAPES.feminina },
  { id: 'babylook', label: 'Babylook', group: 'Camisetas', shape: SHAPES.babylook },
  { id: 'oversized', label: 'Oversized', group: 'Camisetas', shape: SHAPES.oversized },
];
export const garmentById = (id) => GARMENTS.find((g) => g.id === id) || GARMENTS[0];

export const VIEWS = [{ id: 'frente', label: 'Frente' }, { id: 'costas', label: 'Costas' }];

export const COLORS = [
  { id: 'preto', label: 'Preto', hex: '#151515' },
  { id: 'branco', label: 'Branco', hex: '#f3f1ec' },
  { id: 'off-white', label: 'Off-white', hex: '#e8e1d3' },
  { id: 'cinza', label: 'Cinza mescla', hex: '#9b9a97' },
  { id: 'grafite', label: 'Grafite', hex: '#3b3b3c' },
  { id: 'bege', label: 'Bege', hex: '#d6c4a4' },
  { id: 'marrom', label: 'Marrom', hex: '#5b4334' },
  { id: 'azul', label: 'Azul marinho', hex: '#1f2a44' },
  { id: 'verde', label: 'Verde militar', hex: '#4a5240' },
];

const f = (n) => +n.toFixed(1);

function neckCurve(s, depth, reverse = false) {
  const d = depth / 0.75; // controle cúbico que produz a profundidade desejada no meio
  const [a, b] = reverse ? [CX + s.neck, CX - s.neck] : [CX - s.neck, CX + s.neck];
  const k = reverse ? -1 : 1;
  return `C ${f(CX - k * s.neck * 0.55)} ${f(TOP + d)} ${f(CX + k * s.neck * 0.55)} ${f(TOP + d)} ${f(b)} ${TOP}`;
}

function silhouette(s) {
  const [shx, shy] = s.shoulder, [sox, soy] = s.sleeveOut, [six, siy] = s.sleeveIn;
  const [apx, apy] = s.armpit, [wx, wy] = s.waist, [hx, hy] = s.hem;
  // lado direito (de quem olha), descendo; depois o esquerdo espelhado, subindo
  const R = (x) => f(CX + x), L = (x) => f(CX - x);
  return [
    `M ${L(s.neck)} ${TOP}`,
    neckCurve(s, s.neckBack),
    `Q ${R((s.neck + shx) / 2)} ${f(TOP + (shy - TOP) * 0.35)} ${R(shx)} ${shy}`,
    `Q ${R((shx + sox) / 2 + 10)} ${f((shy + soy) / 2 - 14)} ${R(sox)} ${soy}`,
    `L ${R(six)} ${siy}`,
    `Q ${R((six + apx) / 2 + 6)} ${f((siy + apy) / 2 - 4)} ${R(apx)} ${apy}`,
    `C ${R(apx - 4)} ${f(apy + (wy - apy) * 0.5)} ${R(wx)} ${f(wy - (wy - apy) * 0.35)} ${R(wx)} ${wy}`,
    `C ${R(wx)} ${f(wy + (hy - wy) * 0.4)} ${R(hx)} ${f(hy - (hy - wy) * 0.4)} ${R(hx)} ${hy}`,
    `Q ${CX} ${hy + 16} ${L(hx)} ${hy}`,
    `C ${L(hx)} ${f(hy - (hy - wy) * 0.4)} ${L(wx)} ${f(wy + (hy - wy) * 0.4)} ${L(wx)} ${wy}`,
    `C ${L(wx)} ${f(wy - (wy - apy) * 0.35)} ${L(apx - 4)} ${f(apy + (wy - apy) * 0.5)} ${L(apx)} ${apy}`,
    `Q ${L((six + apx) / 2 + 6)} ${f((siy + apy) / 2 - 4)} ${L(six)} ${siy}`,
    `L ${L(sox)} ${soy}`,
    `Q ${L((shx + sox) / 2 + 10)} ${f((shy + soy) / 2 - 14)} ${L(shx)} ${shy}`,
    `Q ${L((s.neck + shx) / 2)} ${f(TOP + (shy - TOP) * 0.35)} ${L(s.neck)} ${TOP}`,
    'Z',
  ].join(' ');
}

// Eixo da manga direita (de quem olha): da cava até a barra.
function sleeveAxis(s) {
  const a = [(s.shoulder[0] + s.armpit[0]) / 2, (s.shoulder[1] + s.armpit[1]) / 2];
  const b = [(s.sleeveOut[0] + s.sleeveIn[0]) / 2, (s.sleeveOut[1] + s.sleeveIn[1]) / 2];
  return { a, b, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

const cache = new Map();
export function geometry(garmentId, view) {
  const key = `${garmentId}:${view}`;
  if (cache.has(key)) return cache.get(key);
  const g = garmentById(garmentId), s = g.shape;
  const front = view === 'frente';
  const [hx, hy] = s.hem;
  const body = new Path2D(silhouette(s));
  // Interior da gola visível pela frente (entre o decote das costas e o da frente)
  const innerStr = `M ${CX - s.neck} ${TOP} ${neckCurve(s, s.neckBack)} ${neckCurve(s, s.neckFront, true)} Z`;
  const inner = front ? new Path2D(innerStr) : null;
  const printable = new Path2D(silhouette(s));
  if (front) printable.addPath(inner);
  const rib = new Path2D(`M ${CX - s.neck} ${TOP} ${neckCurve(s, front ? s.neckFront : s.neckBack)}`);

  const ax = sleeveAxis(s);
  const nx = Math.cos(ax.angle), ny = Math.sin(ax.angle);
  const seams = new Path2D();
  for (const k of [1, -1]) {
    seams.addPath(new Path2D(`M ${CX + k * s.shoulder[0]} ${s.shoulder[1]} Q ${CX + k * (s.shoulder[0] + 12)} ${(s.shoulder[1] + s.armpit[1]) / 2} ${CX + k * s.armpit[0]} ${s.armpit[1]}`));
  }
  const stitches = new Path2D();
  for (const k of [1, -1]) {
    const o = 16;
    stitches.addPath(new Path2D(`M ${f(CX + k * (s.sleeveOut[0] - nx * o))} ${f(s.sleeveOut[1] - ny * o)} L ${f(CX + k * (s.sleeveIn[0] - nx * o))} ${f(s.sleeveIn[1] - ny * o)}`));
  }
  stitches.addPath(new Path2D(`M ${CX - hx + 6} ${hy - 18} Q ${CX} ${hy - 3} ${CX + hx - 6} ${hy - 18}`));

  const geo = { g, s, front, body, inner, printable, rib, seams, stitches, axis: ax, ppc: PPC };
  cache.set(key, geo);
  return geo;
}

// Áreas de impressão: centro (cx, cy), largura/altura e rotação base, em px do palco.
export function areasFor(garmentId, view) {
  const { s, ppc, axis } = geometry(garmentId, view);
  const cm = (n) => n * ppc;
  const bodyHalf = Math.min(s.armpit[0], s.waist[0]);
  const hemY = s.hem[1];
  if (view === 'frente') {
    const neckY = TOP + s.neckFront;
    const bigH = Math.min(cm(34), (hemY - neckY) * 0.7);
    const bigW = Math.min(cm(28), bodyHalf * 1.5);
    const t = 0.55;
    const sx = axis.a[0] + (axis.b[0] - axis.a[0]) * t, sy = axis.a[1] + (axis.b[1] - axis.a[1]) * t;
    const rot = (axis.angle * 180) / Math.PI - 90;
    return [
      { id: 'peito-esquerdo', label: 'Peito esquerdo', cx: CX + cm(9.5), cy: neckY + cm(9), w: cm(9), h: cm(9), rot: 0 },
      { id: 'peito-central', label: 'Peito central', cx: CX, cy: neckY + cm(8), w: cm(12), h: cm(8), rot: 0 },
      { id: 'peito-direito', label: 'Peito direito', cx: CX - cm(9.5), cy: neckY + cm(9), w: cm(9), h: cm(9), rot: 0 },
      { id: 'frente-grande', label: 'Estampa grande', cx: CX, cy: neckY + cm(6) + bigH / 2, w: bigW, h: bigH, rot: 0 },
      { id: 'manga-esquerda', label: 'Manga esquerda', cx: CX + sx, cy: sy, w: cm(7), h: cm(7), rot },
      { id: 'manga-direita', label: 'Manga direita', cx: CX - sx, cy: sy, w: cm(7), h: cm(7), rot: -rot },
    ];
  }
  const neckY = TOP + s.neckBack;
  const midH = Math.min(cm(32), (hemY - neckY) * 0.6);
  const totalH = (hemY - neckY - 30) * 0.94;
  return [
    { id: 'costas-superior', label: 'Superior', cx: CX, cy: neckY + cm(8), w: cm(26), h: cm(7), rot: 0 },
    { id: 'costas-central', label: 'Central', cx: CX, cy: neckY + cm(7) + midH / 2, w: Math.min(cm(28), bodyHalf * 1.5), h: midH, rot: 0 },
    { id: 'costas-inferior', label: 'Inferior', cx: CX, cy: hemY - cm(13), w: cm(24), h: cm(10), rot: 0 },
    { id: 'estampa-total', label: 'Estampa total', cx: CX, cy: neckY + 15 + totalH / 2, w: bodyHalf * 1.9, h: totalH, rot: 0 },
  ];
}

export const defaultArea = (view) => (view === 'frente' ? 'peito-central' : 'costas-central');
