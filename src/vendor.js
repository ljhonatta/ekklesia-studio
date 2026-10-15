// Bibliotecas carregadas sob demanda (só quando a tela precisa).
const cache = {};
function load(src) {
  cache[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete cache[src]; s.remove(); reject(new Error('Não foi possível carregar uma biblioteca. Verifique a conexão.')); };
    document.head.append(s);
  });
  return cache[src];
}

export async function getJsPDF() {
  await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  return window.jspdf.jsPDF;
}

export async function qrMatrix(text) {
  await load('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}

// QR em SVG (para telas). Margem de 2 módulos.
export function qrSVG(m, size = 120, fg = '#0c0c0c', bg = '#ffffff') {
  const q = 2, total = m.n + q * 2;
  let d = '';
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.dark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
