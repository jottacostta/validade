const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { montar, MARCADORES, zap, clarear } = require('../build');
const raiz = path.join(__dirname, '..');

test('substitui todos os marcadores', () => {
  const { html } = montar({ nome: 'Loja' });
  for (const m of MARCADORES) assert.ok(!html.includes(m), m);
  assert.match(html, /<title>Loja<\/title>/);
});
test('escapa o nome no HTML e no CFG', () => {
  const { html } = montar({ nome: '</script><b>"A&B\'' });
  assert.ok(html.includes('<title>&lt;/script&gt;&lt;b&gt;&quot;A&amp;B&#39;</title>'));
  assert.ok(!/var CFG=[^\n]*<\/script>/.test(html), 'CFG não pode fechar o <script>');
});
test('valores padrão e validação', () => {
  const { cfg } = montar({ cor: 'vermelho', dias: 'x', valor: 'outro' });
  assert.deepStrictEqual([cfg.dias, cfg.dig, cfg.valor, cfg.slogan], [30, 4, 'peso', '']);
  assert.ok(montar({ cor: 'vermelho' }).html.includes('--c:#0B6E4F'));
  assert.throws(() => montar({ dig: 7 }), /dig deve ser 4, 5 ou 6/);
  assert.strictEqual(montar({ dias: 0 }).cfg.dias, 30);
  assert.strictEqual(montar({ dias: -5 }).cfg.dias, 1);
});
test('WhatsApp ganha o 55 do Brasil', () => {
  assert.strictEqual(zap('(11) 98765-4321'), '5511987654321');
  assert.strictEqual(zap('5511987654321'), '5511987654321');
  assert.strictEqual(zap(''), '');
});
test('cores derivadas', () => {
  assert.strictEqual(clarear('#000000', 1), '#ffffff');
  assert.strictEqual(clarear('#0B6E4F', 0), '#0b6e4f');
});
test('APP_VALIDADE.js é o template sem configuração', () => {
  const { js } = montar({ nome: 'X' });
  const ctx = {}; require('vm').runInNewContext(js + ';this.A=APP_VALIDADE;this.L=LEITOR_EAN;', ctx);
  assert.strictEqual(ctx.A, fs.readFileSync(path.join(raiz, 'src/app.html'), 'utf8'));
  assert.strictEqual(ctx.L, fs.readFileSync(path.join(raiz, 'src/leitor-ean.js'), 'utf8'));
});
test('dist/ está em dia com src/ e config.json (rode node build.js)', () => {
  const { html, js } = montar(JSON.parse(fs.readFileSync(path.join(raiz, 'config.json'), 'utf8')));
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dist/validade.html'), 'utf8'), html);
  assert.strictEqual(fs.readFileSync(path.join(raiz, 'dist/APP_VALIDADE.js'), 'utf8'), js);
});

test('logo do cabeçalho: usa o PNG recortado (fundo transparente) quando src/logo.png existe', () => {
  const png = path.join(__dirname, '../src/logo.png');
  assert.ok(fs.existsSync(png), 'src/logo.png existe');
  const bytes = fs.readFileSync(png);
  assert.ok(bytes.length < 40000, 'logo embutido continua leve (' + bytes.length + ' bytes)');
  const { cfg } = montar({ nome: 'X' });
  assert.ok(cfg.logo.startsWith('data:image/png;base64,'), cfg.logo.slice(0, 30));
  assert.strictEqual(cfg.logo, 'data:image/png;base64,' + bytes.toString('base64'));
});
