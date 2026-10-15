// Telas da Fase 2: já no menu para mostrar o fluxo completo.
import { pageHead } from '../ui.js';

const page = (eyebrow, title, lede, items) => ({
  render(el) {
    el.innerHTML = `
      ${pageHead({ eyebrow, title, lede })}
      <div class="panel upcoming">
        <p class="eyebrow">Chega na Fase 2</p>
        <ul class="bullets">${items.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>`;
  },
});

export const produtos = page('Gerenciamento', 'Produtos',
  'Cada produto liga design, arquivo de produção, mockups, catálogo e link de venda.',
  ['Ficha completa: nome, SKU, categoria, tecido, gramatura, cores e tamanhos (PP a XG)', 'Preço, parcelamento, disponibilidade e link de compra', 'Página própria do produto com botão COMPRAR AGORA']);

export const producao = page('Arquivo de produção', 'Arquivos de Produção',
  'O arquivo técnico para a gráfica, separado do mockup e da arte.',
  ['PNG transparente em alta resolução, SVG e PDF de produção', 'Dimensões em cm, DPI, cores, área e técnica (DTF, DTG, serigrafia, bordado, sublimação, transfer)', 'Aviso claro quando uma arte de IA ainda não está pronta para produção industrial']);

export const catalogo = page('Catálogo', 'Catálogo digital',
  'Selecione os produtos e o catálogo é montado automaticamente.',
  ['Capa EKKLESIA, apresentação da marca e ficha de cada peça', 'PDF com botões clicáveis: comprar, site, Instagram e WhatsApp', 'QR Code por produto e versão online em /catalogo']);
