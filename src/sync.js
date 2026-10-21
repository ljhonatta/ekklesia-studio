// Sincronização do Estúdio entre aparelhos via repositório PRIVADO no GitHub.
// Cada registro vira db/<tabela>/<chave>.json; imagens viram blobs/<sha> (uma vez só).
// Merge de 3 vias com o último estado sincronizado (base): mudou só aqui → envia;
// mudou só lá → baixa; mudou nos dois → fica a versão mais recente (updatedAt).
import { db, getSetting } from './db.js';

export const SYNC_TABLES = ['designs', 'versions', 'mockups', 'products', 'productionFiles', 'catalogs', 'catalogItems', 'settings', 'photos'];
const LOCAL_ONLY_SETTINGS = new Set(['lojaToken', 'lojaUltima']);
const STATE_KEY = 'ekk-sync';
const CONF_KEY = 'ekk-sync-conf';

export const getConf = () => ({ repo: 'ljhonatta/ekklesia-studio-dados', branch: 'main', ...JSON.parse(localStorage.getItem(CONF_KEY) || '{}') });
export const setConf = (c) => localStorage.setItem(CONF_KEY, JSON.stringify({ ...getConf(), ...c }));
const getState = () => JSON.parse(localStorage.getItem(STATE_KEY) || '{"base":{}}');
const setState = (s) => localStorage.setItem(STATE_KEY, JSON.stringify(s));

// ---------- status (para a interface) ----------
let status = { state: 'idle', at: null, msg: '' };
const listeners = new Set();
export const onStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
function setStatus(s) { status = { ...status, ...s }; listeners.forEach((fn) => fn(status)); }
export const getStatus = () => status;

// ---------- ids únicos entre aparelhos + marcação de mudanças ----------
let applyingRemote = false;
let timer = 0;
export function installHooks() {
  for (const t of SYNC_TABLES) {
    const table = db.table(t);
    const auto = table.schema.primKey.auto;
    table.hook('creating', function (pk, obj) {
      if (applyingRemote) return undefined;
      if (typeof obj === 'object' && obj && !obj.updatedAt) obj.updatedAt = Date.now();
      schedule();
      if (auto && pk === undefined) return Date.now() * 1000 + Math.floor(Math.random() * 1000);
      return undefined;
    });
    // toda alteração ganha updatedAt (decide conflitos e evita reler o que não mudou)
    table.hook('updating', (mods) => {
      if (applyingRemote) return undefined;
      schedule();
      return mods.updatedAt ? undefined : { updatedAt: Date.now() };
    });
    table.hook('deleting', () => { if (!applyingRemote) schedule(); });
  }
}
export function schedule(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

// ---------- GitHub ----------
async function gh(token, path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || r.statusText;
    const e = new Error(r.status === 401 ? 'Token do GitHub inválido ou expirado.' : r.status === 404 || r.status === 403 ? `Sem acesso ao repositório de dados (${msg}).` : `GitHub: ${msg}`);
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

// limita requisições simultâneas
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---------- serialização ----------
const pathOf = (t, key) => `db/${t}/${encodeURIComponent(String(key))}.json`;
function parsePath(p) {
  const m = p.match(/^db\/([^/]+)\/(.+)\.json$/);
  if (!m) return null;
  const raw = decodeURIComponent(m[2]);
  return { table: m[1], key: m[1] === 'settings' ? raw : (/^\d+$/.test(raw) ? +raw : raw) };
}

// Troca Blobs por referências (chaves ordenadas → texto estável).
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
const stamp = (row) => row?.updatedAt || row?.createdAt || row?.at || 0;

const rowCache = new Map(); // "tabela|chave" -> { stamp, text, sha, blobs }
async function localSnapshot() {
  const files = new Map(); // path -> { sha, text, row, table, key }
  const blobs = new Map(); // sha -> Blob
  for (const t of SYNC_TABLES) {
    const table = db.table(t);
    const pk = table.schema.primKey.keyPath;
    const rows = await table.toArray();
    for (const row of rows) {
      const key = row[pk];
      if (t === 'settings' && LOCAL_ONLY_SETTINGS.has(key)) continue;
      const ck = `${t}|${key}`, st = stamp(row);
      let c = rowCache.get(ck);
      if (!c || !st || c.stamp !== st) {
        const own = new Map();
        const text = JSON.stringify(await encodeValue(row, own));
        c = { stamp: st, text, sha: await gitSha(enc.encode(text)), blobs: own };
        rowCache.set(ck, c);
      }
      c.blobs.forEach((b, sha) => blobs.set(sha, b));
      files.set(pathOf(t, key), { sha: c.sha, text: c.text, row, table: t, key });
    }
  }
  return { files, blobs };
}

// ---------- sincronização ----------
let running = null;
export async function syncNow({ onProgress } = {}) {
  if (running) return running;
  running = (async () => {
    const token = await getSetting('lojaToken', '');
    if (!token) { setStatus({ state: 'off', msg: 'Nuvem desligada (sem token).' }); return { off: true }; }
    if (!navigator.onLine) { setStatus({ state: 'offline', msg: 'Sem internet: salvo neste aparelho.' }); return { offline: true }; }
    setStatus({ state: 'running', msg: 'Sincronizando…' });
    const prog = (m) => { onProgress?.(m); setStatus({ msg: m }); };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await syncOnce(token, prog);
        if (!r.retry) { setStatus({ state: 'ok', at: Date.now(), msg: '' }); return r; }
      }
      throw new Error('Outro aparelho está sincronizando ao mesmo tempo. Tente de novo em instantes.');
    } catch (e) {
      setStatus({ state: 'error', msg: e.message });
      throw e;
    }
  })().finally(() => { running = null; });
  return running;
}

async function syncOnce(token, prog) {
  const { repo, branch } = getConf();
  const R = `/repos/${repo}`;
  prog('Verificando a nuvem…');
  let ref;
  try { ref = await gh(token, `${R}/git/ref/heads/${branch}`); } catch (e) {
    if (e.status === 409) throw new Error(`O repositório ${repo} está vazio: crie nele um primeiro arquivo (ex.: README).`);
    if (e.status === 404) {
      const visible = await gh(token, R).then(() => true).catch(() => false);
      throw new Error(visible
        ? `O repositório ${repo} não tem o ramo "${branch}".`
        : `O token não tem acesso ao repositório ${repo}. No GitHub, edite o token e adicione esse repositório (Contents: Read and write).`);
    }
    throw e;
  }
  const head = await gh(token, `${R}/git/commits/${ref.object.sha}`);
  const tree = await gh(token, `${R}/git/trees/${head.tree.sha}?recursive=1`);
  const remote = new Map(tree.tree.filter((x) => x.type === 'blob' && (x.path.startsWith('db/') || x.path.startsWith('blobs/'))).map((x) => [x.path, x.sha]));
  const state = getState();
  const base = state.base || {};
  prog('Lendo os dados deste aparelho…');
  const { files: local, blobs: localBlobs } = await localSnapshot();

  const paths = new Set([...local.keys(), ...[...remote.keys()].filter((p) => p.startsWith('db/')), ...Object.keys(base)]);
  const toPush = []; // { path, text } ou { path, del: true }
  const toPull = []; // { path, sha } ou { path, del: true }
  const conflicts = [];
  for (const p of paths) {
    if (!parsePath(p)) continue;
    const L = local.get(p)?.sha, Rs = remote.get(p), B = base[p];
    if (L === Rs) continue;
    const lChanged = L !== B, rChanged = Rs !== B;
    if (lChanged && !rChanged) toPush.push(L ? { path: p, text: local.get(p).text } : { path: p, del: true });
    else if (rChanged && !lChanged) toPull.push(Rs ? { path: p, sha: Rs } : { path: p, del: true });
    else conflicts.push(p);
  }
  // conflito: vence a versão mais recente; apagado x editado → fica o editado
  for (const p of conflicts) {
    const L = local.get(p), Rs = remote.get(p);
    if (!L) { toPull.push({ path: p, sha: Rs }); continue; }
    if (!Rs) { toPush.push({ path: p, text: L.text }); continue; }
    const rr = JSON.parse(new TextDecoder().decode(fromB64((await gh(token, `${R}/git/blobs/${Rs}`)).content)));
    if (stamp(rr) > stamp(L.row)) toPull.push({ path: p, sha: Rs, row: rr }); else toPush.push({ path: p, text: L.text });
  }

  // ---- baixar ----
  if (toPull.length) {
    const pulled = [];
    let n = 0;
    await pool(toPull.filter((x) => !x.del), 4, async (x) => {
      prog(`Baixando da nuvem ${++n} de ${toPull.length}…`);
      const row = x.row || JSON.parse(new TextDecoder().decode(fromB64((await gh(token, `${R}/git/blobs/${x.sha}`)).content)));
      pulled.push({ ...x, row });
    });
    const need = new Set();
    for (const x of pulled) for (const ref2 of collectBlobRefs(x.row)) if (!localBlobs.has(ref2.__blob)) need.add(ref2.__blob);
    const got = new Map(localBlobs);
    n = 0;
    await pool([...need], 4, async (sha) => {
      prog(`Baixando imagens ${++n} de ${need.size}…`);
      got.set(sha, fromB64((await gh(token, `${R}/git/blobs/${sha}`)).content));
    });
    applyingRemote = true;
    try {
      await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
        for (const x of pulled) {
          const { table } = parsePath(x.path);
          await db.table(table).put(decodeValue(x.row, (sha) => got.get(sha)));
        }
        for (const x of toPull.filter((y) => y.del)) {
          const { table, key } = parsePath(x.path);
          await db.table(table).delete(key);
        }
      });
    } finally { applyingRemote = false; }
  }

  // ---- enviar ----
  const newBase = Object.fromEntries([...remote].filter(([p]) => p.startsWith('db/')));
  if (toPush.length) {
    const entries = [];
    const blobNeeded = new Set();
    for (const x of toPush) if (!x.del) for (const r2 of collectBlobRefs(JSON.parse(x.text))) if (!remote.has(`blobs/${r2.__blob}`)) blobNeeded.add(r2.__blob);
    let n = 0;
    await pool([...blobNeeded], 4, async (sha) => {
      prog(`Enviando imagens ${++n} de ${blobNeeded.size}…`);
      const bytes = new Uint8Array(await localBlobs.get(sha).arrayBuffer());
      const b = await gh(token, `${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: toB64(bytes), encoding: 'base64' }) });
      entries.push({ path: `blobs/${sha}`, mode: '100644', type: 'blob', sha: b.sha });
    });
    n = 0;
    await pool(toPush, 4, async (x) => {
      prog(`Enviando registros ${++n} de ${toPush.length}…`);
      if (x.del) { if (remote.has(x.path)) entries.push({ path: x.path, mode: '100644', type: 'blob', sha: null }); return; }
      const b = await gh(token, `${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: toB64(enc.encode(x.text)), encoding: 'base64' }) });
      entries.push({ path: x.path, mode: '100644', type: 'blob', sha: b.sha });
    });
    if (entries.length) {
      prog('Gravando na nuvem…');
      const t2 = await gh(token, `${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }) });
      const c = await gh(token, `${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Sincroniza ${toPush.length} registro(s)`, tree: t2.sha, parents: [head.sha] }) });
      try {
        await gh(token, `${R}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
      } catch (e) {
        if (e.status === 422) return { retry: true }; // outro aparelho gravou antes: recomeça
        throw e;
      }
      for (const e of entries) if (e.path.startsWith('db/')) { if (e.sha) newBase[e.path] = e.sha; else delete newBase[e.path]; }
    }
  }
  for (const x of toPull) { if (x.del) delete newBase[x.path]; }
  setState({ base: newBase, at: Date.now() });
  if (toPull.length) window.dispatchEvent(new CustomEvent('data-synced', { detail: { pulled: toPull.length } }));
  return { pushed: toPush.length, pulled: toPull.length };
}

// Agenda sincronizações: ao abrir, ao voltar para a aba e periodicamente.
export function startAutoSync() {
  installHooksOnce();
  syncNow().catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (status.at || 0) > 30000) syncNow().catch(() => {}); });
  window.addEventListener('online', () => syncNow().catch(() => {}));
  setInterval(() => { if (document.visibilityState === 'visible') syncNow().catch(() => {}); }, 120000);
}
let hooked = false;
export function installHooksOnce() { if (!hooked) { hooked = true; installHooks(); } }
