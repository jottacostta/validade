const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The helper is intentionally dependency-free. This small loader executes the same
// source under Node while removing only Deno/TypeScript module export syntax.
function loadScopeHelper() {
  const file = path.join(__dirname, '../supabase/functions/gerir-usuarios/scope.ts');
  const source = fs.readFileSync(file, 'utf8').replace(/\bexport\s+/g, '');
  const module = { exports: {} };
  new Function('module', `${source}\nmodule.exports = { resolveListScope, buildScopedUserList };`)(module);
  return module.exports;
}

function fixture(permitidas = new Set(['FL15', 'FL05'])) {
  return {
    permitidas,
    perfis: [
      { id: 'u-multi', nome: 'Multi Loja', papel: 'operador' },
      { id: 'u-fl05', nome: 'Somente FL05', papel: 'operador' },
      { id: 'u-fora', nome: 'Fora do escopo', papel: 'operador' },
      { id: 'u-sem-loja', nome: 'Sem vínculo', papel: 'admin' },
    ],
    membros: [
      { user_id: 'u-multi', loja_id: 'FL15' },
      { user_id: 'u-multi', loja_id: 'FL05' },
      { user_id: 'u-fl05', loja_id: 'FL05' },
      { user_id: 'u-fora', loja_id: 'FL99' },
    ],
    lojas: [
      { id: 'FL15', nome: 'Filial 15' },
      { id: 'FL05', nome: 'Filial 05' },
      { id: 'FL99', nome: 'Filial 99' },
    ],
    emailPorId: {
      'u-multi': 'multi@loja.validade',
      'u-fl05': 'fl05@loja.validade',
      'u-fora': 'fora@loja.validade',
      'u-sem-loja': 'semloja@loja.validade',
    },
    escopoTotal: true,
  };
}

test('resolve loja_id específica, incluindo IDs simples de mocks e UUIDs', () => {
  const { resolveListScope } = loadScopeHelper();
  assert.deepEqual(resolveListScope({ acao: 'listar', loja_id: 'FL15' }), {
    ok: true,
    scope: { kind: 'specific', lojaId: 'FL15' },
  });
  assert.deepEqual(resolveListScope({ acao: 'listar', loja_id: 'FL05' }), {
    ok: true,
    scope: { kind: 'specific', lojaId: 'FL05' },
  });
  assert.deepEqual(resolveListScope({ loja_id: '550e8400-e29b-41d4-a716-446655440000' }), {
    ok: true,
    scope: { kind: 'specific', lojaId: '550e8400-e29b-41d4-a716-446655440000' },
  });
});

test('filtro FL15 retorna somente usuários vinculados e separa cache completo da visão filtrada', () => {
  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const parsed = resolveListScope({ acao: 'listar', loja_id: 'FL15' });
  const result = buildScopedUserList({ ...fixture(), scope: parsed.scope });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.usuarios.map((user) => user.id), ['u-multi']);
  assert.deepEqual(result.data.usuarios[0].lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
  assert.deepEqual(result.data.usuarios[0].lojas_no_escopo, [{ id: 'FL15', nome: 'Filial 15' }]);
  assert.deepEqual(result.data.lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
});

test('filtro FL05 inclui usuário exclusivo e multiloja e restringe a visão a FL05', () => {
  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const parsed = resolveListScope({ acao: 'listar', loja_id: 'FL05' });
  const result = buildScopedUserList({ ...fixture(), scope: parsed.scope });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.usuarios.map((user) => user.id), ['u-fl05', 'u-multi']);
  const multi = result.data.usuarios.find((user) => user.id === 'u-multi');
  assert.deepEqual(multi.lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
  assert.deepEqual(multi.lojas_no_escopo, [{ id: 'FL05', nome: 'Filial 05' }]);
  assert.deepEqual(result.data.lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
});

test('escopo=todas retorna apenas lojas permitidas, deduplica multiloja e exclui sem vínculo', () => {
  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const parsed = resolveListScope({ acao: 'listar', escopo: 'todas' });
  const result = buildScopedUserList({ ...fixture(), scope: parsed.scope });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.usuarios.map((user) => user.id), ['u-fl05', 'u-multi']);
  assert.equal(result.data.usuarios.filter((user) => user.id === 'u-multi').length, 1);
  const multi = result.data.usuarios.find((user) => user.id === 'u-multi');
  assert.deepEqual(multi.lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
  assert.deepEqual(result.data.lojas, [
    { id: 'FL15', nome: 'Filial 15' },
    { id: 'FL05', nome: 'Filial 05' },
  ]);
});

test('loja fora do conjunto permitido é rejeitada antes de montar a resposta', () => {
  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const parsed = resolveListScope({ acao: 'listar', loja_id: 'FL99' });
  const result = buildScopedUserList({ ...fixture(), scope: parsed.scope });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error, /fora do escopo/i);
});

test('formato inválido e escopo desconhecido são rejeitados', () => {
  const { resolveListScope } = loadScopeHelper();
  for (const body of [
    { loja_id: '' },
    { loja_id: 15 },
    { loja_id: 'not-a-uuid' },
    { loja_id: 'FL15', escopo: 'regional' },
    { loja_id: 'FL15', escopo: 'todas' },
    { escopo: null },
  ]) {
    const result = resolveListScope(body);
    assert.equal(result.ok, false, `deveria rejeitar ${JSON.stringify(body)}`);
    assert.match(result.error, /inválid|informe/i);
  }
});

test('ausência de filtro preserva o legado do admin, inclusive perfil sem vínculo', () => {
  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const parsed = resolveListScope({ acao: 'listar' });
  const result = buildScopedUserList({
    ...fixture(new Set(['FL15', 'FL05', 'FL99'])),
    scope: parsed.scope,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.usuarios.map((user) => user.id), [
    'u-fl05',
    'u-fora',
    'u-multi',
    'u-sem-loja',
  ]);
  assert.deepEqual(result.data.usuarios.find((user) => user.id === 'u-sem-loja').lojas, []);
  assert.deepEqual(result.data.usuarios.find((user) => user.id === 'u-fora').lojas, [
    { id: 'FL99', nome: 'Filial 99' },
  ]);
});
