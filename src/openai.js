// OpenAI direto do navegador: a chave fica só neste aparelho (settings 'openaiKey',
// fora da nuvem e dos backups). Imagens com GPT Image; textos com GPT.
import { getSetting, setSetting } from './db.js';

export const getKey = () => getSetting('openaiKey', '');
export const getIA = async () => ({ imageModel: '', textModel: '', ...(await getSetting('ia', {})) });
export const saveIA = async (v) => setSetting('ia', { ...(await getIA()), ...v });

// Preferência: o mais novo disponível na conta.
const IMAGE_PREF = [/^gpt-image-2$/, /^gpt-image-1\.5$/, /^gpt-image-1$/, /^gpt-image/];
const TEXT_PREF = [/^gpt-5\.\d+$/, /^gpt-5$/, /^gpt-5-mini$/, /^gpt-4\.1$/, /^gpt-4o$/];
const pick = (ids, prefs) => { for (const re of prefs) { const hit = ids.filter((id) => re.test(id)).sort().reverse()[0]; if (hit) return hit; } return ''; };

async function call(path, { json, form, method = 'POST' } = {}) {
  const key = await getKey();
  if (!key) throw new Error('Cole a chave da OpenAI em Configurações → Inteligência artificial.');
  const r = await fetch(`https://api.openai.com/v1${path}`, {
    method: json || form ? method : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || r.statusText;
    if (r.status === 401) throw new Error('Chave da OpenAI inválida ou revogada.');
    if (r.status === 429) throw new Error(/quota|billing/i.test(msg) ? 'Sem crédito na conta da OpenAI: adicione saldo em platform.openai.com → Billing.' : 'Muitos pedidos seguidos. Espere um pouco e tente de novo.');
    if (/verif/i.test(msg)) throw new Error('A OpenAI pede para verificar a organização antes de usar o GPT Image: platform.openai.com → Settings → Organization → Verify. Leva alguns minutos.');
    const e = new Error(`OpenAI: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// Testa a chave e escolhe os melhores modelos da conta.
export async function connect() {
  const { data } = await call('/models');
  const ids = data.map((m) => m.id);
  const images = ids.filter((id) => /^gpt-image/.test(id)).sort().reverse();
  const texts = ids.filter((id) => /^(gpt-5|gpt-4\.1|gpt-4o)/.test(id) && !/audio|realtime|search|transcribe|tts|image/.test(id)).sort().reverse();
  const ia = await getIA();
  const next = {
    imageModel: images.includes(ia.imageModel) ? ia.imageModel : pick(ids, IMAGE_PREF),
    textModel: texts.includes(ia.textModel) ? ia.textModel : pick(ids, TEXT_PREF),
    images, texts,
  };
  await saveIA(next);
  return next;
}

const b64Blob = (b64, type = 'image/png') => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

/**
 * Gera imagens. Com referências, usa /images/edits (a IA "olha" as imagens).
 * opts: { prompt, refs: Blob[], size: '1024x1024'|'1024x1536'|'1536x1024'|'auto', quality: 'low'|'medium'|'high', n, transparent }
 */
export async function generateImages({ prompt, refs = [], size = '1024x1024', quality = 'high', n = 1, transparent = false }) {
  const { imageModel } = await getIA();
  const model = imageModel || 'gpt-image-1';
  const extra = { size, quality, n, ...(transparent ? { background: 'transparent', output_format: 'png' } : {}) };
  let res;
  if (!refs.length) res = await call('/images/generations', { json: { model, prompt, ...extra } });
  else {
    const send = async (fidelity) => {
      const f = new FormData();
      f.append('model', model);
      f.append('prompt', prompt);
      refs.slice(0, 10).forEach((b, i) => f.append('image[]', b, `ref-${i}.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`));
      for (const [k, v] of Object.entries(extra)) f.append(k, String(v));
      if (fidelity) f.append('input_fidelity', 'high');
      return call('/images/edits', { form: f });
    };
    // input_fidelity preserva rosto/arte das referências; nem todo modelo aceita
    try { res = await send(true); } catch (e) { if (e.status === 400 && /fidelity/i.test(e.message)) res = await send(false); else throw e; }
  }
  return res.data.map((d) => b64Blob(d.b64_json, transparent ? 'image/png' : 'image/png'));
}

// Transforma a ideia solta num pedido detalhado para o gerador de imagens.
export async function improvePrompt(idea, { mode = 'arte', refs = 0 } = {}) {
  const { textModel } = await getIA();
  const alvo = {
    arte: 'uma ARTE DE ESTAMPA para camiseta (fundo transparente, arte isolada e centralizada, sem camiseta nem pessoa, contornos limpos, pronta para DTF/serigrafia, sem texto pequeno demais)',
    mockup: 'uma FOTO REALISTA de produto/modelo vestindo a peça (luz de estúdio ou rua, tecido com textura real, estampa aplicada com caimento natural, enquadramento de e-commerce)',
    livre: 'uma imagem livre (post, capa, campanha)',
  }[mode] || 'uma imagem';
  const r = await call('/chat/completions', {
    json: {
      model: textModel || 'gpt-4o',
      messages: [
        { role: 'system', content: `Você é diretor de arte da EKKLESIA, marca de streetwear cristão premium (preto, off-white e dourado; tipografia forte; referências bíblicas com respeito). Reescreva a ideia do usuário como um pedido detalhado para um gerador de imagens criar ${alvo}. Descreva composição, estilo, cores, tipografia (escreva entre aspas qualquer texto que deva aparecer, com a grafia exata), iluminação e acabamento. ${refs ? `O usuário anexou ${refs} imagem(ns) de referência: diga como usá-las (ex.: "use a referência 1 como base de estilo").` : ''} Responda só com o pedido, em português, em até 120 palavras.` },
        { role: 'user', content: idea },
      ],
    },
  });
  return r.choices?.[0]?.message?.content?.trim() || idea;
}

// Deixa um mockup montado com cara de foto real, sem mudar a arte.
export async function realisticMockup(blob, { extra = '' } = {}) {
  const prompt = 'Transforme esta montagem em uma foto real de produto. Mantenha EXATAMENTE a mesma estampa (desenho, letras, cores, tamanho e posição), a mesma peça, a mesma pessoa, pose, enquadramento e fundo. Só deixe a estampa com aparência de tinta aplicada no tecido: acompanhando dobras, sombras e textura da malha, com luz natural. Não acrescente nada.' + (extra ? ` ${extra}` : '');
  const [out] = await generateImages({ prompt, refs: [blob], size: 'auto', quality: 'high', n: 1 });
  return out;
}
