const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/leitor-ean.js'), 'utf8') + ';this.P=parseEtiquetaOCR;', ctx);
const parse = ctx.P;

// texto real lido pelo Tesseract (psm 4) da etiqueta do pernil
const PERNIL = "PERNIL FRACIONADO\nSEARA RESERVA ks\n\nCARNE RESFRIADA DE SUINO SEM OSSO - PERNIL\n\n)\n\nDATA: 05/11/26 VALIDADE: 08/11/26\n\nHORA: 21:38\nLOTE: 876-040326\n\nOPER.: 323592\nTARA: 0,010k5(T)\n\n1 CUZU3I9SO0 172630 17/20]\n108 3103/000864\n\ninyrediente: Carne de suino ser OSSO\nler .NÃO CONTEM GLUTEN.\n";

test('extrai descrição (1ª linha) e lote da etiqueta do pernil', () => {
  const r = parse(PERNIL);
  assert.strictEqual(r.desc, 'Pernil Fracionado');
  assert.strictEqual(r.lote, '876-040326');
});
test('etiqueta da picanha (formato parecido)', () => {
  const r = parse("PICANHA SUINA FRACIONADA\nSEARA RESERVA kg\nCARNE RESFRIADA DE SUINO SEM OSSO PICANHA\nDATA: 05/11/26 VALIDADE: 08/11/26\nLOTE: 15-050326\nPESO: 0,576kg\n");
  assert.strictEqual(r.desc, 'Picanha Suina Fracionada');
  assert.strictEqual(r.lote, '15-050326');
});
test('ignora linhas de campos e marca ao escolher a descrição', () => {
  const r = parse("SEARA RESERVA kg\nDATA: 01/01/26\nLINGUICA TOSCANA\nLOTE: AB1234\n");
  assert.strictEqual(r.desc, 'Linguica Toscana');
  assert.strictEqual(r.lote, 'AB1234');
});
test('sem lote legível → lote vazio; texto vazio não quebra', () => {
  assert.strictEqual(parse("QUEIJO MINAS\nPESO: 0,300kg\n").lote, '');
  const vazio = parse(''); assert.strictEqual(vazio.desc, ''); assert.strictEqual(vazio.lote, '');
  const n = parse(null); assert.strictEqual(n.desc, ''); assert.strictEqual(n.lote, '');
});
