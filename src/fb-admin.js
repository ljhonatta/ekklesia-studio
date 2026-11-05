// Firebase da loja (ekklesia-loja) visto pelo administrador: pedidos de todos os
// clientes, custos e estoque internos. Só o e-mail da marca, confirmado, tem acesso
// (as regras do banco garantem isso; aqui é só a interface).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export const ADMINS = ['jhonatta258@gmail.com'];

const app = initializeApp({
  apiKey: 'AIzaSyBsRilnRr--ay_nQhCobwY9tAhlxficYKg',
  authDomain: 'ekklesia-loja.firebaseapp.com',
  projectId: 'ekklesia-loja',
  storageBucket: 'ekklesia-loja.firebasestorage.app',
  messagingSenderId: '189659970433',
  appId: '1:189659970433:web:4616ad777166571aac8680',
}, 'admin');
const auth = getAuth(app);
auth.languageCode = 'pt';
const fs = getFirestore(app);

const MSG = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Ainda não existe acesso com esse e-mail: use "Criar acesso".',
  'auth/email-already-in-use': 'Esse e-mail já tem acesso: use "Entrar".',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Espere um pouco.',
  'auth/network-request-failed': 'Sem internet no momento.',
  'permission-denied': 'Sem permissão: entre com o e-mail da marca e confirme o e-mail.',
};
const wrap = async (fn) => { try { return await fn(); } catch (e) { throw new Error(MSG[e.code] || e.message); } };

export const user = () => auth.currentUser;
export const isAdmin = (u = auth.currentUser) => !!u && ADMINS.includes((u.email || '').toLowerCase()) && u.emailVerified;
export const onUser = (fn) => onAuthStateChanged(auth, fn);
export const entrar = (email, senha) => wrap(() => signInWithEmailAndPassword(auth, email.trim(), senha));
export const criarAcesso = (email, senha) => wrap(async () => { const { user: u } = await createUserWithEmailAndPassword(auth, email.trim(), senha); await sendEmailVerification(u); return u; });
export const reenviarVerificacao = () => wrap(() => sendEmailVerification(auth.currentUser));
export const recarregar = async () => { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); return auth.currentUser; };
export const esqueci = (email) => wrap(() => sendPasswordResetEmail(auth, email.trim()));
export const sair = () => signOut(auth);

// ---------- dados ----------
export const ouvirPedidos = (fn, onErr) => onSnapshot(collection(fs, 'pedidos'),
  (s) => fn(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.criadoMs || 0) - (a.criadoMs || 0))),
  (e) => onErr?.(new Error(MSG[e.code] || e.message)));
export const atualizarPedido = (id, patch) => wrap(() => updateDoc(doc(fs, 'pedidos', id), { ...patch, atualizadoMs: Date.now() }));
export const apagarPedido = (id) => wrap(() => deleteDoc(doc(fs, 'pedidos', id)));

// interno/config · interno/estoque · interno/custos/pedidos/{id}
export async function lerInterno(nome, padrao = {}) {
  const s = await wrap(() => getDoc(doc(fs, 'interno', nome)));
  return { ...padrao, ...(s.exists() ? s.data() : {}) };
}
export const salvarInterno = (nome, dados) => wrap(() => setDoc(doc(fs, 'interno', nome), dados, { merge: true }));
export const ouvirInterno = (nome, fn) => onSnapshot(doc(fs, 'interno', nome), (s) => fn(s.exists() ? s.data() : {}), () => {});
export const ouvirCustos = (fn) => onSnapshot(collection(fs, 'interno', 'custos', 'pedidos'), (s) => fn(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))), () => {});
export const salvarCusto = (id, dados) => wrap(() => setDoc(doc(fs, 'interno', 'custos', 'pedidos', id), dados, { merge: true }));
