const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.html'), 'utf8');

test('sincronização de produtos respeita o schema catálogo global + associação loja/EAN', () => {
  assert.match(app, /baixar\('produtos','ean,created_by,updated_at,deleted_at'\)/);
  assert.doesNotMatch(app, /baixar\('produtos','[^']*\bnome\b/);
  assert.match(app, /function catalogoPull\(\)/);
});

test('backup não tenta alterar created_by definido pelo trigger do banco', () => {
  assert.match(app, /var payload=rows\.map\(function\(row\)\{var clean=Object\.assign\(\{\},row\);delete clean\.created_by;return clean;\}\)/);
  assert.match(app, /created_by é identidade definida pelo trigger do banco/);
});

test('frontend não lê nome de produto da tabela de associação', () => {
  assert.doesNotMatch(app, /if\(row\.nome&&!p\.desc\)p\.desc=row\.nome/);
});

test('frontend libera inserção para Operador, Assistente, Analista, Gerente e Administrador', () => {
  assert.match(app, /function pode\(acao\)\{var p=papelAtual\(\);if\(p==='admin'\)return true;/);
  assert.match(app, /if\(acao==='registrar'\)return \['operador','assistente','analista','gerente'\]\.includes\(p\);/);
  assert.match(app, /function aplicarPapel\(\)\{var reg=pode\('registrar'\)/);
});

test('registro de lote exige sessão e grava direto no Supabase antes de atualizar cache', () => {
  assert.match(app, /function inserirLoteSQL\(ean,nome,reg\)/);
  assert.match(app, /\/rest\/v1\/lotes/);
  assert.match(app, /Lote confirmado no Supabase/);
  assert.match(app, /Falha SQL:/);
});

test('registro de perecível grava cadastro e movimento diretamente no Supabase', () => {
  assert.match(app, /\/rest\/v1\/pere_itens\?on_conflict=loja_id,cod/);
  assert.match(app, /\/rest\/v1\/pere_regs/);
  assert.match(app, /Salvo no Supabase/);
});
