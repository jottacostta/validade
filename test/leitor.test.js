const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { imagem, ruido } = require('./codigo-barras');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/leitor-ean.js'), 'utf8') + ';this.LeitorEAN=LeitorEAN;', ctx);
const { ler, checa13, checa8 } = ctx.LeitorEAN;

test('lê EAN-13 de produtos brasileiros', () => {
  for (const c of ['7891000315507', '7894900011517', '7896004000855']) assert.strictEqual(ler(imagem(c)), c);
});
test('lê EAN-8', () => {
  for (const c of ['96385074', '40170725']) assert.strictEqual(ler(imagem(c)), c);
});
test('UPC-A sai como EAN-13 (0 na frente)', () => {
  assert.strictEqual(ler(imagem('012345678905')), '0012345678905');
});
test('lê de cabeça para baixo', () => {
  assert.strictEqual(ler(imagem('7891000315507', { espelhar: true })), '7891000315507');
});
test('lê com borrão, ruído e pouco contraste', () => {
  assert.strictEqual(ler(imagem('7891000315507', { modulo: 4, borrar: 1 })), '7891000315507');
  assert.strictEqual(ler(imagem('7891000315507', { ruido: 40 })), '7891000315507');
  assert.strictEqual(ler(imagem('7891000315507', { escuro: 90, claro: 160 })), '7891000315507');
});
test('etiqueta de balança (começa com 2)', () => {
  assert.strictEqual(ler(imagem('2001230012342')), '2001230012342');
});
test('não inventa código em imagem sem código de barras', () => {
  assert.strictEqual(ler(ruido(600, 120)), null);
  assert.strictEqual(ler(imagem('7891000315507', { escuro: 128, claro: 128 })), null);
});
test('dígito verificador', () => {
  assert.ok(checa13('7891000315507'));
  assert.ok(!checa13('7891000315508'));
  assert.ok(checa8('96385074'));
  assert.ok(!checa8('96385075'));
});
