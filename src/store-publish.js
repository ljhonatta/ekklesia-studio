// Publica a loja: gera data/loja.json + imagens dos produtos ativos e grava
// tudo num único commit no repositório da loja (GitHub Pages), via API.
// Só envia arquivos que mudaram (compara o hash git de cada arquivo).
import { db, getSetting, setSetting } from './db.js';
import { productImages, toJpegDataURL } from './products.js';
import { getLogo, tinted } from './brand.js';
import { tecLabel, siteURL, instagramURL, whatsappURL, DEFAULT_BRAND } from './data.js';
import { toast, canvasToBlob } from './util.js';

export const DEFAULT_LOJA = {
  repo: 'ljhonatta/ekklesia-loja', branch: 'main', dominio: 'ekklesiastoreide.com.br', auto: false,
  pixChave: '', pixNome: 'EKKLESIA', pixCidade: 'RONDONOPOLIS', whatsapp: '',
  entradaPct: 50, lancDesconto: 40, lancLimite: 50, freteGratisAcima: 299,
  heroTitulo: 'Vista o que você crê', heroDestaque: 'EKKLESIA', heroVersiculo: '"Ide por todo o mundo e pregai o evangelho." — Mc 16:15',
  heroTexto: 'Streetwear cristão premium. Cada peça é uma declaração de fé, feita para ser vestida com propósito.',
  faixa: 'MODA COM PROPÓSITO ✦ IDE POR TODO O MUNDO ✦ PRÉ-VENDA COM 50% DE ENTRADA NO PIX ✦ PRODUÇÃO SOB ENCOMENDA',
  manifesto: 'EKKLESIA não é só uma loja. É um movimento. Cada peça que você veste é uma declaração: você não compra roupa, você veste um propósito.',
  prazoProducao: '',
};

export async function getLoja() { return { ...DEFAULT_LOJA, ...(await getSetting('loja', {})) }; }
export const getToken = () => getSetting('lojaToken', '');

// ---------- GitHub ----------
async function gh(token, path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || r.statusText;
    if (r.status === 401) throw new Error('Token do GitHub inválido ou expirado.');
    if (r.status === 403 || r.status === 404) throw new Error(`Sem acesso ao repositório (${msg}). Confira o token e o nome do repositório.`);
    throw new Error(`GitHub: ${msg}`);
  }
  return r.status === 204 ? null : r.json();
}

async function gitSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const dataURLBytes = (u) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));

export async function testConnection() {
  const loja = await getLoja();
  const token = await getToken();
  if (!token) throw new Error('Cole o token do GitHub primeiro.');
  const repo = await gh(token, `/repos/${loja.repo}`);
  if (!repo.permissions?.push) throw new Error('O token não tem permissão de escrita neste repositório.');
  return repo;
}

// ---------- dados da loja ----------
export async function buildStore(onProgress) {
  const loja = await getLoja();
  const brand = { ...DEFAULT_BRAND, ...(await getSetting('brand', {})) };
  const products = (await db.products.toArray()).filter((p) => p.status === 'ativo' && p.preco);
  const files = new Map(); // path -> Uint8Array
  const items = [];
  let i = 0;
  for (const p of products) {
    onProgress?.(`Preparando ${++i} de ${products.length}: ${p.nome}`);
    const imgs = (await productImages(p)).slice(0, 5);
    const paths = [];
    for (let k = 0; k < imgs.length; k++) {
      const im = await toJpegDataURL(imgs[k].blob, { bg: '#e9e6e0', max: 1400, pad: imgs[k].kind === 'art' ? 160 : 0 });
      const path = `img/p/${p.slug}-${k + 1}.jpg`;
      files.set(path, dataURLBytes(im.url));
      paths.push(path);
    }
    const desconto = p.lancamento ? +(p.lancDesconto ?? loja.lancDesconto) : 0;
    const limite = +(p.lancLimite ?? loja.lancLimite);
    const restam = p.lancamento ? Math.max(0, limite - (+p.lancVendidos || 0)) : null;
    items.push({
      slug: p.slug, sku: p.sku, nome: p.nome, categoria: p.categoria, genero: p.genero || 'Unissex', versiculo: p.versiculo || '',
      descricao: p.descricao || '', material: p.material || '', gramatura: p.gramatura || '', tecnica: tecLabel(p.tecnica),
      cores: p.cores || [], tamanhos: p.tamanhos || [], medidas: p.medidas || {},
      preco: p.preco, disponibilidade: p.disponibilidade,
      lancamento: p.lancamento && restam > 0 ? { desconto, limite, restam, precoLancamento: Math.round(p.preco * (1 - desconto / 100) * 100) / 100 } : null,
      imagens: paths, atualizado: p.updatedAt,
    });
  }
  const logo = await getLogo();
  if (logo) files.set('img/logo.png', new Uint8Array(await (await canvasToBlob(tinted(logo, '#ffffff', 900), 'image/png')).arrayBuffer()));
  const data = {
    geradoEm: new Date().toISOString(),
    marca: { nome: brand.brandName || 'EKKLESIA', frase: brand.tagline || '', apresentacao: brand.apresentacao || '', site: siteURL(brand.site), instagram: instagramURL(brand.instagram), whatsappLink: whatsappURL(loja.whatsapp || brand.whatsapp), logo: logo ? 'img/logo.png' : null },
    loja: {
      pix: { chave: loja.pixChave, nome: loja.pixNome, cidade: loja.pixCidade },
      whatsapp: (loja.whatsapp || brand.whatsapp || '').replace(/\D/g, ''),
      entradaPct: +loja.entradaPct, freteGratisAcima: +loja.freteGratisAcima || 0, prazoProducao: loja.prazoProducao,
      hero: { titulo: loja.heroTitulo, destaque: loja.heroDestaque, versiculo: loja.heroVersiculo, texto: loja.heroTexto, imagem: items.find((x) => x.lancamento)?.imagens[0] || items[0]?.imagens[0] || null },
      faixa: loja.faixa, manifesto: loja.manifesto,
    },
    produtos: items.sort((a, b) => (!!b.lancamento - !!a.lancamento) || (b.atualizado - a.atualizado)),
  };
  files.set('data/loja.json', new TextEncoder().encode(JSON.stringify(data, null, 1)));
  return { files, data };
}

let running = null;
export async function publishStore(onProgress = () => {}) {
  if (running) return running;
  running = (async () => {
    const loja = await getLoja();
    const token = await getToken();
    if (!token) throw new Error('Configure o token do GitHub em Loja online.');
    if (!loja.pixChave) throw new Error('Cadastre a chave Pix em Loja online antes de publicar.');
    const { files, data } = await buildStore(onProgress);
    onProgress('Comparando com a loja publicada…');
    const R = `/repos/${loja.repo}`;
    const ref = await gh(token, `${R}/git/ref/heads/${loja.branch}`);
    const head = await gh(token, `${R}/git/commits/${ref.object.sha}`);
    const tree = await gh(token, `${R}/git/trees/${head.tree.sha}?recursive=1`);
    const remote = new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
    const entries = [];
    let n = 0;
    for (const [path, bytes] of files) {
      const sha = await gitSha(bytes);
      if (remote.get(path) === sha) continue;
      onProgress(`Enviando ${path}…`);
      const blob = await gh(token, `${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: b64(bytes), encoding: 'base64' }) });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      n++;
    }
    // remove imagens de produtos que saíram da loja
    for (const path of remote.keys()) if (path.startsWith('img/p/') && !files.has(path)) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    if (!entries.length) { await setSetting('lojaUltima', { at: Date.now(), produtos: data.produtos.length, mudancas: 0 }); return { changed: 0, produtos: data.produtos.length }; }
    onProgress('Gravando na loja…');
    const newTree = await gh(token, `${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }) });
    const commit = await gh(token, `${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Atualiza produtos pelo EKKLESIA STUDIO (${data.produtos.length} peças)`, tree: newTree.sha, parents: [head.sha] }) });
    await gh(token, `${R}/git/refs/heads/${loja.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    await setSetting('lojaUltima', { at: Date.now(), produtos: data.produtos.length, mudancas: entries.length, commit: commit.sha });
    return { changed: entries.length, produtos: data.produtos.length };
  })().finally(() => { running = null; });
  return running;
}

// Publicação automática depois de salvar um produto (se ligada).
let timer = 0;
export async function autoPublish() {
  const loja = await getLoja();
  if (!loja.auto || !(await getToken()) || !loja.pixChave) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const r = await publishStore();
      toast(r.changed ? `Loja atualizada (${r.produtos} peças). Entra no ar em ~1 min.` : 'Loja já estava atualizada.');
    } catch (e) { toast(`Loja não atualizada: ${e.message}`, 'err'); }
  }, 1500);
}
