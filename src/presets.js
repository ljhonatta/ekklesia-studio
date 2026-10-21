// Modelos de descrição prontos (tecido, modelagem, estampa, cuidados, produção).
// Ficam em settings 'presets' e são editáveis em Configurações.
import { getSetting, setSetting } from './db.js';

export const PRESET_GROUPS = [
  { id: 'tecido', label: 'Tecido / malha' },
  { id: 'modelagem', label: 'Modelagem' },
  { id: 'estampa', label: 'Estampa' },
  { id: 'cuidados', label: 'Cuidados' },
  { id: 'producao', label: 'Produção e pagamento' },
];

// Pontos de partida: ajuste gramatura e textos ao que o seu fornecedor entrega.
export const DEFAULT_PRESETS = [
  { id: 't1', grupo: 'tecido', nome: 'Algodão penteado 30.1', material: '100% algodão penteado fio 30.1', gramatura: '160', texto: 'Malha 100% algodão penteado fio 30.1: leve, macia e respirável, ideal para o dia a dia.' },
  { id: 't2', grupo: 'tecido', nome: 'Algodão premium 24.1', material: '100% algodão penteado fio 24.1', gramatura: '180', texto: 'Malha premium 100% algodão fio 24.1: toque encorpado, ótimo caimento e alta durabilidade.' },
  { id: 't3', grupo: 'tecido', nome: 'Algodão pesado (heavyweight)', material: '100% algodão fio 20.1', gramatura: '230', texto: 'Malha pesada 100% algodão (heavyweight): estrutura firme, caimento streetwear e não deforma.' },
  { id: 't4', grupo: 'tecido', nome: 'Moletom flanelado', material: '50% algodão / 50% poliéster, flanelado', gramatura: '320', texto: 'Moletom flanelado por dentro: quente, macio e confortável.' },
  { id: 't5', grupo: 'tecido', nome: 'Jeans', material: 'Jeans índigo com elastano', gramatura: '', texto: 'Jeans índigo com elastano: resistente, com conforto para o movimento.' },
  { id: 't6', grupo: 'tecido', nome: 'Piquet (polo)', material: 'Malha piquet 50% algodão / 50% poliéster', gramatura: '200', texto: 'Malha piquet: textura clássica de polo, fresca e resistente.' },
  { id: 'm1', grupo: 'modelagem', nome: 'Oversized', texto: 'Modelagem oversized: ombro caído, corpo amplo e mangas mais longas. Prefere mais justo? Escolha um tamanho abaixo do habitual.' },
  { id: 'm2', grupo: 'modelagem', nome: 'Regular', texto: 'Modelagem regular: caimento reto e confortável, fiel ao tamanho.' },
  { id: 'm3', grupo: 'modelagem', nome: 'Babylook', texto: 'Modelagem babylook: corpo acinturado e manga curta ajustada.' },
  { id: 'm4', grupo: 'modelagem', nome: 'Manga longa', texto: 'Manga longa com punho canelado e caimento reto.' },
  { id: 'm5', grupo: 'modelagem', nome: 'Moletom com capuz', texto: 'Moletom com capuz forrado, bolso canguru e punhos canelados.' },
  { id: 'e1', grupo: 'estampa', nome: 'Serigrafia', texto: 'Estampa em serigrafia com tinta de alta durabilidade: cores firmes lavagem após lavagem.' },
  { id: 'e2', grupo: 'estampa', nome: 'DTF', texto: 'Estampa em DTF: toque macio, cores vivas e alta definição.' },
  { id: 'e3', grupo: 'estampa', nome: 'Bordado', texto: 'Detalhe bordado: acabamento premium e relevo que dura.' },
  { id: 'c1', grupo: 'cuidados', nome: 'Cuidados padrão', texto: 'Cuidados: lave do avesso em água fria, não use alvejante e não passe ferro sobre a estampa.' },
  { id: 'p1', grupo: 'producao', nome: 'Pré-venda com entrada', texto: 'Peça em produção: garanta a sua com 50% de entrada via Pix (ou pague o valor total) e receba assim que a produção terminar.' },
];

export async function getPresets() {
  const saved = await getSetting('presets', null);
  return saved || DEFAULT_PRESETS;
}
export const savePresets = (list) => setSetting('presets', list);
