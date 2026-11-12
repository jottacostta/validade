const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `função ${name} não encontrada`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`corpo incompleto para ${name}`);
}

const stateStart = app.indexOf('var papelConfirmado=');
const stateEnd = app.indexOf('function atualizarModoDesktopAdmin', stateStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart, 'estado de papel não encontrado');
const roleState = app.slice(stateStart, stateEnd);
const roleFunctions = [
  'papelAtual',
  'adminDesktopAtivo',
  'pode',
  'carregarPapel',
].map(name => extractFunction(app, name)).join('\n');

function makeHarness(initial, { supabase = true, online = true } = {}) {
  const storage = new Map();
  const pending = [];
  const context = {
    console,
    Promise,
    JSON,
    encodeURIComponent,
    Object,
    Array,
    String,
    Number,
    Error,
    navigator: { onLine: online },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    pending,
    window: { matchMedia: () => ({ matches: true }) },
    document: { documentElement: { classList: { contains() { return false; }, toggle() {} } } },
  };
  const source = `
    var SESS = ${JSON.stringify(initial)};
    var PAPEIS = { operador: 'Operador', assistente: 'Assistente', analista: 'Analista', gerente: 'Gerente', admin: 'Administrador' };
    var uiUpdates = 0, modeUpdates = 0, saved = null;
    function sbOn() { return ${supabase ? 'true' : 'false'}; }
    function logado() { return !!(SESS && SESS.access_token); }
    function salvarSess() { saved = SESS ? JSON.parse(JSON.stringify(SESS)) : null; }
    function carregarPrefs() {}
    function carregarRegrasAlertas() {}
    function carregarPermissoes() {}
    function atualizarModoDesktopAdmin() { modeUpdates += 1; }
    function atualizarInterfacePapel() { uiUpdates += 1; }
    function temPermissao() { return true; }
    function sbReq(path) { return new Promise(function(resolve, reject) { pending.push({ path: path, resolve: resolve, reject: reject }); }); }
    ${roleState}
    ${roleFunctions}
    this.__api = {
      begin: function() { return carregarPapel(); },
      getSession: function() { return SESS; },
      setSession: function(s) { SESS = s; },
      logout: function() { SESS = null; papelConfirmado = false; papelConfirmadoUid = null; papelConfirmadoToken = null; },
      setOnline: function(v) { navigator.onLine = v; },
      pendingCount: function() { return pending.length; },
      resolve: function(i, value) { pending[i].resolve(value); },
      reject: function(i, error) { pending[i].reject(error || new Error('network')); },
      role: function() { return papelAtual(); },
      can: function(action) { return pode(action); },
      desktop: function() { return adminDesktopAtivo(); },
      confirmed: function() { return papelConfirmado; },
      uiUpdates: function() { return uiUpdates; },
      modeUpdates: function() { return modeUpdates; },
      saved: function() { return saved; },
      cache: function() { return JSON.parse(localStorage.getItem('perfil_papel_cache') || '{}'); },
    };
  `;
  vm.runInNewContext(source, context, { filename: 'profile-role-harness.js' });

  return {
    api: context.__api,
    begin() { return context.__api.begin(); },
    flush() { return new Promise(resolve => setImmediate(resolve)); },
  };
}

function session(uid, token, papel = null, nome = undefined) {
  return { uid, access_token: token, papel, nome, lojaId: 'loja-1', forcePasswordChange: false };
}

test('ignora resposta antiga ao trocar do usuário A para B enquanto o GET está pendente', async () => {
  const h = makeHarness(session('u-a', 'tok-a', 'admin', 'Administrador A'));
  const a = h.begin();
  await h.flush();
  h.api.setSession(session('u-b', 'tok-b'));
  const b = h.begin();
  await h.flush();

  h.api.resolve(0, { ok: true, dados: [{ papel: 'admin', nome: 'Administrador A' }] });
  await a;
  assert.equal(h.api.getSession().uid, 'u-b');
  assert.equal(h.api.getSession().papel, null);
  assert.equal(h.api.role(), 'operador');
  assert.equal(h.api.confirmed(), false);
  assert.equal(h.api.uiUpdates(), 0, 'callback antigo não pode atualizar a UI');
  assert.deepEqual(h.api.cache(), {}, 'callback antigo não pode gravar cache de papel');

  h.api.resolve(1, { ok: true, dados: [{ papel: 'operador', nome: 'Operador B' }] });
  await b;
  assert.deepEqual(h.api.getSession(), session('u-b', 'tok-b', 'operador', 'Operador B'));
  assert.equal(h.api.role(), 'operador');
  assert.equal(h.api.can('admin'), false);
  assert.equal(h.api.uiUpdates(), 1);
});

test('logout sem resposta impede qualquer mutação tardia do callback', async () => {
  const h = makeHarness(session('u-a', 'tok-a', 'admin', 'Administrador A'));
  const request = h.begin();
  await h.flush();
  h.api.logout();
  h.api.resolve(0, { ok: true, dados: [{ papel: 'admin', nome: 'Administrador A' }] });
  await request;
  assert.equal(h.api.getSession(), null);
  assert.equal(h.api.uiUpdates(), 0);
  assert.deepEqual(h.api.cache(), {});
});

test('erro HTTP do perfil atual limpa papel local e falha fechado', async () => {
  const h = makeHarness(session('u-a', 'tok-a', 'admin', 'Administrador A'));
  const request = h.begin();
  await h.flush();
  h.api.resolve(0, { ok: false, status: 401, dados: { message: 'unauthorized' } });
  await request;
  assert.equal(h.api.getSession().papel, null);
  assert.equal(h.api.role(), 'operador');
  assert.equal(h.api.can('admin'), false);
  assert.equal(h.api.confirmed(), false);
  assert.equal(h.api.desktop(), false);
  assert.equal(h.api.uiUpdates(), 1);
});

test('resposta antiga do mesmo UID fica obsoleta quando o token é renovado', async () => {
  const h = makeHarness(session('u-a', 'tok-old', 'admin', 'Administrador A'));
  const oldRequest = h.begin();
  await h.flush();
  h.api.getSession().access_token = 'tok-new';
  const newRequest = h.begin();
  await h.flush();

  h.api.resolve(0, { ok: true, dados: [{ papel: 'admin', nome: 'Resposta antiga' }] });
  await oldRequest;
  assert.equal(h.api.role(), 'operador');
  assert.equal(h.api.getSession().nome, 'Administrador A');
  assert.equal(h.api.uiUpdates(), 0);

  h.api.resolve(1, { ok: true, dados: [{ papel: 'gerente', nome: 'Gerente atual' }] });
  await newRequest;
  assert.equal(h.api.getSession().access_token, 'tok-new');
  assert.equal(h.api.getSession().papel, 'gerente');
  assert.equal(h.api.getSession().nome, 'Gerente atual');
  assert.equal(h.api.role(), 'gerente');
  assert.equal(h.api.desktop(), true);
  assert.equal(h.api.uiUpdates(), 1);
});

test('aceita cada papel somente quando o perfil atual responde com papel válido', async () => {
  const h = makeHarness(session('u-a', 'tok-a'));
  for (const papel of ['operador', 'assistente', 'analista', 'gerente', 'admin']) {
    const request = h.begin();
    await h.flush();
    h.api.resolve(h.api.pendingCount() - 1, { ok: true, dados: [{ papel, nome: `Nome ${papel}` }] });
    await request;
    assert.equal(h.api.role(), papel);
    assert.equal(h.api.getSession().papel, papel);
    assert.equal(h.api.confirmed(), true);
  }
  assert.equal(h.api.desktop(), true, 'Administrador confirmado pode usar o desktop');
  assert.equal(h.api.can('admin'), true);
});

test('não usa cache de outro UID na falha, mas conserva o cache do próprio UID offline', async () => {
  const h = makeHarness(session('u-a', 'tok-a'));
  const first = h.begin();
  await h.flush();
  h.api.resolve(0, { ok: true, dados: [{ papel: 'admin', nome: 'Administrador A' }] });
  await first;
  assert.equal(h.api.cache()['u-a'].papel, 'admin');

  h.api.setSession(session('u-b', 'tok-b'));
  h.api.setOnline(false);
  const other = h.begin();
  await h.flush();
  h.api.reject(1);
  await other;
  assert.equal(h.api.role(), 'operador', 'cache de A não pode autorizar B');
  assert.equal(h.api.getSession().papel, null);
  assert.equal(h.api.confirmed(), false);

  h.api.setSession(session('u-a', 'tok-a-2'));
  const same = h.begin();
  await h.flush();
  h.api.reject(2);
  await same;
  assert.equal(h.api.role(), 'admin', 'cache por UID mantém compatibilidade offline do próprio usuário');
  assert.equal(h.api.confirmed(), true);
  assert.equal(h.api.desktop(), true);
});

test('mantém o papel manual do modo sem Supabase', () => {
  const h = makeHarness(session('local', 'manual', 'admin'), { supabase: false });
  assert.equal(h.api.role(), 'admin');
  assert.equal(h.api.can('admin'), true);
  assert.equal(h.api.desktop(), false, 'desktop administrativo continua dependente do backend');
});
