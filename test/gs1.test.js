const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/leitor-ean.js'), 'utf8') + ';this.G=LeitorGS1;', ctx);
const ler = ctx.G.ler;
const GS = String.fromCharCode(29);

test('etiqueta da balança: parênteses, grudado e com FNC1 dão o mesmo', () => {
  const esperado = { gtin: '07891234567895', val: '2026-11-08', peso: 0.576, preco: null };
  for (const t of [
    '(01)07891234567895(17)261108(3103)000576',
    '010789123456789517261108' + '3103000576',
    String.fromCharCode(232) + '010789123456789517261108' + '3103000576',
  ]) {
    const g = ler(t);
    assert.deepStrictEqual({ gtin: g.gtin, val: g.val, peso: g.peso, preco: g.preco }, esperado);
  }
});
test('tira o identificador de simbologia (]d2, ]Q3…)', () => {
  assert.strictEqual(ler(']d2010789123456789517261108' + '3103000576').peso, 0.576);
  assert.strictEqual(ler(']Q3010789123456789517261108' + '3103000576').gtin, '07891234567895');
});
test('lote variável separado por GS, e valor a pagar (392n)', () => {
  const g = ler('0107891234567895' + '10' + '15-050326' + GS + '17261108' + '3922' + '001842');
  assert.strictEqual(g.lote, '15-050326');
  assert.strictEqual(g.val, '2026-11-08');
  assert.strictEqual(g.preco, 18.42);
});
test('peso com casas decimais conforme 310n', () => {
  assert.strictEqual(ler('01078912345678953101000576').peso, 57.6);  // 3101 → 1 decimal
  assert.strictEqual(ler('01078912345678953105012340').peso, 0.1234);// 3105 → 5 decimais
});
test('preço 393n ignora os 3 dígitos da moeda', () => {
  assert.strictEqual(ler('0107891234567895' + '3932' + '986' + '001842').preco, 18.42); // 986 = BRL
});
test('data DD=00 vira o último dia do mês; data inválida é nula', () => {
  assert.strictEqual(ler('(17)261200').val, '2026-12-31');
  assert.strictEqual(ler('(17)261302'), null); // mês 13 → sem AI válido
});
test('não confunde EAN/UPC comum com GS1', () => {
  assert.strictEqual(ler('7891000315507'), null);
  assert.strictEqual(ler('012345678905'), null);
  assert.strictEqual(ler(''), null);
  assert.strictEqual(ler(null), null);
});
test('só GTIN (produto embalado), sem peso', () => {
  const g = ler('(01)07891234567895');
  assert.deepStrictEqual([g.gtin, g.peso, g.val], ['07891234567895', null, null]);
});
