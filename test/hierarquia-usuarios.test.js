const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mesmo carregador de scope.ts: executa o TypeScript sem dependências removendo só os `export`.
function carregar() {
  const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/gerir-usuarios/hierarquia.ts'), 'utf8')
    .replace(/\bexport\s+/g, '').replace(/:\s*(string|number|boolean|Record<string, number>)(\s*[,)=;])/g, '$2').replace(/\)\s*:\s*(string\[\]|number|boolean)\s*\{/g, ') {');
  const module = { exports: {} };
  new Function('module', `${src}\nmodule.exports = { tetoAtribuicao, podeAtribuirPapel, podeAdministrarPapel, papeisAtribuiveis };`)(module);
  return module.exports;
}

test('hierarquia de promoção: gerente até analista, analista até assistente, admin tudo', () => {
  const h = carregar();
  assert.deepEqual(h.papeisAtribuiveis('admin', true), ['operador', 'assistente', 'analista', 'gerente', 'admin']);
  assert.deepEqual(h.papeisAtribuiveis('gerente', true), ['operador', 'assistente', 'analista']);
  assert.deepEqual(h.papeisAtribuiveis('analista', true), ['operador', 'assistente']);
  assert.deepEqual(h.papeisAtribuiveis('assistente', true), ['operador'], 'assistente não promove: só cria operador');
  assert.deepEqual(h.papeisAtribuiveis('assistente', false), ['operador']);
  assert.deepEqual(h.papeisAtribuiveis('operador', true), [], 'operador só executa o operacional, mesmo com a permissão marcada');
  assert.deepEqual(h.papeisAtribuiveis('gerente', false), [], 'sem a permissão de gerenciar usuários não atribui papel');
  assert.equal(h.podeAtribuirPapel('gerente', true, 'analista'), true);
  assert.equal(h.podeAtribuirPapel('gerente', true, 'gerente'), false);
  assert.equal(h.podeAtribuirPapel('analista', true, 'assistente'), true);
  assert.equal(h.podeAtribuirPapel('analista', true, 'analista'), false);
  assert.equal(h.podeAtribuirPapel('admin', false, 'admin'), true);
});

test('hierarquia de edição: ninguém administra quem está acima do seu teto', () => {
  const h = carregar();
  assert.equal(h.podeAdministrarPapel('gerente', true, 'analista'), true, 'gerente edita e rebaixa analista');
  assert.equal(h.podeAdministrarPapel('gerente', true, 'gerente'), false);
  assert.equal(h.podeAdministrarPapel('gerente', true, 'admin'), false);
  assert.equal(h.podeAdministrarPapel('analista', true, 'assistente'), true);
  assert.equal(h.podeAdministrarPapel('analista', true, 'analista'), false);
  assert.equal(h.podeAdministrarPapel('admin', true, 'admin'), true);
  assert.equal(h.podeAdministrarPapel('gerente', true, 'invalido'), false);
  assert.equal(h.podeAdministrarPapel('assistente', true, 'operador'), true);
  assert.equal(h.podeAdministrarPapel('assistente', true, 'assistente'), false, 'assistente não administra outro assistente');
  assert.equal(h.podeAdministrarPapel('operador', true, 'operador'), false);
});

test('Edge Function e migration aplicam o mesmo teto da hierarquia', () => {
  const edge = fs.readFileSync(path.join(__dirname, '../supabase/functions/gerir-usuarios/index.ts'), 'utf8');
  assert.match(edge, /from "\.\/hierarquia\.ts"/);
  assert.match(edge, /podeAtribuirPapel\(papelCaller, gerenciaUsuarios, papel\)/, 'criar e editar validam o papel atribuído');
  assert.match(edge, /podeAdministrarPapel\(papelCaller, gerenciaUsuarios, alvo\.papel\)/, 'editar valida o papel atual do alvo');
  assert.match(edge, /podeAdministrarPapel\(papelCaller, true, targetProfile\.papel\)/, 'excluir valida o papel do alvo');
  assert.doesNotMatch(edge, /Analista\/Gerente só pode/);
  const m = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112150000_hierarquia_promocao_usuarios.sql'), 'utf8');
  assert.match(m, /when 'gerente' then 3/);
  const m2 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112160000_hierarquia_assistente_operador.sql'), 'utf8');
  assert.match(m2, /when 'analista' then 2 when 'assistente' then 1 else 0/);
  assert.match(m, /v_nivel_alvo > v_teto/);
  assert.match(m, /v_nivel_novo > v_teto/);
  assert.equal([...m.matchAll(/não encontrad[oa]s?'; end if;/g)].length, 2, 'falha inteira se a função mudou');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
  assert.match(app, /function papeisAtribuiveisApp\(/);
  assert.match(app, /var TETO_PAPEL=\{admin:5,gerente:3,analista:2,assistente:1,operador:0\}/);
});
