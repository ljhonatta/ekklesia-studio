// Ponte entre a nuvem do Estúdio (sync.js) e o Firestore do projeto ekklesia-loja.
// Cada registro do Estúdio é um documento em /estudio/{tabela~chave}:
//   { t, k, at, del, row (texto JSON, imagens como referência), dev, srv }
// "at" é a hora da última mudança (ou do apagar); a mais recente sempre vence.
// Apagar vira { del: true }: o aviso fica guardado e nenhum aparelho traz de volta.
import { fs, onUser, isAdmin, user } from './fb-admin.js';
import {
  collection, doc, query, where, onSnapshot, getDocs, getDoc, runTransaction, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export const COL = 'estudio';
export { onUser, isAdmin, user };

const conv = (d) => { const x = d.data({ serverTimestamps: 'estimate' }); return { ...x, id: d.id, srv: x.srv?.toMillis?.() || 0 }; };

// Mudanças com srv > desde (inclusive as que chegarem depois, ao vivo).
export function listen(desdeMs, onDocs, onErr) {
  const q = query(collection(fs, COL), where('srv', '>', Timestamp.fromMillis(Math.max(0, desdeMs))));
  return onSnapshot(q, (s) => {
    // eco das gravações daqui ainda não confirmadas: chega de novo já confirmado
    const docs = s.docChanges().filter((c) => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites).map((c) => conv(c.doc));
    if (docs.length) onDocs(docs);
  }, onErr);
}

export async function getAll() { return (await getDocs(collection(fs, COL))).docs.map(conv); }
export async function getOne(id) { const s = await getDoc(doc(fs, COL, id)); return s.exists() ? conv(s) : null; }

// Grava só se a versão daqui for mais nova que a da nuvem (lido e gravado juntos).
// Devolve as que perderam, com a versão da nuvem, para aplicar aqui.
export async function writeIfNewer(items, dev) {
  return runTransaction(fs, async (tx) => {
    const refs = items.map((it) => doc(fs, COL, it.id));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const perdeu = [];
    items.forEach((it, i) => {
      const r = snaps[i].exists() ? conv(snaps[i]) : null;
      if (r && (r.at || 0) > it.at) { perdeu.push(r); return; }
      if (r && r.at === it.at && !!r.del === !!it.del && (it.del || r.row === it.row)) return; // igual
      tx.set(refs[i], { t: it.t, k: it.k, at: it.at, del: !!it.del, row: it.del ? null : it.row, dev, srv: serverTimestamp() });
    });
    return perdeu;
  });
}

// Marco da mudança para a nuvem nova: só um aparelho faz a primeira carga.
const META = () => doc(fs, 'interno', 'estudio-nuvem');
export async function getMeta() { const s = await getDoc(META()); return s.exists() ? s.data() : null; }
export async function claimMeta(dev) {
  return runTransaction(fs, async (tx) => {
    const s = await tx.get(META());
    if (s.exists()) return { ...s.data(), mine: false };
    const m = { migratedAt: Date.now(), dev, pronto: false };
    tx.set(META(), m);
    return { ...m, mine: true };
  });
}
export async function setMeta(patch) {
  await runTransaction(fs, async (tx) => { const s = await tx.get(META()); tx.set(META(), { ...(s.exists() ? s.data() : {}), ...patch }); });
}
