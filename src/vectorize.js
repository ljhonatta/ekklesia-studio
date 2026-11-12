// Vetorização: transforma a arte (PNG/JPG) em SVG de cores chapadas, nítido em
// qualquer tamanho. Funciona melhor em logos e artes de poucas cores; artes
// fotográficas/coloridas viram muitas manchas (para essas, use o PNG em alta).
import { loadImage } from './util.js';
import { analyzeArt, drawAt } from './production-pack.js';

const SRC = 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js';
let loading = null;
function tracer() {
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => resolve(window.ImageTracer);
    s.onerror = () => { loading = null; reject(new Error('Não foi possível carregar o vetorizador. Verifique a internet.')); };
    document.head.append(s);
  });
  return loading;
}

const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

/**
 * Retorna { svg, colors, colorida }.
 * A arte é separada em tintas (principal + destaques) como no pacote de produção;
 * cada tinta vira um conjunto de formas vetoriais. O fundo liso some.
 */
export async function vectorize(blob, { size = 2000 } = {}) {
  const IT = await tracer();
  const info = await analyzeArt(blob);
  const img = await loadImage(blob);
  // trabalha grande: curvas mais suaves (até 2000 px no lado maior)
  const k = size / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const { x } = drawAt(img, w, h);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  const ink = info.inkDark ? [17, 17, 17] : [245, 243, 237];
  const pal = [{ r: 0, g: 0, b: 0, a: 0 }, { r: ink[0], g: ink[1], b: ink[2], a: 255 }, ...info.accents.map((a) => ({ r: a.rgb[0], g: a.rgb[1], b: a.rgb[2], a: 255 }))];
  if (!info.colorida) {
    // cada pixel vira uma tinta (ou nada), com limiar no meio da borda suave
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255, r = d[i], g = d[i + 1], b = d[i + 2];
      const L = (r + g + b) / 765, chroma = Math.max(r, g, b) - Math.min(r, g, b);
      let p = 0;
      if (a > 0.5) {
        if (chroma > 60 && info.accents.length) {
          const hh = hueOf(r, g, b);
          let best = 0, bd = 999;
          info.accents.forEach((ac, j) => { const dd = Math.min(Math.abs(ac.hue - hh), 360 - Math.abs(ac.hue - hh)); if (dd < bd) { bd = dd; best = j; } });
          p = 2 + best;
        } else {
          const cover = info.background === 'transparente' && !info.inkDark && L > 0.5 ? 1 : info.inkDark ? 1 - L : L;
          if (cover > 0.5) p = 1;
        }
      }
      const q = pal[p];
      d[i] = q.r; d[i + 1] = q.g; d[i + 2] = q.b; d[i + 3] = q.a;
    }
  }
  const opts = info.colorida
    ? { numberofcolors: 16, colorsampling: 2, ltres: 1, qtres: 1, pathomit: 12, blurradius: 1, strokewidth: 0, roundcoords: 1, viewbox: true }
    : { pal, numberofcolors: pal.length, colorsampling: 0, colorquantcycles: 1, ltres: 0.6, qtres: 0.6, pathomit: 10, blurradius: 0, strokewidth: 0, roundcoords: 2, linefilter: true, viewbox: true };
  let svg = IT.imagedataToSVG(id, opts);
  // tira as formas transparentes (o fundo) e o contorno
  svg = svg.replace(/<path[^>]*opacity="0"[^>]*\/>/g, '').replace(/ stroke="[^"]*" stroke-width="[^"]*"/g, '');
  if (!/<svg[^>]*\swidth=/.test(svg)) svg = svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
  return { svg, colors: info.colorida ? 16 : pal.length - 1, colorida: info.colorida, inkDark: info.inkDark };
}
