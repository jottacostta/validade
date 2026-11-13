const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const html = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
const source = html.split('/* BEGIN ADMIN_RECORDS */')[1].split('/* END ADMIN_RECORDS */')[0];
const compiled = new Module(__filename, module);
compiled._compile(source, __filename);
const records = compiled.exports;

const lote = {
  tipo: 'Lote',
  id: 'lot-1',
  lojaId: 'store-1',
  lojaNome: 'Filial Centro',
  codigo: '7890000000001',
  nome: 'Arroz',
  marca: 'Marca A',
  lote: 'L-01',
  quantidade: 7,
  setor: 'Mercearia',
  localizacao: 'Área de Vendas',
  validade: '2026-11-14',
  dias: 2,
  informante: 'Operador',
  informanteId: 'u-owner',
  recolhido: false
};

function makeDeps(overrides = {}) {
  let scope = overrides.scopeKey ?? 'store-1';
  const calls = [];
  const confirmations = [];
  const session = overrides.session || {
    uid: 'u-admin',
    access_token: 'jwt-normal-user',
    papel: 'admin',
    nome: 'Admin Teste',
    lojaId: 'store-1',
    lojaNome: 'Filial Centro'
  };
  const permissions = overrides.permissions || {};
  const deps = {
    session,
    active: overrides.active ?? true,
    scopeKey: () => scope,
    online: true,
    sectors: ['Açougue', 'Laticínios', 'Padaria', 'Salgados', 'FLV', 'Mercearia'],
    temPermissao: (name) => session.papel === 'admin' || permissions[name] !== false,
    confirm: (message) => {
      confirmations.push(message);
      return overrides.confirmResult !== false;
    },
    sbReq: (path, requestOptions) => {
      calls.push({ path, requestOptions });
      if (overrides.onRequest) overrides.onRequest({ path, requestOptions, setScope: (value) => { scope = value; } });
      if (path.includes('/admin_excluir_registro_auditado')) return Promise.resolve({ ok: true, status: 200, dados: {excluido:true,auditado:true} });
      if (overrides.response) return Promise.resolve(overrides.response(path, requestOptions));
      return Promise.resolve({ ok: true, status: 200, dados: [{ id: 'server-row' }] });
    },
    recollectionRpc: 'current'
  };
  Object.assign(deps, overrides);
  deps.calls = calls;
  deps.confirmations = confirmations;
  deps.getScope = () => scope;
  return deps;
}

test('payload de edição usa somente whitelist, converte qtd/location e exige data real', () => {
  const payload = records.buildEditPayload(lote, {
    lote: 'L-02',
    qtd: '12',
    val: '2026-12-01',
    setor: 'Mercearia',
    localizacao: 'false',
    nome: 'não deve entrar',
    created_by: 'forjado',
    id: 'forjado'
  }, { sectors: ['Mercearia'] });

  assert.deepEqual(payload, {
    lote: 'L-02',
    qtd: 12,
    val: '2026-12-01',
    setor: 'Mercearia',
    em_area_vendas: false
  });
  assert.equal(records.isRealDate('2026-02-29'), false);
  assert.throws(() => records.buildEditPayload(lote, {
    lote: 'L-02', qtd: '1.5', val: '2026-12-01', setor: 'Mercearia', localizacao: 'true'
  }, { sectors: ['Mercearia'] }), /inteiro positivo/);
  assert.throws(() => records.buildEditPayload(lote, {
    lote: 'L-02', qtd: '1', val: '2026-02-29', setor: 'Mercearia', localizacao: 'true'
  }, { sectors: ['Mercearia'] }), /data real/);
});

test('admin edita um lote por id + loja_id + tombstone nulo e confirma exatamente uma linha', async () => {
  const deps = makeDeps();
  const result = await records.createActionFacade(deps).edit(lote, {
    lote: 'L-02', qtd: '8', val: '2026-11-20', setor: 'Mercearia', localizacao: 'true'
  });

  assert.equal(result.ok, true);
  assert.equal(deps.calls.length, 1);
  assert.match(deps.calls[0].path, /^\/rest\/v1\/lotes\?id=eq\.lot-1&loja_id=eq\.store-1&deleted_at=is\.null$/);
  assert.deepEqual(deps.calls[0].requestOptions.body, {
    lote: 'L-02', qtd: 8, val: '2026-11-20', setor: 'Mercearia', em_area_vendas: true
  });
  assert.equal(deps.calls[0].requestOptions.headers.Prefer, 'return=representation');
  assert.equal(deps.confirmations.length, 0, 'edição não pede confirmação destrutiva');
});

test('recolhimento de gerente elegível pede confirmação e faz uma única chamada ao RPC solicitado', async () => {
  const manager = { ...lote, dias: 3, informanteId: 'u-other' };
  const deps = makeDeps({
    session: { uid: 'u-manager', access_token: 'jwt', papel: 'gerente', nome: 'Gerente', lojaId: 'store-1' },
    permissions: { registros_recolher: true, registros_editar_outros: true }
  });
  const result = await records.createActionFacade(deps).collect(manager);

  assert.equal(result.ok, true);
  assert.equal(deps.confirmations.length, 1);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].path, '/rest/v1/rpc/marcar_registro_recolhido');
  assert.deepEqual(deps.calls[0].requestOptions.body, {
    p_tipo: 'lote', p_id: 'lot-1', p_loja_id: 'store-1'
  });
});

test('reativação usa o papel fixo elegível, confirmação e uma única chamada', async () => {
  const recolhido = { ...lote, recolhido: true, recolhidoEm: '2026-11-10T10:00:00Z', dias: -2 };
  const deps = makeDeps({
    session: { uid: 'u-assistant', access_token: 'jwt', papel: 'assistente', nome: 'Assistente', lojaId: 'store-1' },
    permissions: { registros_recolher: false }
  });
  const result = await records.createActionFacade(deps).restore(recolhido);

  assert.equal(result.ok, true);
  assert.equal(deps.confirmations.length, 1);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].path, '/rest/v1/rpc/restaurar_registro_recolhido');
  assert.deepEqual(deps.calls[0].requestOptions.body, {
    p_tipo: 'lote', p_id: 'lot-1', p_loja_id: 'store-1'
  });
});

test('gerente sem registros_recolher é recusado antes de confirmação/request', async () => {
  const deps = makeDeps({
    session: { uid: 'u-manager', access_token: 'jwt', papel: 'gerente', lojaId: 'store-1' },
    permissions: { registros_recolher: false }
  });
  const facade = records.createActionFacade(deps);
  assert.equal(facade.canCollect({ ...lote, dias: 2 }), false);
  await assert.rejects(() => facade.collect({ ...lote, dias: 2 }), /não pode ser recolhido/);
  assert.equal(deps.confirmations.length, 0);
  assert.equal(deps.calls.length, 0);
});

test('somente administrador pode excluir, preservando auditoria na loja real do registro', async () => {
  const allScopeRow = { ...lote, lojaId: 'store-2', lojaNome: 'Filial Norte' };
  const deps = makeDeps({ scopeKey: 'all' });
  const result = await records.createActionFacade(deps).remove(allScopeRow);

  assert.equal(result.ok, true);
  assert.equal(deps.confirmations.length, 1);
  assert.equal(deps.calls.length, 1, 'RPC transacional confirma tombstone e auditoria juntos');
  assert.equal(deps.calls[0].path, '/rest/v1/rpc/admin_excluir_registro_auditado');
  assert.equal(deps.calls[0].requestOptions.method, 'POST');
  assert.deepEqual(deps.calls[0].requestOptions.body, {p_tipo:'lote',p_id:'lot-1',p_loja_id:'store-2'});
  assert.ok(!Object.hasOwn(deps.calls[0].requestOptions.body,'usuario'));
  assert.ok(!Object.hasOwn(deps.calls[0].requestOptions.body,'user_id'));
});

test('gerente não atravessa o gating de exclusão administrativa', async () => {
  const deps = makeDeps({
    session: { uid: 'u-manager', access_token: 'jwt', papel: 'gerente', lojaId: 'store-1' }
  });
  const facade = records.createActionFacade(deps);
  assert.equal(facade.canDelete(lote), false);
  await assert.rejects(() => facade.remove(lote), /exclusão direta é exclusiva/);
  assert.equal(deps.confirmations.length, 0);
  assert.equal(deps.calls.length, 0);
});

test('alvo adulterado de outra loja não passa pela lista/escopo exatos', () => {
  assert.equal(records.findExactTarget({ tipo: 'Lote', id: 'lot-1', lojaId: 'store-2' }, [lote]), null);
  const deps = makeDeps();
  assert.equal(records.scopeAllowsRow({ ...lote, lojaId: 'store-2' }, deps), false);
  assert.equal(records.scopeAllowsRow(lote, deps), true);
});

test('stale de loja durante a resposta não é aplicado como sucesso para o novo escopo', async () => {
  const deps = makeDeps({
    onRequest: ({ setScope }) => setScope('store-2')
  });
  const result = await records.createActionFacade(deps).edit(lote, {
    lote: 'L-stale', qtd: '2', val: '2026-11-22', setor: 'Mercearia', localizacao: 'true'
  });
  assert.deepEqual(result, { ok: false, stale: true });
  assert.equal(deps.calls.length, 1);
});

test('paginação administrativa mantém limite de 25 por página', () => {
  assert.equal(records.PAGE_SIZE, 25);
  assert.equal(records.normalizeType('perecivel'), 'Perecível');
  assert.equal(records.statusOf({ ...lote, recolhidoEm: '2026-11-12T00:00:00Z' }), 'recolhido');
  assert.equal(records.statusOf({ ...lote, ocultoPorVencimento: true }), 'oculto');
});
