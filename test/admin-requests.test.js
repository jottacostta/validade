const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
const source = HTML.split('/* BEGIN ADMIN_REQUESTS */')[1].split('/* END ADMIN_REQUESTS */')[0];

class MockElement {
  constructor(id, parent = null) {
    this.id = id;
    this.parentNode = parent;
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener({ ...event, type, target: event.target || this });
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  contains(node) {
    if (node === this) return true;
    let current = node && node.parentNode;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  closest(selector) {
    if (selector.indexOf('data-admin-request-type') >= 0 && this.getAttribute('data-admin-request-type')) return this;
    return null;
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeHarness(options = {}) {
  const ids = [
    'adminDesktopRequests', 'adminRequestRefresh', 'adminRequestScope', 'adminRequestStatus',
    'adminRequestTruncation', 'adminRequestNamePanel', 'adminRequestExclusionPanel',
    'adminRequestNameList', 'adminRequestExclusionList', 'adminRequestPendingTotal',
    'adminRequestPendingName', 'adminRequestPendingExclusion', 'adminRequestNameCount',
    'adminRequestExclusionCount', 'adminRequestBadge', 'adminRequestOverviewCount'
  ];
  const elements = Object.create(null);
  for (const id of ids) elements[id] = new MockElement(id);
  elements.adminDesktopRequests.children = [];
  elements.adminDesktopRequests.contains = node => node === elements.adminDesktopRequests || node?.parentNode === elements.adminDesktopRequests;

  const document = {
    getElementById(id) { return elements[id] || null; },
    addEventListener() {}
  };

  const scope = {
    uid: 'u1',
    papel: 'gerente',
    sessionLoja: 'FL15',
    selected: 'FL15',
    key: 'u1|gerente|FL15|FL15',
    query: 'loja_id=eq.FL15',
    label: 'Loja FL15',
    lojas: [{ id: 'FL15', nome: 'Filial 15' }, { id: 'FL05', nome: 'Filial 05' }]
  };
  const permissions = { nome_editar: true, exclusoes_aprovar: true };
  const calls = [];
  const actions = [];
  let requestImpl = null;
  const nameRows = options.nameRows || [{
    id: 'n1', loja_id: 'FL15', ean: '789', nome_atual: 'Arroz', nome_sugerido: 'Arroz Premium',
    status: 'pendente', resposta: null, solicitante_nome: 'Ana', criado_em: '2026-11-01T10:00:00Z'
  }];
  const exclusionRows = options.exclusionRows || [{
    id: 'e1', loja_id: 'FL15', tipo: 'lote', registro_id: 'l1', motivo: 'Duplicado',
    status: 'pendente', resposta: null, criado_em: '2026-11-01T11:00:00Z', solicitante_nome: 'Bruno'
  }];

  const context = {
    console,
    Promise,
    Date,
    Array,
    Object,
    JSON,
    String,
    Number,
    Boolean,
    isFinite,
    window: null,
    document,
    SESS: { uid: 'u1', papel: 'gerente', lojaId: 'FL15', lojaNome: 'Filial 15' },
    ADMIN_SCOPE: { lojas: { FL15: { nome: 'Filial 15' }, FL05: { nome: 'Filial 05' } } },
    adminScopeAtual: () => scope,
    adminScopeFiltrarAuditoria: () => scope.query,
    adminScopeRotulo: () => scope.label,
    adminDesktopAtivo: () => true,
    temPermissao: id => permissions[id] !== false,
    esc: escapeHtml,
    fdataHora: stamp => new Date(stamp).toISOString(),
    revisarCorrecaoNome: (id, approve) => actions.push(['nome', id, approve]),
    revisarSolicitacaoExclusao: (id, approve) => actions.push(['exclusao', id, approve]),
    sbReq: url => {
      calls.push(url);
      if (requestImpl) return requestImpl(url);
      const table = url.includes('/solicitacoes_nome?') ? 'name' : 'exclusion';
      const offset = Number(new URL('https://test.invalid' + url).searchParams.get('offset'));
      const rows = table === 'name' ? nameRows : exclusionRows;
      return Promise.resolve({ ok: true, dados: rows.slice(offset, offset + 100) });
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'requests.js' });

  return {
    context,
    scope,
    permissions,
    calls,
    actions,
    elements,
    setRequestImpl(fn) { requestImpl = fn; },
    async load(force = true) { return context.adminRequestsCarregar(force); },
    click(type, id, approve) {
      const button = new MockElement('button', elements.adminDesktopRequests);
      button.setAttribute('data-admin-request-type', type);
      button.setAttribute('data-admin-request-id', id);
      button.setAttribute('data-admin-request-approve', String(approve));
      elements.adminDesktopRequests.dispatch('click', { target: button });
    }
  };
}

const test = require('node:test');

function matchingCalls(calls, table) {
  return calls.filter(url => url.includes('/' + table + '?'));
}

test('filtra FL15, pagina com limit 100 e também aceita o escopo all via loja_id=in', async () => {
  const h = makeHarness({ nameRows: Array.from({ length: 101 }, (_, i) => ({
    id: 'n' + i, loja_id: 'FL15', ean: String(i), nome_atual: 'A', nome_sugerido: 'B', status: 'pendente', criado_em: '2026-11-01T00:00:00Z', solicitante_nome: 'A'
  })) });
  await h.load(true);
  const firstName = matchingCalls(h.calls, 'solicitacoes_nome');
  assert.equal(firstName.length, 2);
  assert.match(firstName[0], /status=eq\.pendente/);
  assert.match(firstName[0], /loja_id=eq\.FL15/);
  assert.match(firstName[0], /order=criado_em\.asc/);
  assert.match(firstName[0], /limit=100&offset=0/);
  assert.match(firstName[1], /limit=100&offset=100/);
  assert.equal(h.elements.adminRequestPendingName.textContent, '101');
  assert.equal(h.elements.adminRequestPendingTotal.textContent, '102');

  h.scope.selected = ['FL15', 'FL05'];
  h.scope.key = 'u1|gerente|FL15|all';
  h.scope.query = 'loja_id=in.(FL15,FL05)';
  h.scope.label = 'Todas as lojas';
  h.elements.adminRequestNameList.innerHTML = 'valor da FL15';
  await h.load(true);
  const lastName = matchingCalls(h.calls, 'solicitacoes_nome').at(-1);
  assert.match(lastName, /loja_id=in\.\(FL15,FL05\)/);
  assert.equal(h.elements.adminRequestScope.textContent, 'Todas as lojas');
});

test('escapa nomes, solicitantes, motivos e labels de loja no HTML', async () => {
  const h = makeHarness({
    nameRows: [{ id: 'n<1', loja_id: 'FL15', ean: '7"9', nome_atual: '<b>atual</b>', nome_sugerido: '<img src=x onerror=alert(1)>', status: 'pendente', criado_em: '2026-11-01T00:00:00Z', solicitante_nome: '<script>alert(1)</script>' }],
    exclusionRows: [{ id: 'e1', loja_id: 'FL15', tipo: 'pere_reg', registro_id: 'r1', motivo: '<svg onload=alert(1)>', status: 'pendente', criado_em: '2026-11-01T00:00:00Z', solicitante_nome: '<i>bad</i>' }]
  });
  await h.load(true);
  const html = h.elements.adminRequestNameList.innerHTML + h.elements.adminRequestExclusionList.innerHTML;
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg/);
});

test('sem permissão não consulta o tipo e não o renderiza', async () => {
  const h = makeHarness();
  h.permissions.nome_editar = false;
  await h.load(true);
  assert.equal(matchingCalls(h.calls, 'solicitacoes_nome').length, 0);
  assert.equal(matchingCalls(h.calls, 'solicitacoes_exclusao').length, 1);
  assert.equal(h.elements.adminRequestNamePanel.hidden, true);
  assert.equal(h.elements.adminRequestPendingName.textContent, '0');
  assert.doesNotMatch(h.elements.adminRequestNameList.innerHTML, /data-admin-request-approve/);
});

test('falha REST informa o estado sem conservar dados anteriores', async () => {
  const h = makeHarness();
  await h.load(true);
  h.setRequestImpl(url => url.includes('/solicitacoes_nome?')
    ? Promise.reject(new Error('rede indisponível'))
    : Promise.resolve({ ok: true, dados: [] }));
  await h.load(true);
  assert.match(h.elements.adminRequestStatus.textContent, /Falha ao carregar correções de nome/);
  assert.equal(h.elements.adminRequestPendingTotal.textContent, '0');
  assert.doesNotMatch(h.elements.adminRequestNameList.innerHTML, /Arroz Premium/);
});

test('resposta stale não sobrescreve o escopo FL05 mais novo', async () => {
  const h = makeHarness();
  const pending = [];
  h.setRequestImpl(url => new Promise(resolve => pending.push({ url, resolve })));

  const first = h.load(true);
  h.scope.sessionLoja = 'FL05';
  h.scope.selected = 'FL05';
  h.scope.key = 'u1|gerente|FL05|FL05';
  h.scope.query = 'loja_id=eq.FL05';
  h.scope.label = 'Filial 05';
  const second = h.load(true);

  const resolvePage = item => item.resolve({ ok: true, dados: [{
    id: item.url.includes('FL05') ? 'novo' : 'antigo', loja_id: item.url.includes('FL05') ? 'FL05' : 'FL15',
    ean: '1', nome_atual: 'atual', nome_sugerido: item.url.includes('FL05') ? 'Novo' : 'Antigo', status: 'pendente',
    criado_em: '2026-11-01T00:00:00Z', solicitante_nome: 'Pessoa'
  }] });
  for (const item of pending.filter(x => x.url.includes('FL05'))) resolvePage(item);
  await second;
  for (const item of pending.filter(x => x.url.includes('FL15'))) resolvePage(item);
  await first;

  assert.equal(h.elements.adminRequestScope.textContent, 'Filial 05');
  assert.match(h.elements.adminRequestNameList.innerHTML, /Novo/);
  assert.doesNotMatch(h.elements.adminRequestNameList.innerHTML, /Antigo/);
});

test('delegação chama cada wrapper existente uma vez e não chama RPC própria', async () => {
  const h = makeHarness();
  await h.load(true);
  h.click('nome', 'n1', true);
  h.click('exclusao', 'e1', false);
  assert.deepEqual(h.actions, [['nome', 'n1', true], ['exclusao', 'e1', false]]);
  assert.equal(h.calls.filter(url => url.includes('/rpc/')).length, 0);
});

test('limpar no logout zera contadores, badge e listas', async () => {
  const h = makeHarness();
  await h.load(true);
  h.context.adminRequestsLimpar();
  assert.equal(h.elements.adminRequestPendingTotal.textContent, '0');
  assert.equal(h.elements.adminRequestBadge.hidden, true);
  assert.equal(h.elements.adminRequestNameList.innerHTML, '');
  assert.equal(h.elements.adminRequestExclusionList.innerHTML, '');
  assert.match(h.elements.adminRequestStatus.textContent, /Sessão encerrada/);
});
