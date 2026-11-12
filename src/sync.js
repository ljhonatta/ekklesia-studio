// Nuvem do Estúdio (nova): registros no Firebase (Firestore), imagens no repositório
// PRIVADO do GitHub (blobs/<sha>, só acrescenta, nunca conflita).
// Regra única: cada registro tem a hora da última mudança ("at"); a mais recente vence,
// em qualquer aparelho. Apagar grava um aviso de apagado com a hora: um aparelho com
// a versão antiga não consegue trazer o item de volta.
import { db, getSetting } from './db.js';
import * as F from './cloud-fb.js';

export const SYNC_TABLES = ['designs', 'versions', 'mockups', 'products', 'productionFiles', 'catalogs', 'catalogItems', 'settings', 'photos'];
const LOCAL_ONLY_SETTINGS = new Set(['lojaToken', 'lojaUltima', 'openaiKey']);
const STATE_KEY = 'ekk-nuvem';      // { v, cursor }
const PEND_KEY = 'ekk-nuvem-pend';  // mudanças daqui ainda não enviadas: { id: { at, del, n } }
const FALTA_KEY = 'ekk-nuvem-falta'; // chegaram da nuvem mas faltou imagem: tentar de novo
const DEV_KEY = 'ekk-nuvem-dev';
const CONF_KEY = 'ekk-sync-conf';

export const getConf = () => ({ repo: 'ljhonatta/ekklesia-studio-dados', branch: 'main', ...JSON.parse(localStorage.getItem(CONF_KEY) || '{}') });
export const setConf = (c) => localStorage.setItem(CONF_KEY, JSON.stringify({ ...getConf(), ...c }));
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const getState = () => lsGet(STATE_KEY, {});
const setState = (p) => lsSet(STATE_KEY, { ...getState(), ...p });
const device = () => { let d = localStorage.getItem(DEV_KEY); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, d); } return d; };

// ---------- status (para a interface) ----------
let status = { state: 'idle', at: null, msg: '' };
const listeners = new Set();
export const onStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(s) { status = { ...status, ...s }; listeners.forEach((fn) => fn(status)); }
export const getStatus = () => status;

// ---------- chaves ----------
const idOf = (t, key) => `${t}~${encodeURIComponent(String(key))}`;
function parseId(id) {
  const i = id.indexOf('~');
  if (i < 0) return null;
  const t = id.slice(0, i), raw = decodeURIComponent(id.slice(i + 1));
  if (!SYNC_TABLES.includes(t)) return null;
  return { table: t, key: t === 'settings' ? raw : (/^\d+$/.test(raw) ? +raw : raw) };
}
const stamp = (row) => row?.updatedAt || row?.createdAt || row?.at || 0;
const localOnly = (t, key) => t === 'settings' && LOCAL_ONLY_SETTINGS.has(key);

// ---------- fila de mudanças daqui ----------
let seq = Date.now();
function marcar(t, key, del) {
  if (localOnly(t, key)) return;
  const p = lsGet(PEND_KEY, {});
  p[idOf(t, key)] = { at: Date.now(), del: !!del, n: ++seq };
  lsSet(PEND_KEY, p);
  schedule();
}

// Gravações vindas da nuvem acontecem numa transação marcada: não voltam para a fila.
const isRemoteTx = () => !!db.constructor.currentTransaction?.__remote;
let timer = 0;
export function installHooks() {
  for (const t of SYNC_TABLES) {
    const table = db.table(t);
    const auto = table.schema.primKey.auto;
    const kp = table.schema.primKey.keyPath;
    table.hook('creating', function (pk, obj) {
      if (isRemoteTx()) return undefined;
      if (typeof obj === 'object' && obj && !obj.updatedAt) obj.updatedAt = Date.now();
      // ids únicos entre aparelhos (nunca 1, 2, 3… que colidem)
      const novo = auto && pk === undefined ? Date.now() * 1000 + Math.floor(Math.random() * 1000) : undefined;
      const key = novo ?? pk ?? (kp && obj?.[kp]);
      if (key !== undefined) marcar(t, key, false);
      return novo;
    });
    table.hook('updating', (mods, pk) => {
      if (isRemoteTx()) return undefined;
      marcar(t, pk, false);
      return mods.updatedAt ? undefined : { updatedAt: Date.now() };
    });
    table.hook('deleting', (pk) => { if (!isRemoteTx()) marcar(t, pk, true); });
  }
}
export function schedule(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

// ---------- imagens no GitHub ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function gh(token, path, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await ghOnce(token, path, opts); } catch (e) {
      const passageira = !e.status || e.status >= 500 || e.status === 429;
      if (!passageira || attempt >= 3) throw e;
      await wait(1000 * 2 ** attempt);
    }
  }
}
async function ghOnce(token, path, opts = {}) {
  let r;
  try {
    r = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch { throw new Error('Sem conexão com o GitHub agora.'); }
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || r.statusText;
    const e = new Error(r.status === 401 ? 'Token do GitHub inválido ou expirado (imagens).' : r.status === 404 || r.status === 403 ? `Sem acesso ao repositório das imagens (${msg}).` : `GitHub: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
const enc = new TextEncoder();
async function gitSha(bytes) {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0));
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

let known = null; // shas já guardados em blobs/
async function loadKnown(token) {
  if (known) return known;
  const { repo, branch } = getConf(), R = `/repos/${repo}`;
  const ref = await gh(token, `${R}/git/ref/heads/${branch}`);
  const head = await gh(token, `${R}/git/commits/${ref.object.sha}`);
  const tree = await gh(token, `${R}/git/trees/${head.tree.sha}?recursive=1`);
  known = new Set(tree.tree.filter((x) => x.type === 'blob' && x.path.startsWith('blobs/')).map((x) => x.path.slice(6)));
  return known;
}
// Sobe as imagens que faltam num commit só (só acrescenta: se outro aparelho gravou junto, refaz por cima).
async function uploadBlobs(token, blobs, prog) {
  if (!blobs.size) return;
  const have = await loadKnown(token);
  const falta = [...blobs.keys()].filter((s) => !have.has(s));
  if (!falta.length) return;
  const { repo, branch } = getConf(), R = `/repos/${repo}`;
  const entries = [];
  let n = 0;
  await pool(falta, 4, async (sha) => {
    prog?.(`Enviando imagens ${++n} de ${falta.length}…`);
    const b = await gh(token, `${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: toB64(new Uint8Array(await blobs.get(sha).arrayBuffer())), encoding: 'base64' }) });
    entries.push({ path: `blobs/${sha}`, mode: '100644', type: 'blob', sha: b.sha });
  });
  for (let attempt = 0; ; attempt++) {
    const ref = await gh(token, `${R}/git/ref/heads/${branch}`);
    const head = await gh(token, `${R}/git/commits/${ref.object.sha}`);
    const t2 = await gh(token, `${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }) });
    const c = await gh(token, `${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Imagens do Estúdio (${entries.length})`, tree: t2.sha, parents: [ref.object.sha] }) });
    try { await gh(token, `${R}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) }); break; } catch (e) {
      if (attempt >= 6 || !(e.status === 422 || e.status === 409 || !e.status || e.status >= 500)) throw e;
      await wait(500 + Math.random() * 1500);
    }
  }
  falta.forEach((s) => have.add(s));
}
async function fetchBlob(token, sha) {
  const { repo } = getConf();
  return fromB64((await gh(token, `/repos/${repo}/git/blobs/${sha}`)).content);
}

// ---------- serialização ----------
async function encodeValue(v, blobs) {
  if (v instanceof Blob) {
    const sha = await gitSha(new Uint8Array(await v.arrayBuffer()));
    blobs.set(sha, v);
    return { __blob: sha, type: v.type };
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => encodeValue(x, blobs)));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = await encodeValue(v[k], blobs);
    return out;
  }
  return v;
}
function collectBlobRefs(v, acc = []) {
  if (Array.isArray(v)) v.forEach((x) => collectBlobRefs(x, acc));
  else if (v && typeof v === 'object') { if (typeof v.__blob === 'string') acc.push(v); else Object.values(v).forEach((x) => collectBlobRefs(x, acc)); }
  return acc;
}
function decodeValue(v, get) {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, get));
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string') return new Blob([get(v.__blob)], { type: v.type || '' });
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x, get)]));
  }
  return v;
}

// ---------- uma coisa por vez (enviar e receber nunca se cruzam) ----------
let chain = Promise.resolve();
const exclusive = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

// ---------- receber ----------
// Aplica o que veio da nuvem: só o que for mais novo que o daqui (e que não esteja na fila daqui, mais novo).
async function applyRemote(docs, prog) {
  const token = await getSetting('lojaToken', '');
  const cand = [];
  for (const d of docs) {
    const pk = parseId(d.id);
    if (!pk || localOnly(pk.table, pk.key)) continue;
    const p = lsGet(PEND_KEY, {})[d.id];
    if (p && p.at >= (d.at || 0)) continue; // a mudança daqui é mais nova: vai subir
    const local = await db.table(pk.table).get(pk.key);
    if (d.del) { if (local && stamp(local) <= d.at) cand.push({ d, pk, local }); }
    else if (!local || stamp(local) < d.at) cand.push({ d, pk, local, row: JSON.parse(d.row) });
  }
  if (!cand.length) return 0;
  // imagens: reaproveita as que o registro daqui já tem; o resto vem do GitHub
  const got = new Map(), need = new Set();
  for (const c of cand) {
    if (!c.row) continue;
    if (c.local) await encodeValue(c.local, got);
    for (const r of collectBlobRefs(c.row)) if (!got.has(r.__blob)) need.add(r.__blob);
  }
  const falhou = new Set();
  let n = 0;
  if (need.size && !token) need.forEach((s) => falhou.add(s));
  else {
    await pool([...need], 4, async (sha) => {
      prog?.(`Baixando imagens ${++n} de ${need.size}…`);
      try { got.set(sha, await fetchBlob(token, sha)); } catch { falhou.add(sha); }
    });
  }
  const falta = lsGet(FALTA_KEY, {});
  let aplicados = 0;
  await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async (tx) => {
    tx.__remote = true;
    for (const c of cand) {
      const p = lsGet(PEND_KEY, {})[c.d.id];
      if (p && p.at >= (c.d.at || 0)) continue; // editado aqui enquanto baixava
      const now = await db.table(c.pk.table).get(c.pk.key);
      if (c.d.del) {
        if (now && stamp(now) <= c.d.at) { await db.table(c.pk.table).delete(c.pk.key); aplicados++; }
        delete falta[c.d.id];
        continue;
      }
      if (now && stamp(now) >= c.d.at) { delete falta[c.d.id]; continue; }
      if (collectBlobRefs(c.row).some((r) => falhou.has(r.__blob))) { falta[c.d.id] = c.d; continue; }
      const row = decodeValue(c.row, (sha) => got.get(sha));
      if (c.pk.table === 'products' && row.slug) { // mesmo endereço criado em dois aparelhos: o daqui ganha "-2"
        const clash = await db.products.where('slug').equals(row.slug).first();
        if (clash && clash.id !== row.id) {
          let i = 2, slug;
          do slug = `${row.slug}-${i++}`; while (await db.products.where('slug').equals(slug).first());
          const linkCompra = clash.linkCompra?.includes('/#/produto/') ? clash.linkCompra.replace(/[^/]+$/, encodeURIComponent(slug)) : clash.linkCompra;
          await db.products.put({ ...clash, slug, linkCompra, updatedAt: Date.now() });
          tx.__fix = [...(tx.__fix || []), clash.id];
        }
      }
      await db.table(c.pk.table).put(row);
      delete falta[c.d.id];
      aplicados++;
    }
    for (const id of tx.__fix || []) marcar('products', id, false); // o endereço novo sobe
  });
  lsSet(FALTA_KEY, falta);
  if (aplicados) window.dispatchEvent(new CustomEvent('data-synced', { detail: { pulled: aplicados } }));
  return aplicados;
}

// ---------- enviar ----------
async function push(prog) {
  const pend = lsGet(PEND_KEY, {});
  const ids = Object.keys(pend);
  if (!ids.length) return 0;
  const token = await getSetting('lojaToken', '');
  let enviados = 0;
  for (let i = 0; i < ids.length; i += 25) {
    const lote = [];
    const blobs = new Map();
    for (const id of ids.slice(i, i + 25)) {
      const pk = parseId(id);
      if (!pk || localOnly(pk.table, pk.key)) { tirarDaFila(id, pend[id].n); continue; }
      const row = await db.table(pk.table).get(pk.key);
      if (row) {
        const own = new Map();
        const text = JSON.stringify(await encodeValue(row, own));
        own.forEach((b, s) => blobs.set(s, b));
        lote.push({ id, n: pend[id].n, t: pk.table, k: String(pk.key), at: stamp(row) || pend[id].at, row: text });
      } else lote.push({ id, n: pend[id].n, t: pk.table, k: String(pk.key), at: Math.max(pend[id].at, 1), del: true });
    }
    if (!lote.length) continue;
    if (blobs.size) {
      if (!token) throw new Error('Cole o token do GitHub (Configurações): as imagens novas precisam dele para subir.');
      await uploadBlobs(token, blobs, prog);
    }
    prog?.(`Enviando ${Math.min(i + 25, ids.length)} de ${ids.length}…`);
    const perdeu = await F.writeIfNewer(lote, device());
    for (const it of lote) tirarDaFila(it.id, it.n);
    enviados += lote.length - perdeu.length;
    if (perdeu.length) await applyRemote(perdeu, prog); // a nuvem tinha uma mais nova: fica a da nuvem
  }
  return enviados;
}
// sai da fila só se não mudou de novo enquanto subia
function tirarDaFila(id, n) {
  const p = lsGet(PEND_KEY, {});
  if (p[id] && p[id].n === n) { delete p[id]; lsSet(PEND_KEY, p); }
}

// ---------- primeira vez neste aparelho ----------
async function primeiraVez(prog) {
  let meta = await F.getMeta();
  if (!meta) meta = await F.claimMeta(device());
  // a mudança é deste aparelho (ou ficou parada mais de 10 min: este assume)
  if (meta.mine || (!meta.pronto && (meta.dev === device() || Date.now() - meta.migratedAt > 600000))) {
    {
      // este aparelho faz a mudança: puxa o que estava na nuvem antiga e sobe tudo
      prog('Mudando para a nuvem nova: lendo a nuvem antiga…');
      try { const L = await import('./sync-legacy.js'); await L.syncNow({ onProgress: prog }); } catch (e) { console.warn('nuvem antiga', e); }
      const p = lsGet(PEND_KEY, {});
      for (const t of SYNC_TABLES) {
        const pkp = db.table(t).schema.primKey.keyPath;
        for (const row of await db.table(t).toArray()) if (!localOnly(t, row[pkp])) p[idOf(t, row[pkp])] = { at: stamp(row) || Date.now(), del: false, n: ++seq };
      }
      lsSet(PEND_KEY, p);
      await push(prog);
      await F.setMeta({ pronto: true, prontoEm: Date.now(), dev: device() });
      return;
    }
  }
  // outro aparelho fez a mudança: espera terminar e fica igual à nuvem
  while (!meta.pronto) {
    if (Date.now() - meta.migratedAt > 600000) return primeiraVez(prog); // parou no meio: este assume
    prog('Outro aparelho está subindo os dados para a nuvem nova…'); await wait(8000); meta = await F.getMeta();
  }
  prog('Trazendo os dados da nuvem…');
  const all = (await F.getAll()).filter((d) => parseId(d.id));
  await applyRemote(all, prog);
  const naNuvem = new Set(all.map((d) => d.id));
  const pend = lsGet(PEND_KEY, {});
  const sobrando = [];
  for (const t of SYNC_TABLES) {
    const pkp = db.table(t).schema.primKey.keyPath;
    for (const row of await db.table(t).toArray()) {
      const id = idOf(t, row[pkp]);
      if (naNuvem.has(id) || pend[id] || localOnly(t, row[pkp])) continue;
      if (stamp(row) > meta.migratedAt) marcar(t, row[pkp], false); // criado aqui depois da mudança: sobe
      else sobrando.push([t, row[pkp]]); // ficou para trás (apagado em outro aparelho): sai
    }
  }
  if (sobrando.length) {
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async (tx) => {
      tx.__remote = true;
      for (const [t, k] of sobrando) await db.table(t).delete(k);
    });
    window.dispatchEvent(new CustomEvent('data-synced', { detail: { pulled: sobrando.length } }));
  }
  setState({ cursor: Math.max(0, ...all.map((d) => d.srv || 0)) });
}

// ---------- ligar / ouvir ----------
let unlisten = null, ligada = false, failures = 0, starting = null;
function ouvir() {
  unlisten?.();
  const desde = (getState().cursor || 0) - 120000; // folga: reaplicar é inofensivo
  unlisten = F.listen(desde, (docs) => {
    exclusive(async () => {
      await applyRemote(docs);
      const max = Math.max(getState().cursor || 0, ...docs.map((d) => d.srv || 0));
      setState({ cursor: max });
      setStatus({ state: 'ok', at: Date.now(), msg: '' });
    }).catch((e) => setStatus({ state: 'error', msg: e.message }));
  }, (e) => {
    setStatus({ state: 'error', msg: e.code === 'permission-denied' ? 'Sem permissão na nuvem: entre com o e-mail da marca (confirmado).' : e.message });
    unlisten = null;
    setTimeout(() => { if (ligada) ouvir(); }, 30000);
  });
}
async function ligar() {
  if (starting) return starting;
  starting = exclusive(async () => {
    setStatus({ state: 'running', msg: 'Conectando à nuvem…' });
    const prog = (m) => setStatus({ state: 'running', msg: m });
    if (!getState().v) { await primeiraVez(prog); setState({ v: 1 }); }
    ligada = true;
    ouvir();
  }).finally(() => { starting = null; });
  return starting;
}
function desligar(msg) {
  ligada = false;
  unlisten?.(); unlisten = null;
  setStatus({ state: 'off', msg });
}

let running = null;
export async function syncNow({ onProgress } = {}) {
  if (!F.isAdmin(F.user())) {
    setStatus({ state: 'off', msg: 'Entre com o e-mail da marca em Configurações › Nuvem.' });
    return { off: true };
  }
  if (!navigator.onLine) { setStatus({ state: 'offline', msg: 'Sem internet: salvo neste aparelho.' }); return { offline: true }; }
  if (running) return running;
  running = (async () => {
    const prog = (m) => { onProgress?.(m); setStatus({ state: 'running', msg: m }); };
    try {
      if (!ligada) await ligar();
      const r = await exclusive(async () => {
        const pushed = await push(prog);
        // o que chegou sem imagem: tenta de novo
        const falta = Object.values(lsGet(FALTA_KEY, {}));
        const pulled = falta.length ? await applyRemote(falta, prog) : 0;
        return { pushed, pulled };
      });
      failures = 0;
      setStatus({ state: 'ok', at: Date.now(), msg: '' });
      return r;
    } catch (e) {
      failures++;
      setTimeout(() => syncNow().catch(() => {}), Math.min(300000, 15000 * 2 ** (failures - 1)));
      setStatus({ state: failures > 2 ? 'error' : 'running', msg: failures > 2 ? e.message : 'Nuvem instável, tentando de novo…' });
      throw e;
    }
  })().finally(() => { running = null; });
  return running;
}

export function startAutoSync() {
  installHooksOnce();
  F.onUser((u) => {
    if (F.isAdmin(u)) syncNow().catch(() => {});
    else desligar(u ? 'Confirme o e-mail da marca para ligar a nuvem.' : 'Entre com o e-mail da marca em Configurações › Nuvem.');
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ligada) syncNow().catch(() => {}); });
  window.addEventListener('online', () => { if (ligada) ouvir(); syncNow().catch(() => {}); });
  setInterval(() => { if (ligada && Object.keys(lsGet(PEND_KEY, {})).length) syncNow().catch(() => {}); }, 60000);
}
let hooked = false;
export function installHooksOnce() { if (!hooked) { hooked = true; installHooks(); } }
export const pendentes = () => Object.keys(lsGet(PEND_KEY, {})).length;
