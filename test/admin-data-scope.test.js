const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const HTML = fs.readFileSync(require('node:path').join(__dirname, '../src/app.html'), 'utf8');
const SCRIPT = HTML.split('/* BEGIN ADMIN_DATA_SCOPE */')[1].split('/* END ADMIN_DATA_SCOPE */')[0];

class FakeElement {
  constructor(tag, id) {
    this.tagName = String(tag || '').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.onclick = null;
    this.onchange = null;
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
}

function makeContext({ lojas, responder, ajustes = [], sessLoja = 'L05', uid = 'u-admin', papel = 'admin', mobile = false } = {}) {
  const ids = ['adminDesktopScopeSelect', 'adminDesktopScopeStatus', 'adminDesktopScopeSource', 'adminDesktopScopeRetry', 'adminDesktopScope'];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id === 'adminDesktopScopeSelect' ? 'select' : 'p', id)]));
  const events = [];
  const renders = [];
  const document = {
    documentElement: {
      classList: {
        contains(name) { return !mobile && name === 'desktop-admin'; }
      }
    },
    getElementById(id) { return elements[id] || null; },
    createElement(tag) { return new FakeElement(tag); },
    dispatchEvent(event) { events.push(event); return true; }
  };
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  }
  const calls = [];
  const context = {
    console,
    document,
    CustomEvent: TestCustomEvent,
    window: { matchMedia: () => ({ matches: !mobile }), __adminScopeDesktop: !mobile },
    SESS: { uid, papel, lojaId: sessLoja, lojaNome: 'Não deve ser usado', access_token: 'token' },
    D: { prod: { original: { lotes: [] } }, pere: { itens: {}, regs: [] } },
    dias: value => value === '2030-01-01' ? 100 : value === '2020-01-01' ? -100 : null,
    adminDesktopRender: () => renders.push(true),
    sbLojas: () => Promise.resolve(lojas),
    sbReq: url => {
      calls.push(url);
      return Promise.resolve(tableFrom(url)==='ajustes'?{ok:true,dados:ajustes}:responder(url));
    }
  };
  vm.createContext(context);
  vm.runInContext(SCRIPT, context, { filename: 'scope.js' });
  return { context, elements, events, renders, calls };
}

function decoded(url) { return decodeURIComponent(url); }
function tableFrom(url) {
  const match = /\/rest\/v1\/([^?]+)/.exec(url);
  return match && match[1];
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function normalResponder(url) {
  const decodedUrl = decoded(url);
  const table = tableFrom(url);
  if (table === 'lotes') return { ok: true, dados: [
    { id: 'lot05', loja_id: 'L05', ean: 'EAN05', lote: 'A', qtd: 4, val: '2030-01-01', criado: 100, setor: 'FLV', created_by: 'u1', created_by_nome: 'Ana', recolhido_em: null, em_area_vendas: true, updated_at: 'x', deleted_at: null },
    { id: 'out', loja_id: 'OUT', ean: 'OUT', lote: 'X', qtd: 999, val: '2030-01-01' }
  ] };
  if (table === 'pere_regs') return { ok: true, dados: [
    { id: 'pe05', loja_id: 'L05', cod: 'P05', sif: 'SIF05', peso: 1.5, val: '2020-01-01', criado: 200, setor: 'Açougue', created_by: 'u2', created_by_nome: 'Bia', recolhido_em: '2024-01-01', em_area_vendas: false, updated_at: 'x', deleted_at: null }
  ] };
  if (table === 'pere_itens') return { ok: true, dados: [
    { loja_id: 'L05', cod: 'P05', descricao: 'Picanha', sif: 'SIF05' },
    { loja_id: 'OUT', cod: 'P05', descricao: 'FORA', sif: '' }
  ] };
  if (table === 'catalogo') return { ok: true, dados: [{ ean: 'EAN05', nome: 'Produto <seguro>', marca: 'Marca & X' }] };
  throw new Error('URL inesperada: ' + decodedUrl);
}

test('carrega FL05 remotamente, monta shape histórico e não altera D', async () => {
  const app = makeContext({ lojas: [{ id: 'L05', nome: 'FL05 <Centro>' }, { id: 'L15', nome: 'FL15 & Norte' }], responder: normalResponder });
  const before = JSON.stringify(app.context.D);
  assert.equal(await app.context.adminScopeIniciar(), true);
  assert.equal(app.context.ADMIN_SCOPE.selecionado, 'L05');
  const rows = app.context.adminScopeRegistros();
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows.map(r => r.lojaId)), ['L05', 'L05']);
  assert.equal(rows[0].id, 'lot05');
  assert.equal(rows[0].registroId, 'lot05');
  assert.equal(rows[1].id, 'pe05');
  assert.equal(rows[1].registroId, 'pe05');
  assert.equal(rows.every(r => r.lojaId), true);
  assert.equal(rows[0].nome, 'Produto <seguro>');
  assert.equal(rows[0].marca, 'Marca & X');
  assert.equal(rows[0].pendente, false);
  assert.equal(rows[1].tipo, 'Perecível');
  assert.equal(rows[1].nome, 'Picanha', 'pere_itens tem chave loja_id/cod, sem coluna id');
  assert.equal(rows[1].recolhido, true);
  assert.equal(app.context.ADMIN_SCOPE.atualizado > 0, true);
  assert.equal(JSON.stringify(app.context.D), before);
  assert.equal(app.elements.adminDesktopScopeSelect.value, 'L05');
  assert.equal(app.elements.adminDesktopScopeSelect.children[1].textContent, 'FL05 <Centro>');
  assert.match(app.elements.adminDesktopScopeSource.textContent, /Supabase/);
  assert.match(app.elements.adminDesktopScopeStatus.textContent, /2 registros/);
  assert.equal(app.context.adminScopeLoja(), 'L05');
  assert.deepEqual(plain(app.context.adminScopeUsuariosPayload()), { acao: 'listar', loja_id: 'L05' });
  assert.match(app.context.adminScopeFiltrarAuditoria(), /loja_id=eq\.L05/);
  assert.equal(app.context.adminScopeAtual().includes('L05'), true);
});

test('escopo all usa somente lojas autorizadas e deduplica usuários', async () => {
  const app = makeContext({ lojas: [{ id: 'L05', nome: 'FL05' }, { id: 'L15', nome: 'FL15' }], responder: (url) => {
    const table = tableFrom(url);
    if (table === 'lotes') return { ok: true, dados: [
      { id: 'a', loja_id: 'L05', ean: 'E05', qtd: 1, val: '2030-01-01' },
      { id: 'b', loja_id: 'L15', ean: 'E15', qtd: 2, val: '2030-01-01' },
      { id: 'x', loja_id: 'OUT', ean: 'EX', qtd: 9, val: '2030-01-01' }
    ] };
    if (table === 'pere_regs' || table === 'pere_itens') return { ok: true, dados: [] };
    if (table === 'catalogo') return { ok: true, dados: [{ ean: 'E05', nome: 'Cinco', marca: '' }, { ean: 'E15', nome: 'Quinze', marca: '' }] };
    throw new Error('URL inesperada: ' + decoded(url));
  }});
  await app.context.adminScopeIniciar();
  app.elements.adminDesktopScopeSelect.value = 'all';
  app.elements.adminDesktopScopeSelect.onchange();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.context.ADMIN_SCOPE.selecionado, 'all');
  assert.deepEqual(plain(app.context.adminScopeRegistros().map(r => r.lojaId).sort()), ['L05', 'L15']);
  assert.deepEqual(plain(app.context.adminScopeUsuariosPayload()), { acao: 'listar', escopo: 'todas' });
  assert.equal(app.context.adminScopeLoja(), null);
  assert.match(app.context.adminScopeFiltrarAuditoria(), /loja_id=in\.\(L05%2CL15\)/);
  const users = [
    { id: 'u1', nome: 'Ana', lojas: [{ id: 'L05' }] },
    { id: 'u1', nome: 'Ana', lojas: [{ id: 'L15' }] },
    { id: 'u2', nome: 'Bia', lojas: ['L15'] },
    { id: 'u3', nome: 'Fora', lojas: [{ id: 'OUT' }] }
  ];
  assert.deepEqual(plain(app.context.adminScopeFiltrarUsuarios(users).map(u => u.id)), ['u1', 'u2']);
  assert.ok(app.events.some(e => e.type === 'admin-scope-change'));
});

test('resposta antiga não substitui a seleção nova', async () => {
  const pending = [];
  const app = makeContext({ lojas: [{ id: 'L05', nome: 'FL05' }, { id: 'L15', nome: 'FL15' }], responder: (url) => {
    const d = decoded(url), table = tableFrom(url);
    if (table === 'lotes' && d.includes('loja_id=eq.L05')) return new Promise(resolve => pending.push(() => resolve({ ok: true, dados: [{ id: 'old', loja_id: 'L05', ean: 'OLD', qtd: 1, val: '2030-01-01' }] })));
    if (table === 'lotes' && d.includes('loja_id=eq.L15')) return { ok: true, dados: [{ id: 'new', loja_id: 'L15', ean: 'NEW', qtd: 1, val: '2030-01-01' }] };
    if (table === 'pere_regs' || table === 'pere_itens') return { ok: true, dados: [] };
    if (table === 'catalogo') return { ok: true, dados: [] };
    throw new Error('URL inesperada: ' + d);
  }});
  const first = app.context.adminScopeIniciar();
  await new Promise(resolve => setTimeout(resolve, 0));
  app.elements.adminDesktopScopeSelect.value = 'L15';
  app.elements.adminDesktopScopeSelect.onchange();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.context.ADMIN_SCOPE.selecionado, 'L15');
  assert.equal(app.context.adminScopeRegistros().length, 1);
  assert.equal(app.context.adminScopeRegistros()[0].lojaId, 'L15');
  pending.splice(0).forEach(resolve => resolve());
  await first;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.context.adminScopeRegistros()[0].lojaId, 'L15');
});

test('falha remota deixa vazio, atualizado nulo e exibe retry', async () => {
  const app = makeContext({ lojas: [{ id: 'L05', nome: 'FL05' }], responder: url => {
    if (tableFrom(url) === 'lotes') return { ok: false, status: 500, dados: { message: 'boom' } };
    return { ok: true, dados: [] };
  }});
  assert.equal(await app.context.adminScopeIniciar(), false);
  assert.deepEqual(plain(app.context.adminScopeRegistros()), []);
  assert.equal(app.context.ADMIN_SCOPE.atualizado, null);
  assert.match(app.context.ADMIN_SCOPE.erro, /Falha/);
  assert.equal(app.elements.adminDesktopScopeRetry.hidden, false);
  assert.match(app.elements.adminDesktopScopeSource.textContent, /nenhum snapshot seguro/);
});

test('sem lojas autorizadas não consulta tabelas nem permite snapshot', async () => {
  const app = makeContext({ lojas: [], responder: url => { throw new Error('não deveria consultar: ' + url); } });
  assert.equal(await app.context.adminScopeIniciar(), false);
  assert.deepEqual(plain(app.context.adminScopeRegistros()), []);
  assert.match(app.context.ADMIN_SCOPE.erro, /Nenhuma loja autorizada/);
  assert.equal(app.calls.length, 0);
  assert.deepEqual(plain(app.context.adminScopeFiltrarUsuarios([{ id: 'u1', lojas: ['L05'] }])), []);
});

test('payload móvel permanece sem escopo e logout limpa tudo', async () => {
  const app = makeContext({ mobile: true, lojas: [{ id: 'L05', nome: 'FL05' }], responder: normalResponder });
  assert.deepEqual(plain(app.context.adminScopeUsuariosPayload()), { acao: 'listar' });
  await app.context.adminScopeIniciar();
  app.context.adminScopeLimpar();
  assert.deepEqual(plain(app.context.adminScopeRegistros()), []);
  assert.equal(app.context.ADMIN_SCOPE.atualizado, null);
  assert.equal(app.context.ADMIN_SCOPE.chaveBase, null);
  assert.equal(app.context.ADMIN_SCOPE.seq > 0, true);
});

test('catálogo busca todos os 251 EANs em lotes de 100 com no máximo duas consultas paralelas', async () => {
  let running = 0, maximum = 0, batches = 0;
  const lotes = Array.from({ length: 251 }, (_, i) => ({ id: 'l'+i, loja_id: 'L05', ean: String(7890000000000+i), qtd: 1, val: '2030-01-01' }));
  const app = makeContext({ lojas: [{ id: 'L05', nome: 'FL05' }], responder: url => {
    const table = tableFrom(url);
    if (table === 'lotes') return { ok: true, dados: lotes };
    if (table === 'pere_regs' || table === 'pere_itens') return { ok: true, dados: [] };
    if (table === 'catalogo') {
      batches++; running++; maximum = Math.max(maximum, running);
      const eans = new URL('https://teste.invalid'+url).searchParams.get('ean').slice(4,-1).split(',');
      assert.ok(eans.length <= 100);
      return new Promise(resolve => setTimeout(() => { running--; resolve({ ok: true, dados: eans.map(ean => ({ ean, nome: 'Nome '+ean, marca: '' })) }); }, 2));
    }
    throw new Error('Consulta inesperada');
  }});
  assert.equal(await app.context.adminScopeIniciar(), true);
  assert.equal(batches, 3);
  assert.ok(maximum <= 2);
  assert.equal(app.context.adminScopeRegistros().length, 251);
  assert.equal(app.context.adminScopeRegistros().at(-1).nome, 'Nome '+lotes.at(-1).ean);
  assert.equal(app.context.ADMIN_SCOPE.truncadoTabelas.catalogo, false);
});

test('data de atualização não é inventada como data de criação para a evolução diária', () => {
  const app = makeContext({ lojas: [], responder: () => ({ok:true,dados:[]}) });
  assert.equal(app.context.adminScopeValorCriado({ updated_at: '2026-11-12T10:00:00Z' }), 0);
  assert.equal(app.context.adminScopeValorCriado({ criado: null, updated_at: '2026-11-12T10:00:00Z' }), 0);
  assert.equal(app.context.adminScopeValorCriado({ criado: '2026-11-11T10:00:00Z' }), '2026-11-11T10:00:00Z');
});
