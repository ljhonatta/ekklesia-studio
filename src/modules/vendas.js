// Vendas: pedidos do site (Firebase), pagamentos, produção, calendário de
// entregas, estoque de peças lisas e relatório de faturamento e margem.
import { db } from '../db.js';
import { $, $$, esc, toast, modal, confirmDialog, download } from '../util.js';
import { brl } from '../data.js';
import { pageHead } from '../ui.js';
import { autoPublish } from '../store-publish.js';

const STATUS = [
  ['aguardando_pagamento', 'Aguardando pagamento', '#8a8a8a'],
  ['entrada_paga', 'Entrada paga', '#c4a96b'],
  ['pago', 'Pago', '#d4a83a'],
  ['em_producao', 'Em produção', '#5b8def'],
  ['pronto', 'Pronto para envio', '#36b37e'],
  ['enviado', 'Enviado', '#2f9e8f'],
  ['entregue', 'Entregue', '#5a5a5a'],
  ['cancelado', 'Cancelado', '#b24a4a'],
];
const stLabel = (s) => STATUS.find((x) => x[0] === s)?.[1] || s;
const stColor = (s) => STATUS.find((x) => x[0] === s)?.[2] || '#888';
const pill = (s) => `<span class="v-pill" style="--c:${stColor(s)}">${esc(stLabel(s))}</span>`;
const ABERTOS = ['entrada_paga', 'pago', 'em_producao', 'pronto'];
const CONFIRMADOS = ['entrada_paga', 'pago', 'em_producao', 'pronto', 'enviado', 'entregue'];
export const DEFAULT_CFG = { diasProducao: 10, impostoPct: 6, custoEstampa: 15, embalagem: 5, taxaPct: 0, custoPecaPadrao: 29 };
const PECA_NOME = { 'oversize-masc': 'Oversized masculina', 'oversize-fem': 'Oversized feminina', 'tech-fem': 'Tech feminina' };

const r2 = (n) => Math.round(n * 100) / 100;
const dia = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
const diaLongo = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) : '—');
const inicioDia = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
// dias úteis (seg–sex) a partir de uma data
export function somarDiasUteis(ms, n) {
  const d = new Date(ms); let k = 0;
  while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) k++; }
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}
const zap = (n) => { const d = String(n || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}` : ''; };

// ---------- custos e margem de um pedido ----------
function custoPedido(o, cfg, prodBySlug, extra = {}) {
  const pecas = o.itens.reduce((n, i) => n + i.qtd, 0);
  const custoPecas = o.itens.reduce((s, i) => s + i.qtd * (+prodBySlug.get(i.slug)?.custo || cfg.custoPecaPadrao), 0);
  const estampa = pecas * cfg.custoEstampa;
  const embalagem = cfg.embalagem;
  const frete = +extra.frete || 0;
  const taxa = r2(o.total * (cfg.taxaPct / 100)) + (+extra.taxa || 0);
  const imposto = r2(o.total * (cfg.impostoPct / 100));
  const custo = r2(custoPecas + estampa + embalagem + frete + taxa + imposto + (+extra.outros || 0));
  const lucro = r2(o.total - custo);
  return { pecas, custoPecas: r2(custoPecas), estampa, embalagem, frete, taxa, imposto, custo, lucro, margem: o.total ? Math.round((lucro / o.total) * 1000) / 10 : 0 };
}

export async function render(el) {
  const F = await import('../fb-admin.js');
  el.innerHTML = `${pageHead({ eyebrow: 'Interno', title: 'Vendas', lede: 'Pedidos do site, pagamentos, produção, entregas e relatório de margem. Só o e-mail da marca tem acesso.' })}<div id="vBox"><p class="muted">Conectando…</p></div>`;
  const box = $('#vBox', el);
  const unsubs = [];
  const stop = () => { unsubs.splice(0).forEach((u) => u()); };
  const offUser = F.onUser((u) => {
    if (!el.isConnected) { offUser(); stop(); return; }
    stop();
    if (!u) loginView(box, F);
    else if (!F.isAdmin(u)) verifyView(box, F, u);
    else painel(el, box, F, unsubs);
  });
}

// ---------- acesso ----------
function loginView(box, F) {
  box.innerHTML = `<section class="panel v-login form-stack">
    <h3>Entrar no painel de vendas</h3>
    <p class="hint">Use o e-mail da marca (${esc(F.ADMINS[0])}). Na primeira vez, clique em <b>Criar acesso</b>: chega um e-mail de confirmação; depois de confirmar, o painel abre.</p>
    <label class="field"><span>E-mail</span><input id="vEmail" type="email" value="${esc(F.ADMINS[0])}" autocomplete="username"></label>
    <label class="field"><span>Senha</span><input id="vSenha" type="password" autocomplete="current-password"></label>
    <div class="actions-row"><button class="btn primary" id="vIn">Entrar</button><button class="btn" id="vNew">Criar acesso</button><button class="link" id="vForgot">Esqueci a senha</button></div>
  </section>`;
  const val = () => [$('#vEmail', box).value, $('#vSenha', box).value];
  $('#vIn', box).onclick = async () => { try { await F.entrar(...val()); } catch (e) { toast(e.message, 'err'); } };
  $('#vNew', box).onclick = async () => { try { await F.criarAcesso(...val()); toast('Acesso criado. Confirme pelo link que chegou no e-mail.'); } catch (e) { toast(e.message, 'err'); } };
  $('#vForgot', box).onclick = async () => { try { await F.esqueci(val()[0]); toast('Link de nova senha enviado para o e-mail.'); } catch (e) { toast(e.message, 'err'); } };
}

function verifyView(box, F, u) {
  const isMarca = F.ADMINS.includes((u.email || '').toLowerCase());
  box.innerHTML = `<section class="panel v-login form-stack">
    <h3>${isMarca ? 'Confirme o e-mail' : 'Sem acesso'}</h3>
    <p>${isMarca ? `Enviamos um link de confirmação para <b>${esc(u.email)}</b>. Abra o e-mail, clique no link e volte aqui.` : `<b>${esc(u.email)}</b> não é o e-mail da marca. Só ${esc(F.ADMINS[0])} acessa as vendas.`}</p>
    <div class="actions-row">${isMarca ? '<button class="btn primary" id="vDone">Já confirmei</button><button class="btn" id="vResend">Reenviar e-mail</button>' : ''}<button class="link" id="vOut">Sair</button></div>
  </section>`;
  $('#vDone', box)?.addEventListener('click', async () => { const x = await F.recarregar(); if (F.isAdmin(x)) location.reload(); else toast('Ainda não confirmado. Confira o e-mail (e o spam).', 'err'); });
  $('#vResend', box)?.addEventListener('click', async () => { try { await F.reenviarVerificacao(); toast('E-mail reenviado.'); } catch (e) { toast(e.message, 'err'); } });
  $('#vOut', box).onclick = () => F.sair();
}

// ---------- painel ----------
async function painel(el, box, F, unsubs) {
  const TABS = [['pedidos', 'Pedidos'], ['calendario', 'Calendário'], ['producao', 'Produção'], ['estoque', 'Estoque'], ['relatorio', 'Relatório'], ['ajustes', 'Ajustes']];
  const S = { tab: sessionStorage.getItem('vTab') || 'pedidos', pedidos: [], custos: {}, estoque: {}, cfg: { ...DEFAULT_CFG }, filtro: 'abertos', busca: '', mes: inicioMes(new Date()), periodo: 'mes' };
  const prods = await db.products.toArray();
  const prodBySlug = new Map(prods.map((p) => [p.slug, p]));
  box.innerHTML = `<div class="v-top"><div class="seg seg-wrap" id="vTabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
    <span class="muted small">${esc(F.user().email)} · <button class="link" id="vOut">sair</button></span></div><div id="vMain"></div>`;
  $('#vOut', box).onclick = () => F.sair();
  const main = $('#vMain', box);
  const draw = () => {
    if (!el.isConnected) return;
    $$('[data-tab]', box).forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    ({ pedidos: tabPedidos, calendario: tabCalendario, producao: tabProducao, estoque: tabEstoque, relatorio: tabRelatorio, ajustes: tabAjustes })[S.tab](main, S, F, prodBySlug);
  };
  $('#vTabs', box).addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; sessionStorage.setItem('vTab', S.tab); draw(); } });
  unsubs.push(F.ouvirPedidos((ps) => { S.pedidos = ps; if (S.tab !== 'ajustes') draw(); }, (e) => { main.innerHTML = `<p class="banner warn">${esc(e.message)}</p>`; }));
  unsubs.push(F.ouvirCustos((c) => { S.custos = c; if (S.tab === 'relatorio') draw(); }));
  unsubs.push(F.ouvirInterno('estoque', (e) => { S.estoque = e.itens || {}; if (S.tab === 'estoque' || S.tab === 'producao') draw(); }));
  unsubs.push(F.ouvirInterno('config', (c) => { S.cfg = { ...DEFAULT_CFG, ...c }; }));
  S.abrir = (id) => detalhe(S, F, prodBySlug, id);
  draw();
}
const inicioMes = (d) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();

// ---------- aba: pedidos ----------
function tabPedidos(main, S) {
  const hoje = inicioDia();
  const atrasado = (o) => o.prazoEntrega && o.prazoEntrega < hoje && ABERTOS.includes(o.status);
  const filtros = [['abertos', 'Em andamento', (o) => ABERTOS.includes(o.status)], ['aguardando_pagamento', 'Aguardando Pix', (o) => o.status === 'aguardando_pagamento'], ['atrasados', 'Atrasados', atrasado], ['enviados', 'Enviados', (o) => ['enviado', 'entregue'].includes(o.status)], ['todos', 'Todos', () => true]];
  const f = filtros.find((x) => x[0] === S.filtro) || filtros[0];
  const q = S.busca.toLowerCase();
  const list = S.pedidos.filter(f[2]).filter((o) => !q || `${o.code} ${o.cliente?.nome} ${o.cliente?.whats} ${o.email}`.toLowerCase().includes(q));
  const aReceber = S.pedidos.filter((o) => CONFIRMADOS.includes(o.status) || o.status === 'aguardando_pagamento').reduce((s, o) => s + Math.max(0, o.total - (o.pago || 0)), 0);
  main.innerHTML = `
    <div class="v-kpis">
      <div><span>Aguardando Pix</span><b>${S.pedidos.filter((o) => o.status === 'aguardando_pagamento').length}</b></div>
      <div><span>Em andamento</span><b>${S.pedidos.filter((o) => ABERTOS.includes(o.status)).length}</b></div>
      <div><span>Atrasados</span><b class="${S.pedidos.some(atrasado) ? 'warn' : ''}">${S.pedidos.filter(atrasado).length}</b></div>
      <div><span>A receber</span><b>${brl(aReceber)}</b></div>
    </div>
    <div class="toolbar"><div class="chips">${filtros.map(([k, l, fn]) => `<button class="chip ${k === S.filtro ? 'active' : ''}" data-f="${k}">${l} <b>${S.pedidos.filter(fn).length}</b></button>`).join('')}</div>
      <input id="vBusca" placeholder="Buscar nome, código, WhatsApp" value="${esc(S.busca)}"></div>
    ${list.length ? `<div class="v-table"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Peças</th><th>Total</th><th>Pago</th><th>Entrega</th><th>Situação</th></tr></thead><tbody>
      ${list.map((o) => `<tr data-id="${o.id}" class="${atrasado(o) ? 'late' : ''}"><td><b>${esc(o.code)}</b><small>${dia(o.criadoMs)}</small></td><td>${esc(o.cliente?.nome || '—')}<small>${esc(o.cliente?.cidade || '')}${o.uid ? ' · com conta' : ''}</small></td>
        <td>${o.itens.reduce((n, i) => n + i.qtd, 0)}</td><td>${brl(o.total)}</td><td>${brl(o.pago || 0)}</td><td>${o.prazoEntrega ? diaLongo(o.prazoEntrega) : '—'}</td><td>${pill(o.status)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Nenhum pedido aqui.</p>'}`;
  main.querySelector('.chips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { S.filtro = b.dataset.f; tabPedidos(main, S); } };
  $('#vBusca', main).oninput = (e) => { S.busca = e.target.value; const pos = e.target.selectionStart; tabPedidos(main, S); const i = $('#vBusca', main); i.focus(); i.setSelectionRange(pos, pos); };
  main.querySelector('tbody')?.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) S.abrir(tr.dataset.id); });
}

// ---------- detalhe do pedido ----------
async function detalhe(S, F, prodBySlug, id) {
  const o = S.pedidos.find((x) => x.id === id);
  if (!o) return;
  const c = o.cliente || {};
  const extra = S.custos[id] || {};
  const k = custoPedido(o, S.cfg, prodBySlug, extra);
  const falta = r2(o.total - (o.pago || 0));
  const msgStatus = encodeURIComponent(`Olá, ${(c.nome || '').split(' ')[0]}! Seu pedido ${o.code} da EKKLESIA está: ${stLabel(o.status)}.${o.prazoEntrega ? ` Previsão de entrega: ${diaLongo(o.prazoEntrega)}.` : ''} Acompanhe: https://ekklesiastoreide.com.br/#/pedido/${o.id}`);
  await modal({
    title: `Pedido ${o.code}`, wide: true, actions: [],
    body: `<div class="v-detail">
      <section>
        <h4>Cliente</h4>
        <p><b>${esc(c.nome || '—')}</b><br>${c.whats ? `<a class="link" target="_blank" rel="noopener" href="${zap(c.whats)}?text=${msgStatus}">WhatsApp ${esc(c.whats)}</a><br>` : ''}${esc(o.email || c.email || '')}</p>
        <p class="muted small">${esc([c.rua, c.numero, c.complemento, c.bairro].filter(Boolean).join(', '))}<br>${esc([c.cidade, c.uf, c.cep].filter(Boolean).join(' · '))}</p>
        ${o.obs ? `<p class="hint">Obs.: ${esc(o.obs)}</p>` : ''}
        <h4>Peças</h4>
        <ul class="plain">${o.itens.map((i) => `<li>${i.qtd}× ${esc(i.nome)} <span class="muted">${esc([i.tam, i.cor].filter(Boolean).join(' · '))}</span> — ${brl(i.preco * i.qtd)}</li>`).join('')}</ul>
        <h4>Histórico</h4>
        <ul class="plain small">${(o.historico || []).map((h) => `<li>${new Date(h.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(stLabel(h.status))}${h.nota ? ` · ${esc(h.nota)}` : ''}</li>`).join('')}</ul>
      </section>
      <section class="form-stack">
        <h4>Situação</h4>
        <div class="form-grid two">
          <label class="field"><span>Situação</span><select id="dSt">${STATUS.map(([s, l]) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Previsão de entrega</span><input type="date" id="dPrazo" value="${o.prazoEntrega ? new Date(o.prazoEntrega).toISOString().slice(0, 10) : ''}"></label>
        </div>
        <label class="field"><span>Código de rastreio</span><input id="dRast" value="${esc(o.rastreio || '')}" placeholder="Correios / transportadora"></label>
        <div class="actions-row"><button class="btn primary" id="dSave">Salvar situação</button><a class="btn" target="_blank" rel="noopener" href="https://ekklesiastoreide.com.br/#/pedido/${o.id}">Ver como o cliente vê</a></div>
        <h4>Pagamentos <span class="muted small">pago ${brl(o.pago || 0)} de ${brl(o.total)}${falta > 0 ? ` · falta ${brl(falta)}` : ' · quitado'}</span></h4>
        <ul class="plain small">${(o.pagamentos || []).map((p) => `<li>${dia(p.at)} · ${brl(p.valor)} · ${esc(p.forma || 'Pix')}</li>`).join('') || '<li class="muted">Nenhum pagamento registrado.</li>'}</ul>
        ${falta > 0 ? `<div class="form-grid three"><label class="field"><span>Valor recebido</span><input id="dPag" inputmode="decimal" value="${String(o.status === 'aguardando_pagamento' ? o.valorPix : falta).replace('.', ',')}"></label>
          <label class="field"><span>Forma</span><select id="dForma"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></label>
          <button class="btn primary" id="dAddPag">Registrar pagamento</button></div>` : ''}
        <h4>Custos e margem <span class="muted small">(só vocês veem)</span></h4>
        <div class="form-grid three">
          <label class="field"><span>Frete pago (R$)</span><input id="cFrete" inputmode="decimal" value="${extra.frete ?? ''}"></label>
          <label class="field"><span>Taxas extras (R$)</span><input id="cTaxa" inputmode="decimal" value="${extra.taxa ?? ''}"></label>
          <label class="field"><span>Outros custos (R$)</span><input id="cOutros" inputmode="decimal" value="${extra.outros ?? ''}"></label>
        </div>
        <table class="v-mini"><tr><td>Peças lisas (${k.pecas})</td><td>${brl(k.custoPecas)}</td></tr><tr><td>Estampa</td><td>${brl(k.estampa)}</td></tr><tr><td>Embalagem</td><td>${brl(k.embalagem)}</td></tr><tr><td>Frete + taxas</td><td>${brl(k.frete + k.taxa)}</td></tr><tr><td>Imposto (${S.cfg.impostoPct}%)</td><td>${brl(k.imposto)}</td></tr>
          <tr class="tot"><td>Lucro</td><td>${brl(k.lucro)} · ${k.margem}%</td></tr></table>
        <label class="field"><span>Nota interna</span><textarea id="cNota" rows="2">${esc(extra.nota || '')}</textarea></label>
        <div class="actions-row"><button class="btn" id="cSave">Salvar custos e nota</button><button class="link danger" id="dDel">Apagar pedido</button></div>
      </section></div>`,
    onOpen: (m, close) => m.addEventListener('click', (e) => acaoDetalhe(e, m, close, o, S, F)),
  });
}

async function acaoDetalhe(e, m, close, o, S, F) {
  const num = (sel) => +String(m.querySelector(sel)?.value || '').replace(/\./g, '').replace(',', '.') || 0;
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.id === 'dSave') {
      const st = m.querySelector('#dSt').value, prazo = m.querySelector('#dPrazo').value;
      const patch = { status: st, rastreio: m.querySelector('#dRast').value.trim(), prazoEntrega: prazo ? new Date(`${prazo}T12:00:00`).getTime() : null };
      if (st !== o.status) patch.historico = [...(o.historico || []), { status: st, at: Date.now() }];
      if (st === 'em_producao' && !o.estoqueBaixado) { patch.faltaEstoque = await baixarEstoque(o, F); patch.estoqueBaixado = true; }
      await F.atualizarPedido(o.id, patch);
      toast('Pedido atualizado. O cliente já vê a nova situação.');
      close(true);
    } else if (b.id === 'dAddPag') {
      const valor = num('#dPag');
      if (!(valor > 0)) { toast('Informe o valor.', 'err'); return; }
      const pago = r2((o.pago || 0) + valor);
      const status = pago >= o.total - 0.009 ? (ABERTOS.indexOf(o.status) > 1 ? o.status : 'pago') : (o.status === 'aguardando_pagamento' ? 'entrada_paga' : o.status);
      const patch = { pago, pagamentos: [...(o.pagamentos || []), { valor, at: Date.now(), forma: m.querySelector('#dForma').value }] };
      if (status !== o.status) { patch.status = status; patch.historico = [...(o.historico || []), { status, at: Date.now(), nota: `${brl(valor)} recebido` }]; }
      if (!o.prazoEntrega) patch.prazoEntrega = somarDiasUteis(Date.now(), S.cfg.diasProducao);
      if (!o.contouLancamento) { await contarLancamento(o); patch.contouLancamento = true; }
      await F.atualizarPedido(o.id, patch);
      toast(`Pagamento registrado. ${patch.prazoEntrega ? `Entrega prevista para ${diaLongo(patch.prazoEntrega)}.` : ''}`);
      close(true);
    } else if (b.id === 'cSave') {
      await F.salvarCusto(o.id, { frete: num('#cFrete'), taxa: num('#cTaxa'), outros: num('#cOutros'), nota: m.querySelector('#cNota').value });
      toast('Custos salvos.');
      close(true);
    } else if (b.id === 'dDel') {
      if (!await confirmDialog('Apagar pedido', `Apagar o pedido <b>${esc(o.code)}</b> de ${esc(o.cliente?.nome || '')}? Não dá para desfazer.`, 'Apagar', true)) return;
      await F.apagarPedido(o.id);
      toast('Pedido apagado.');
      close(true);
    }
  } catch (err) { toast(err.message, 'err'); }
}

// Venda confirmada: soma no contador da promoção de lançamento de cada produto.
async function contarLancamento(o) {
  let mudou = false;
  for (const i of o.itens) {
    const p = await db.products.where('slug').equals(i.slug).first();
    if (p?.lancamento) { await db.products.update(p.id, { lancVendidos: (+p.lancVendidos || 0) + i.qtd }); mudou = true; }
  }
  if (mudou) autoPublish();
}

const chave = (peca, cor, tam) => `${peca}|${cor}|${tam}`;
async function pecaDe(slug) {
  const p = await db.products.where('slug').equals(slug).first();
  return p?.peca || (p?.categoria === 'Camiseta feminina' ? 'tech-fem' : /femin/i.test(p?.genero || '') ? 'oversize-fem' : 'oversize-masc');
}
// Baixa do estoque o que o pedido usa; o que faltou fica anotado (vai para a compra).
async function baixarEstoque(o, F) {
  const est = (await F.lerInterno('estoque')).itens || {};
  const falta = {};
  for (const i of o.itens) {
    const k = chave(await pecaDe(i.slug), i.cor || '', i.tam || '');
    const tem = est[k] || 0, usa = Math.min(tem, i.qtd);
    if (k in est) est[k] = tem - usa;
    if (i.qtd > usa) falta[k] = (falta[k] || 0) + i.qtd - usa;
  }
  await F.salvarInterno('estoque', { itens: est });
  return falta;
}

// ---------- aba: calendário ----------
function tabCalendario(main, S) {
  const m0 = new Date(S.mes), ano = m0.getFullYear(), mes = m0.getMonth();
  const first = new Date(ano, mes, 1), dias = new Date(ano, mes + 1, 0).getDate();
  const offset = first.getDay();
  const hoje = inicioDia();
  const comPrazo = S.pedidos.filter((o) => o.prazoEntrega && o.status !== 'cancelado');
  const doDia = (d) => comPrazo.filter((o) => { const x = new Date(o.prazoEntrega); return x.getFullYear() === ano && x.getMonth() === mes && x.getDate() === d; });
  const atrasados = comPrazo.filter((o) => o.prazoEntrega < hoje && ABERTOS.includes(o.status));
  const semana = comPrazo.filter((o) => o.prazoEntrega >= hoje && o.prazoEntrega < hoje + 7 * 864e5 && ABERTOS.includes(o.status)).sort((a, b) => a.prazoEntrega - b.prazoEntrega);
  const cell = (d) => {
    const ts = new Date(ano, mes, d).getTime();
    return `<div class="v-day ${ts === hoje ? 'today' : ''}"><b>${d}</b>${doDia(d).map((o) => `<button data-id="${o.id}" style="--c:${stColor(o.status)}" title="${esc(stLabel(o.status))}">${esc(o.code)} · ${esc((o.cliente?.nome || '').split(' ')[0])}</button>`).join('')}</div>`;
  };
  main.innerHTML = `
    <div class="v-cal-head"><button class="btn sm" data-m="-1">‹</button><h3>${(() => { const t = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); })()}</h3><button class="btn sm" data-m="1">›</button>
      <span class="muted small">Prazo = data do primeiro pagamento + ${S.cfg.diasProducao} dias úteis (muda em Ajustes ou no pedido).</span></div>
    <div class="v-cal">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="v-dow">${d}</div>`).join('')}${'<div></div>'.repeat(offset)}${Array.from({ length: dias }, (_, i) => cell(i + 1)).join('')}</div>
    <div class="v-cols">
      <section class="panel"><h3>Atrasados (${atrasados.length})</h3>${atrasados.map((o) => `<button class="v-line" data-id="${o.id}">${esc(o.code)} · ${esc(o.cliente?.nome || '')} · era ${diaLongo(o.prazoEntrega)} ${pill(o.status)}</button>`).join('') || '<p class="muted">Nada atrasado.</p>'}</section>
      <section class="panel"><h3>Próximos 7 dias (${semana.length})</h3>${semana.map((o) => `<button class="v-line" data-id="${o.id}">${diaLongo(o.prazoEntrega)} · ${esc(o.code)} · ${esc(o.cliente?.nome || '')} ${pill(o.status)}</button>`).join('') || '<p class="muted">Nenhuma entrega na semana.</p>'}</section>
    </div>`;
  main.onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (b) { const d = new Date(S.mes); d.setMonth(d.getMonth() + +b.dataset.m); S.mes = inicioMes(d); tabCalendario(main, S); return; }
    const x = e.target.closest('[data-id]');
    if (x) S.abrir(x.dataset.id);
  };
}

// ---------- aba: produção ----------
async function tabProducao(main, S, F, prodBySlug) {
  const fila = S.pedidos.filter((o) => ['entrada_paga', 'pago', 'em_producao'].includes(o.status));
  const lisas = new Map(), estampas = new Map();
  for (const o of fila) for (const i of o.itens) {
    const p = prodBySlug.get(i.slug);
    const peca = p?.peca || (p?.categoria === 'Camiseta feminina' ? 'tech-fem' : 'oversize-masc');
    const k = chave(peca, i.cor || '', i.tam || '');
    const l = lisas.get(k) || { peca, cor: i.cor || '—', tam: i.tam || '—', qtd: 0, custo: +p?.custo || S.cfg.custoPecaPadrao, baixado: 0 };
    l.qtd += i.qtd;
    if (o.estoqueBaixado) l.baixado += i.qtd - Math.min(i.qtd, o.faltaEstoque?.[k] || 0);
    lisas.set(k, l);
    const ek = i.nome;
    estampas.set(ek, (estampas.get(ek) || 0) + i.qtd);
  }
  const rows = [...lisas.entries()].map(([k, l]) => {
    const emEstoque = S.estoque[k] ?? 0;
    const comprar = Math.max(0, l.qtd - l.baixado - emEstoque);
    return { ...l, k, emEstoque, comprar };
  }).sort((a, b) => a.peca.localeCompare(b.peca) || a.cor.localeCompare(b.cor));
  const totalCompra = rows.reduce((s, r) => s + r.comprar * r.custo, 0);
  main.innerHTML = `
    <p class="hint">Pedidos com pagamento e ainda não prontos (${fila.length}). "Em produção" já baixou do estoque.</p>
    <div class="v-cols">
      <section class="panel"><h3>Peças lisas</h3>${rows.length ? `<div class="v-table"><table><thead><tr><th>Modelo</th><th>Cor</th><th>Tam.</th><th>Pedidas</th><th>Em estoque</th><th>Comprar</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(PECA_NOME[r.peca] || r.peca)}</td><td>${esc(r.cor)}</td><td>${esc(r.tam)}</td><td>${r.qtd}</td><td>${r.emEstoque}</td><td><b class="${r.comprar ? 'warn' : ''}">${r.comprar}</b></td></tr>`).join('')}
      </tbody></table></div><p><b>Compra no fornecedor:</b> ${brl(totalCompra)}</p>
      <div class="actions-row"><button class="btn" id="pCopy">Copiar lista de compra</button></div>` : '<p class="muted">Nada para produzir agora.</p>'}</section>
      <section class="panel"><h3>Estampas a fazer</h3>${estampas.size ? `<ul class="plain">${[...estampas].sort((a, b) => b[1] - a[1]).map(([n, q]) => `<li><b>${q}×</b> ${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma.</p>'}</section>
    </div>`;
  $('#pCopy', main)?.addEventListener('click', () => {
    const txt = ['Pedido de compra EKKLESIA', ...rows.filter((r) => r.comprar).map((r) => `${r.comprar}x ${PECA_NOME[r.peca] || r.peca} ${r.cor} ${r.tam}`)].join('\n');
    navigator.clipboard.writeText(txt).then(() => toast('Lista copiada: é só colar no WhatsApp do fornecedor.'));
  });
}

// ---------- aba: estoque ----------
function tabEstoque(main, S, F) {
  const itens = Object.entries(S.estoque).map(([k, q]) => { const [peca, cor, tam] = k.split('|'); return { k, peca, cor, tam, q }; }).sort((a, b) => a.k.localeCompare(b.k));
  main.innerHTML = `
    <p class="hint">Peças lisas que vocês já têm. Quando um pedido vai para <b>Em produção</b>, as peças dele saem daqui sozinhas.</p>
    <section class="panel form-stack"><h3>Adicionar ao estoque</h3>
      <div class="form-grid four">
        <label class="field"><span>Modelo</span><select id="eP">${Object.entries(PECA_NOME).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Cor</span><input id="eC" placeholder="Preta"></label>
        <label class="field"><span>Tamanho</span><select id="eT">${['P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'].map((t) => `<option>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Quantidade</span><input id="eQ" inputmode="numeric" value="1"></label>
      </div><div class="actions-row"><button class="btn primary" id="eAdd">Somar ao estoque</button></div></section>
    ${itens.length ? `<div class="v-table"><table><thead><tr><th>Modelo</th><th>Cor</th><th>Tam.</th><th>Qtd.</th><th></th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td>${esc(PECA_NOME[i.peca] || i.peca)}</td><td>${esc(i.cor)}</td><td>${esc(i.tam)}</td><td><input class="v-qty" data-k="${esc(i.k)}" value="${i.q}" inputmode="numeric"></td><td><button class="link danger" data-rm="${esc(i.k)}">remover</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Estoque vazio.</p>'}`;
  const salvar = async (itensNovos) => { try { await F.salvarInterno('estoque', { itens: itensNovos }); } catch (e) { toast(e.message, 'err'); } };
  $('#eAdd', main).onclick = () => {
    const cor = $('#eC', main).value.trim();
    if (!cor) { toast('Informe a cor.', 'err'); return; }
    const k = chave($('#eP', main).value, cor, $('#eT', main).value);
    salvar({ ...S.estoque, [k]: (S.estoque[k] || 0) + Math.max(0, parseInt($('#eQ', main).value, 10) || 0) });
  };
  main.onchange = (e) => { const i = e.target.closest('.v-qty'); if (i) salvar({ ...S.estoque, [i.dataset.k]: Math.max(0, parseInt(i.value, 10) || 0) }); };
  main.onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { const n = { ...S.estoque }; delete n[b.dataset.rm]; salvar(n); } };
}

// ---------- aba: relatório ----------
function tabRelatorio(main, S, F, prodBySlug) {
  const agora = new Date();
  const PER = {
    mes: ['Este mês', inicioMes(agora), Infinity],
    mesPassado: ['Mês passado', inicioMes(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)), inicioMes(agora)],
    d30: ['Últimos 30 dias', Date.now() - 30 * 864e5, Infinity],
    ano: ['Este ano', new Date(agora.getFullYear(), 0, 1).getTime(), Infinity],
    tudo: ['Tudo', 0, Infinity],
  };
  const [, ini, fim] = PER[S.periodo];
  const doPeriodo = S.pedidos.filter((o) => (o.criadoMs || 0) >= ini && (o.criadoMs || 0) < fim);
  const conf = doPeriodo.filter((o) => CONFIRMADOS.includes(o.status));
  const pend = doPeriodo.filter((o) => o.status === 'aguardando_pagamento');
  const soma = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  const ks = conf.map((o) => ({ o, k: custoPedido(o, S.cfg, prodBySlug, S.custos[o.id]) }));
  const fat = soma(conf, (o) => o.total), rec = soma(conf, (o) => o.pago || 0);
  const tot = (key) => soma(ks, (x) => x.k[key]);
  const lucro = tot('lucro');
  const porProduto = new Map();
  for (const { o } of ks) for (const i of o.itens) {
    const p = porProduto.get(i.nome) || { q: 0, fat: 0, custo: 0 };
    const cu = (+prodBySlug.get(i.slug)?.custo || S.cfg.custoPecaPadrao) + S.cfg.custoEstampa;
    p.q += i.qtd; p.fat += i.preco * i.qtd; p.custo += cu * i.qtd + i.preco * i.qtd * (S.cfg.impostoPct + S.cfg.taxaPct) / 100;
    porProduto.set(i.nome, p);
  }
  const dias = new Map();
  for (const o of conf) { const d = new Date(o.criadoMs).toISOString().slice(0, 10); dias.set(d, (dias.get(d) || 0) + o.total); }
  const maxDia = Math.max(1, ...dias.values());
  main.innerHTML = `
    <div class="toolbar"><div class="chips">${Object.entries(PER).map(([k, [l]]) => `<button class="chip ${k === S.periodo ? 'active' : ''}" data-p="${k}">${l}</button>`).join('')}</div><button class="btn sm" id="rCsv">Baixar planilha (CSV)</button></div>
    <div class="v-kpis">
      <div><span>Faturamento</span><b>${brl(fat)}</b><small>${conf.length} pedido(s) · ${soma(conf, (o) => o.itens.reduce((n, i) => n + i.qtd, 0))} peças</small></div>
      <div><span>Recebido</span><b>${brl(rec)}</b><small>a receber ${brl(fat - rec)}</small></div>
      <div><span>Lucro estimado</span><b class="${lucro < 0 ? 'warn' : ''}">${brl(lucro)}</b><small>margem ${fat ? Math.round((lucro / fat) * 1000) / 10 : 0}%</small></div>
      <div><span>Ticket médio</span><b>${brl(conf.length ? fat / conf.length : 0)}</b><small>${pend.length} aguardando Pix (${brl(soma(pend, (o) => o.total))})</small></div>
    </div>
    <div class="v-cols">
      <section class="panel"><h3>Para onde vai o dinheiro</h3><table class="v-mini">
        <tr><td>Peças lisas</td><td>${brl(tot('custoPecas'))}</td></tr><tr><td>Estampas</td><td>${brl(tot('estampa'))}</td></tr><tr><td>Embalagens</td><td>${brl(tot('embalagem'))}</td></tr>
        <tr><td>Fretes</td><td>${brl(tot('frete'))}</td></tr><tr><td>Taxas</td><td>${brl(tot('taxa'))}</td></tr><tr><td>Impostos (${S.cfg.impostoPct}%)</td><td>${brl(tot('imposto'))}</td></tr>
        <tr class="tot"><td>Custo total</td><td>${brl(tot('custo'))}</td></tr><tr class="tot"><td>Lucro</td><td>${brl(lucro)}</td></tr></table></section>
      <section class="panel"><h3>Vendas por dia</h3>${dias.size ? `<div class="v-bars">${[...dias].sort().map(([d, v]) => `<div title="${d}: ${brl(v)}"><i style="height:${Math.max(4, (v / maxDia) * 100)}%"></i><small>${d.slice(8)}/${d.slice(5, 7)}</small></div>`).join('')}</div>` : '<p class="muted">Sem vendas no período.</p>'}</section>
    </div>
    <section class="panel"><h3>Por produto</h3>${porProduto.size ? `<div class="v-table"><table><thead><tr><th>Produto</th><th>Peças</th><th>Faturamento</th><th>Lucro est.</th><th>Margem</th></tr></thead><tbody>
      ${[...porProduto].sort((a, b) => b[1].fat - a[1].fat).map(([n, p]) => `<tr><td>${esc(n)}</td><td>${p.q}</td><td>${brl(p.fat)}</td><td>${brl(p.fat - p.custo)}</td><td>${p.fat ? Math.round(((p.fat - p.custo) / p.fat) * 100) : 0}%</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Sem vendas no período.</p>'}</section>
    <p class="hint">Lucro = faturamento − peça lisa (custo do produto) − estampa − embalagem − frete − taxas − imposto. Valores de custo padrão em Ajustes; frete e taxas reais por pedido no detalhe.</p>`;
  main.querySelector('.chips').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { S.periodo = b.dataset.p; tabRelatorio(main, S, F, prodBySlug); } };
  $('#rCsv', main).onclick = () => {
    const head = ['codigo', 'data', 'cliente', 'whatsapp', 'cidade', 'situacao', 'pecas', 'total', 'pago', 'custo', 'lucro', 'margem%'];
    const lines = ks.map(({ o, k }) => [o.code, new Date(o.criadoMs).toLocaleDateString('pt-BR'), o.cliente?.nome, o.cliente?.whats, o.cliente?.cidade, stLabel(o.status), k.pecas, o.total, o.pago || 0, k.custo, k.lucro, k.margem]);
    const csv = [head, ...lines].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    download(new Blob([`﻿${csv}`], { type: 'text/csv' }), `ekklesia-vendas-${S.periodo}.csv`);
  };
}

// ---------- aba: ajustes ----------
async function tabAjustes(main, S, F) {
  const cfg = await F.lerInterno('config', DEFAULT_CFG).catch(() => S.cfg);
  const fields = [['diasProducao', 'Dias úteis de produção (prazo de entrega)'], ['impostoPct', 'Imposto sobre a venda (%)'], ['custoEstampa', 'Custo da estampa por peça (R$)'], ['embalagem', 'Embalagem por pedido (R$)'], ['taxaPct', 'Taxa de recebimento (%)'], ['custoPecaPadrao', 'Custo da peça lisa quando o produto não tem custo (R$)']];
  main.innerHTML = `<section class="panel form-stack v-cfg"><h3>Ajustes de custos e prazos</h3>
    ${fields.map(([k, l]) => `<label class="field"><span>${l}</span><input data-k="${k}" inputmode="decimal" value="${String(cfg[k]).replace('.', ',')}"></label>`).join('')}
    <p class="hint">MEI paga um valor fixo por mês (DAS): nesse caso use 0% e lance o DAS como custo. Simples Nacional (comércio) começa em 4%.</p>
    <div class="actions-row"><button class="btn primary" id="cfgSave">Salvar ajustes</button></div></section>`;
  $('#cfgSave', main).onclick = async () => {
    const n = {};
    for (const i of $$('[data-k]', main)) n[i.dataset.k] = Math.max(0, +i.value.replace(',', '.') || 0);
    try { await F.salvarInterno('config', n); S.cfg = { ...DEFAULT_CFG, ...n }; toast('Ajustes salvos.'); } catch (e) { toast(e.message, 'err'); }
  };
}
