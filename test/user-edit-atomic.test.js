const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const edgePath = path.join(root, 'supabase/functions/gerir-usuarios/index.ts');
const migrationPath = path.join(root, 'supabase/migrations/20261112120000_edicao_usuarios_atomica.sql');
const edge = fs.readFileSync(edgePath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

function loadPureValidator() {
  const constants = [
    edge.match(/^const PAPEIS = .*$/m)?.[0],
    edge.match(/^const COMUNS = .*$/m)?.[0],
    edge.match(/^const UUID = .*$/m)?.[0],
    edge.match(/^const temCampo = .*$/m)?.[0],
  ];
  assert.ok(constants.every(Boolean), 'constantes do validador existem');
  const start = edge.indexOf('export function validarEdicaoBase');
  const end = edge.indexOf('\n}\n\nDeno.serve', start);
  assert.ok(start >= 0 && end > start, 'função pura delimitada antes do servidor');
  const source = edge.slice(start, end + 2).replace(/^export /, '');
  return Function(`${constants.join('\n')}\n${source}\nreturn validarEdicaoBase;`)();
}

const uuid = (n) => `550e8400-e29b-41d4-a716-4466554400${String(n).padStart(2, '0')}`;

test('validador puro aceita edição completa e preserva tipos fechados', () => {
  const validar = loadPureValidator();
  const body = {
    id: uuid(1),
    nome: ' Maria Silva ',
    papel: 'assistente',
    lojas: [uuid(2), uuid(3)],
    senha: 'NovaSenha2026!',
    exigir_troca_senha: true,
  };
  assert.deepEqual(validar(body), {
    ok: true,
    id: uuid(1),
    nome: 'Maria Silva',
    papel: 'assistente',
    lojas: [uuid(2), uuid(3)],
    senha: 'NovaSenha2026!',
    exigirTroca: true,
  });
});

test('validador puro rejeita alvo, nome, papel, senha e lojas inválidos antes do RPC', () => {
  const validar = loadPureValidator();
  const cases = [
    [{ id: 'u2', nome: 'Maria' }, /usuário.*inválido/i],
    [{ id: uuid(1), nome: { texto: 'Maria' } }, /nome/i],
    [{ id: uuid(1), nome: 'Maria', papel: 'superadmin' }, /papel/i],
    [{ id: uuid(1), nome: 'Maria', senha: '123' }, /senha/i],
    [{ id: uuid(1), nome: 'Maria', lojas: [] }, /lojas/i],
    [{ id: uuid(1), nome: 'Maria', lojas: [uuid(2), uuid(2)] }, /repeti/i],
    [{ id: uuid(1), nome: 'Maria', lojas: [uuid(2), 'FL15'] }, /UUID/i],
    [{ id: uuid(1), nome: 'Maria', exigir_troca_senha: true }, /senha/i],
    [{ id: uuid(1), nome: 'Maria', lojas: 'não-array' }, /lojas/i],
  ];
  for (const [body, expected] of cases) {
    const result = validar(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.match(result.error, expected, JSON.stringify(body));
  }
});

test('Edge valida ator/alvo/escopo antes da RPC e nunca faz DELETE/INSERT de vínculos no ramo editar', () => {
  const edit = edge.slice(edge.indexOf('if (acao === "editar")'), edge.indexOf('if (acao === "excluir")'));
  assert.match(edit, /validarEdicaoBase\(body\)/);
  assert.match(edit, /PAPEIS\.includes\(alvo\.papel\)/);
  assert.match(edit, /papel_tem_permissao|gerenciaUsuarios/);
  assert.match(edit, /validarSenha\(senha, usuarioNome\)/);
  assert.match(edit, /lojasPermitidasEdicao/);
  assert.match(edit, /membrosAlvo/);
  assert.match(edit, /lojas\.some\(\(lid\) => !lojasPermitidasResult\.permitidas\.has\(lid\)\)/);
  assert.match(edit, /editar_usuario_atomico/);
  assert.doesNotMatch(edit, /\.from\("perfis"\)\.update/);
  assert.doesNotMatch(edit, /\.from\("loja_membros"\)\.(delete|insert)/);
  assert.ok(edit.indexOf('editar_usuario_atomico') < edit.indexOf('auth.admin.updateUserById'), 'Auth só roda após o commit do RPC');
});

test('migration torna nome/papel/vínculos/auditoria transacionais e fecha a RPC para service_role', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /create or replace function public\.editar_usuario_atomico\(/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /public\.papel_tem_permissao\(v_actor_papel, 'usuarios_gerenciar'\)/);
  assert.match(migration, /select pf\.papel,[\s\S]*coalesce\(nullif\(btrim\(pf\.nome\)/);
  assert.match(migration, /where pf\.id = p_actor_id/);
  assert.match(migration, /for update/);
  assert.match(migration, /count\(distinct x\.loja_id\)/);
  assert.match(migration, /Loja inexistente/);
  assert.match(migration, /Loja fora do escopo do ator/);
  assert.match(migration, /Usuário alvo fora do escopo do ator/);
  assert.match(migration, /delete from public\.loja_membros/);
  assert.match(migration, /insert into public\.loja_membros/);
  assert.match(migration, /insert into public\.auditoria\(user_id, usuario, papel, acao, detalhe\)/);
  assert.match(migration, /v_actor_nome/);
  assert.match(migration, /'senha_solicitada', p_senha_solicitada/);
  assert.match(migration, /revoke all on function public\.editar_usuario_atomico\([^)]*\)\s+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.editar_usuario_atomico\([^)]*\)\s+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.editar_usuario_atomico\([^)]*\)\s+to [^;]*\bauthenticated\b/i);
  assert.match(migration, /notify pgrst/);
  assert.match(migration, /commit;\s*$/);
});

test('contrato Edge distingue SQL confirmado de falha externa de senha', () => {
  const edit = edge.slice(edge.indexOf('if (acao === "editar")'), edge.indexOf('if (acao === "excluir")'));
  assert.match(edit, /cadastro_atualizado: false/);
  assert.match(edit, /senha_atualizada: false/);
  assert.match(edit, /parcial: false/);
  assert.match(edit, /cadastro_atualizado: true/);
  assert.match(edit, /senha_atualizada: false/);
  assert.match(edit, /parcial: true/);
  assert.match(edit, /Cadastro e lojas atualizados, mas não foi possível alterar a senha/);
  assert.match(edit, /Tente alterar somente a senha novamente/);
  assert.match(edit, /}, 200\);/);
});

test('resposta de edição preserva vínculos no servidor, mas não expõe IDs externos ao gerente', () => {
  const source = fs.readFileSync(path.join(root,'supabase/functions/gerir-usuarios/scope.ts'),'utf8').replace(/\bexport\s+/g,'');
  const filter = Function(source+'\nreturn filtrarResultadoEdicao;')();
  const original = {ok:true,cadastro_atualizado:true,lojas:[uuid(1),uuid(2)]};
  assert.deepEqual(filter(original,false,new Set([uuid(1)])).lojas,[uuid(1)]);
  assert.deepEqual(filter(original,false,null).lojas,[]);
  assert.deepEqual(original.lojas,[uuid(1),uuid(2)]);
  assert.equal(filter(original,true,null),original);
  const edit=edge.slice(edge.indexOf('if (acao === "editar")'),edge.indexOf('if (acao === "excluir")'));
  assert.match(edit,/filtrarResultadoEdicao\(cadastro, escopoTotal, permitidasNaResposta\)/);
  assert.match(edit,/\.\.\.cadastroVisivel/);
});

test('criação segue a hierarquia: Administrador tudo, Gerente até Analista, demais gestores até Assistente', () => {
  const create = edge.slice(edge.indexOf('if (acao === "criar")'), edge.indexOf('if (acao === "trocar_senha_primeiro_acesso")'));
  const first = create.match(/if \((.+)\) return json\(\{ error: "Seu perfil só pode criar operadores\."/);
  const second = create.match(/if \((.+)\) return json\(\{ error: "Seu perfil não pode criar usuários com esse papel/);
  assert.ok(first && second, 'guardas reais da criação localizadas');
  const hier = fs.readFileSync(path.join(root, 'supabase/functions/gerir-usuarios/hierarquia.ts'), 'utf8')
    .replace(/\bexport\s+/g, '').replace(/:\s*(string|number|boolean|Record<string, number>)(\s*[,)=;])/g, '$2').replace(/\)\s*:\s*(string\[\]|number|boolean)\s*\{/g, ') {');
  const bloqueado = Function('papelCaller', 'ehAdmin', 'gerenciaUsuarios', 'papel', `${hier}\nreturn (${first[1]}) || (${second[1]});`);
  const teto = { admin: 5, gerente: 3, analista: 2, assistente: 1, operador: 0 }, nivel = { operador: 1, assistente: 2, analista: 3, gerente: 4, admin: 5 };
  assert.match(edge, /const podeCriar = !ehOperador && \(/, 'operador nunca cria usuários');
  assert.match(edge, /const podeEditar = !ehOperador && \(/, 'operador nunca edita usuários');
  for (const ator of Object.keys(teto).filter((x) => x !== 'operador')) for (const papel of Object.keys(nivel)) {
    assert.equal(bloqueado(ator, ator === 'admin', true, papel), nivel[papel] > teto[ator], `${ator} com gestão criando ${papel}`);
    if (ator !== 'admin') assert.equal(bloqueado(ator, false, false, papel), papel !== 'operador', `${ator} sem gestão criando ${papel}`);
  }
});
