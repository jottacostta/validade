/* Testes do app no navegador (Playwright + Chromium). Pulados se o Playwright não estiver instalado. */
const test = require('node:test'), assert = require('node:assert');
const path = require('path'), fs = require('fs'), os = require('os');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { }
const URL_APP = 'file://' + path.join(__dirname, '../dist/validade.html');
const pular = chromium ? false : 'Playwright não instalado';

let navegador;
test.before(async () => { if (chromium) navegador = await chromium.launch(); });
test.after(async () => { if (navegador) await navegador.close(); });

/* abre o app; `dados` vai para o localStorage antes de carregar; `respostas` responde prompts/confirms em ordem */
async function abrir({ dados, chave = 'validade_dados', respostas = [], opcoes = {}, antes } = {}) {
  const ctx = await navegador.newContext({ acceptDownloads: true, ...opcoes });
  const p = await ctx.newPage(), erros = [], dialogos = [];
  p.on('pageerror', e => erros.push(e.message));
  p.on('dialog', d => { dialogos.push({ msg: d.message(), padrao: d.defaultValue() }); const r = respostas.shift();
    if (r === null || r === false) d.dismiss(); else d.accept(r === true || r === undefined ? (d.type() === 'prompt' ? d.defaultValue() : undefined) : String(r)); });
  await p.addInitScript(() => { window.__ag = []; window.__ca = [];
    window.Android = { agendarLembrete: id => window.__ag.push(id), cancelarLembrete: id => window.__ca.push(id) }; });
  if (antes) await antes(p);
  await p.goto(URL_APP);
  if (dados !== undefined) { await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, [chave, dados]); await p.reload(); }
  const salvo = () => p.evaluate(() => JSON.parse(localStorage.getItem('validade_dados')));
  return { p, ctx, erros, dialogos, respostas, salvo, fechar: () => ctx.close() };
}
const lote = (id, val, qtd = 1, l = 'L1') => ({ id, lote: l, qtd, val });

test('migra a chave antiga e junta UPC-A de 12 com 13 dígitos', { skip: pular }, async () => {
  const a = await abrir({ chave: 'validade_Controle de Validade', dados: {
    prod: { '012345678905': { nome: 'A', lotes: [lote('a', '2030-01-01')] }, '0012345678905': { nome: 'A', lotes: [lote('b', '2030-02-01')] } },
    cat: { '012345678905': { nome: 'A' } }, pere: { itens: {}, regs: [] } } });
  assert.deepStrictEqual(await a.p.evaluate(() => Object.keys(localStorage)), ['validade_dados']);
  const d = await a.salvo();
  assert.deepStrictEqual(Object.keys(d.prod), ['0012345678905']);
  assert.strictEqual(d.prod['0012345678905'].lotes.length, 2);
  assert.deepStrictEqual(Object.keys(d.cat), ['0012345678905']);
  await a.p.fill('#tCodigo', '012345678905'); await a.p.click('#bBuscar');
  assert.strictEqual(await a.p.textContent('#pEan'), '0012345678905');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

test('UPC-E do leitor nativo vira EAN-13', { skip: pular }, async () => {
  const a = await abrir({ antes: p => p.addInitScript(() => {
    window.BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: '01234565', format: 'upc_e' }]); } }; }) });
  await a.p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  const png = path.join(os.tmpdir(), 'validade-teste.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await a.p.setInputFiles('#fFoto', png);
  await a.p.waitForFunction(() => document.getElementById('pEan').textContent);
  assert.strictEqual(await a.p.textContent('#pEan'), '0012345000065');
  await a.fechar();
});

test('backup incompleto é importado sem travar', { skip: pular }, async () => {
  const a = await abrir({ dados: {} });
  const f = path.join(os.tmpdir(), 'validade-backup.json');
  fs.writeFileSync(f, JSON.stringify({ prod: { '7891000315507': { nome: 'B', lotes: [lote('y', '2031-01-01')] } } }));
  a.respostas.push(true);
  await a.p.setInputFiles('#fImp', f);
  await a.p.waitForFunction(() => document.getElementById('tLotes').textContent === '1');
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="lista"]');
  await a.p.click('nav button[data-v="aj"]');
  const d = await a.salvo();
  assert.deepStrictEqual(Object.keys(d).sort(), ['aj', 'cat', 'pere', 'prod']);
  assert.strictEqual(d.aj.dias, 30);
  assert.deepStrictEqual(await a.p.evaluate(() => __ag), ['y_a', 'y_v']);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

test('lembretes: mudar dias reagenda, desligar cancela, apagar tudo cancela', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { nome: 'B', lotes: [lote('x', '2031-01-01')] } },
    pere: { itens: { 12: { desc: 'Picanha' } }, regs: [{ id: 'r', cod: '12', peso: 1, val: '2031-01-01' }] } } });
  const zera = () => a.p.evaluate(() => { __ag = []; __ca = []; }), ver = () => a.p.evaluate(() => [__ag.slice().sort(), __ca.slice().sort()]);
  await a.p.click('nav button[data-v="aj"]'); await zera();
  await a.p.fill('#aDias', '10'); await a.p.press('#aDias', 'Tab');
  assert.deepStrictEqual(await ver(), [['r_a', 'r_v', 'x_a', 'x_v'], ['r_a', 'r_v', 'x_a', 'x_v']]);
  await zera(); await a.p.locator('#aNotif').uncheck();
  assert.deepStrictEqual(await ver(), [[], ['r_a', 'r_v', 'x_a', 'x_v']]);
  await zera(); a.respostas.push(true, true); await a.p.click('#bZerar');
  assert.deepStrictEqual(await ver(), [[], ['r_a', 'r_v', 'x_a', 'x_v']]);
  assert.deepStrictEqual((await a.salvo()).prod, {});
  await a.fechar();
});

test('lote repetido: pergunta a quantidade final, já somada', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { nome: 'Café', lotes: [lote('x', '2031-01-01', 5, 'L1')] } } } });
  const salvarLote = async qtd => {
    await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
    await a.p.fill('#pLote', 'l1'); await a.p.fill('#pQtd', String(qtd)); await a.p.fill('#pVal', '2031-01-01');
    await a.p.click('#bSalvarLote');
  };
  a.respostas.push(true); await salvarLote(3);           // aceita o padrão (somado)
  assert.strictEqual(a.dialogos.at(-1).padrao, '8');
  assert.strictEqual((await a.salvo()).prod['7891000315507'].lotes[0].qtd, 8);
  a.respostas.push('3'); await salvarLote(3);            // troca para substituir
  assert.strictEqual((await a.salvo()).prod['7891000315507'].lotes[0].qtd, 3);
  a.respostas.push(null); await salvarLote(4);           // cancela: nada muda
  const ls = (await a.salvo()).prod['7891000315507'].lotes;
  assert.deepStrictEqual([ls.length, ls[0].qtd], [1, 3]);
  await a.fechar();
});

test('editar registro de perecível (peso, validade, SIF) e apagar', { skip: pular }, async () => {
  const a = await abrir({ dados: { pere: { itens: { 12: { desc: 'Picanha', sif: '1' } }, regs: [{ id: 'r', cod: '12', sif: '1', peso: 1.25, val: '2031-01-01' }] } } });
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="lista"]');
  a.respostas.push('2,5', '15/3/32', '999'); await a.p.click('tr[data-pe="r"]');
  assert.strictEqual(a.dialogos[0].padrao, '1,25');
  let r = (await a.salvo()).pere.regs[0];
  assert.deepStrictEqual([r.peso, r.val, r.sif], [2.5, '2032-03-15', '999']);
  assert.ok((await a.p.textContent('#listaPe')).includes('15/03/2032'));
  a.respostas.push('3', '31/02/2032'); await a.p.click('tr[data-pe="r"]');  // data inexistente: nada muda
  r = (await a.salvo()).pere.regs[0];
  assert.deepStrictEqual([r.peso, r.val], [2.5, '2032-03-15']);
  a.respostas.push('0', true); await a.p.click('tr[data-pe="r"]');
  assert.strictEqual((await a.salvo()).pere.regs.length, 0);
  await a.fechar();
});

test('nome do arquivo usa a data local (depois das 21h no Brasil)', { skip: pular }, async () => {
  const a = await abrir({ opcoes: { timezoneId: 'America/Sao_Paulo' },
    antes: p => p.clock.install({ time: new Date('2026-11-06T23:30:00-03:00') }) });
  await a.p.click('nav button[data-v="aj"]');
  const [baixa] = await Promise.all([a.p.waitForEvent('download'), a.p.click('#bExp')]);
  assert.strictEqual(baixa.suggestedFilename(), 'backup_validade_2026-11-06.json');
  await a.fechar();
});

test('slogan da configuração aparece no cabeçalho', { skip: pular }, async () => {
  const a = await abrir();
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
  assert.strictEqual(await a.p.textContent('#slogan'), cfg.slogan);
  await a.fechar();
});
