// Acesso restrito ao Estúdio: e-mail + senha (PBKDF2-SHA256 no navegador).
// Só o hash fica no código; a senha nunca é gravada. Para trocar a senha ou
// adicionar alguém, gere um novo registro (ver CLAUDE.md) e substitua USERS.
const USERS = [
  { label: 'Admin', salt: 'CUo36c5O8kT90He05iI6ag==', hash: 'nGoy6TnDua6o5kACp0jh0slgaCrLmmQbO/uLmtOMow4=', it: 310000 },
];
const KEY = 'ekk-auth';
const DAYS = 30;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(email, password, salt, it) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${email.trim().toLowerCase()}\n${password}`), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: it }, key, 256));
}

export async function login(email, password) {
  for (const u of USERS) {
    if (await derive(email, password, u.salt, u.it) === u.hash) {
      try { localStorage.setItem(KEY, JSON.stringify({ h: u.hash.slice(0, 12), until: Date.now() + DAYS * 864e5 })); } catch { /* sem armazenamento: vale só nesta aba */ }
      sessionStorage.setItem(KEY, u.hash.slice(0, 12));
      return true;
    }
  }
  return false;
}

// Sessão válida = marcador ainda corresponde a um usuário atual (trocar a senha derruba todas).
export function isAuthed() {
  const valid = (h) => USERS.some((u) => u.hash.slice(0, 12) === h);
  if (valid(sessionStorage.getItem(KEY))) return true;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return !!(s && s.until > Date.now() && valid(s.h));
  } catch { return false; }
}

export function logout() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
  sessionStorage.removeItem(KEY);
  location.replace(location.pathname);
}

export function renderLogin() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'login';
    wrap.innerHTML = `
      <form class="login-card" novalidate>
        <div class="login-brand"><span class="brand-mark">EKKLESIA</span><span class="brand-sub">STUDIO</span></div>
        <p class="muted">Acesso restrito à equipe EKKLESIA.</p>
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required autofocus></label>
        <label class="field"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
        <p class="login-err" hidden>E-mail ou senha incorretos.</p>
        <button class="btn primary block">Entrar</button>
      </form>`;
    document.body.append(wrap);
    const form = wrap.querySelector('form');
    let tries = 0;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Verificando…';
      const ok = await login(form.email.value, form.senha.value);
      if (ok) { wrap.remove(); resolve(); return; }
      tries++;
      form.querySelector('.login-err').hidden = false;
      form.senha.value = '';
      // espera crescente entre tentativas erradas
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Entrar'; form.senha.focus(); }, Math.min(8000, 600 * 2 ** tries));
    });
  });
}
