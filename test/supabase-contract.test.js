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
  assert.match(app, /set_created_by/);
});

test('frontend não lê nome de produto da tabela de associação', () => {
  assert.doesNotMatch(app, /if\(row\.nome&&!p\.desc\)p\.desc=row\.nome/);
});
