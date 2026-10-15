// Listas e formatações compartilhadas por produtos, produção e catálogo.

export const TECNICAS = [
  { id: 'dtf', label: 'DTF', desc: 'Filme impresso e transferido por calor. Cores ilimitadas, ótimo para tiragens pequenas.' },
  { id: 'dtg', label: 'DTG', desc: 'Impressão direta no tecido. Melhor resultado em algodão.' },
  { id: 'serigrafia', label: 'Serigrafia', desc: 'Uma tela por cor. Ideal para tiragens maiores e cores chapadas.' },
  { id: 'bordado', label: 'Bordado', desc: 'Exige matriz de bordado (DST/PES) feita por um digitalizador.' },
  { id: 'sublimacao', label: 'Sublimação', desc: 'Só funciona em poliéster claro.' },
  { id: 'transfer', label: 'Transfer', desc: 'Papel transfer aplicado com prensa térmica.' },
];
export const tecLabel = (id) => TECNICAS.find((t) => t.id === id)?.label || id || '—';

export const CATEGORIAS = ['Camiseta masculina', 'Camiseta feminina', 'Babylook', 'Oversized', 'Manga longa', 'Regata', 'Short', 'Conjunto', 'Moletom', 'Boné'];
export const SIZES = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];

export const DISPONIBILIDADE = [
  { id: 'disponivel', label: 'Disponível' },
  { id: 'pre-venda', label: 'Pré-venda' },
  { id: 'esgotado', label: 'Esgotado' },
];
export const dispLabel = (id) => DISPONIBILIDADE.find((d) => d.id === id)?.label || id;

export const PRODUCT_STATUS = [
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'ativo', label: 'Ativo' },
];

export const AREAS = ['Peito esquerdo', 'Peito central', 'Peito direito', 'Estampa grande (frente)', 'Costas superior', 'Costas central', 'Costas inferior', 'Estampa total', 'Manga esquerda', 'Manga direita', 'Short esquerdo', 'Short direito'];

export const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function parsePrice(s) {
  let t = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function installmentText(p) {
  if (!p.preco || !p.parcelas || p.parcelas < 2) return '';
  return `ou ${p.parcelas}x de ${brl(p.preco / p.parcelas)}${p.semJuros !== false ? ' sem juros' : ''}`;
}

export const siteURL = (s) => (!s ? '' : /^https?:\/\//i.test(s) ? s : `https://${s}`);
export const instagramURL = (h) => (!h ? '' : /^https?:\/\//i.test(h) ? h : `https://instagram.com/${h.replace(/^@/, '').trim()}`);
export function whatsappURL(n) {
  const d = String(n || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d}` : '';
}

// Link que o cliente usa para comprar: link cadastrado ou, sem ele, o WhatsApp da marca.
export function buyLink(p, brand) {
  if (p.linkCompra) return { url: siteURL(p.linkCompra), label: 'COMPRAR ESTA PEÇA' };
  const wa = whatsappURL(brand?.whatsapp);
  if (wa) return { url: `${wa}?text=${encodeURIComponent(`Olá! Tenho interesse na peça ${p.nome}${p.sku ? ` (${p.sku})` : ''}.`)}`, label: 'COMPRAR PELO WHATSAPP' };
  return null;
}

export const DEFAULT_BRAND = {
  brandName: 'EKKLESIA',
  tagline: '',
  apresentacao: '',
  site: '',
  instagram: '',
  whatsapp: '',
};
