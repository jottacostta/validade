/* Testes do app no navegador (Playwright + Chromium). Pulados se o Playwright não estiver instalado. */
const test = require('node:test'), assert = require('node:assert');
const path = require('path'), fs = require('fs'), os = require('os');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { }
const URL_APP = 'file://' + path.join(__dirname, '../dist/validade.html');
const { montar } = require('../build');
const SUPA_FILE = path.join(os.tmpdir(), 'validade-supa.html');
try { fs.writeFileSync(SUPA_FILE, montar({ nome: 'Controle de Validade', slogan: 'x', cor: '#083d81', dig: 5, valor: 'preco', dias: 30, supaUrl: 'https://test.supabase.co', supaKey: 'anon-test', loginDom: 'loja.validade' }).html); } catch (e) {}
const URL_SUPA = 'file://' + SUPA_FILE;
const NOSUPA_FILE = path.join(os.tmpdir(), 'validade-nosupa.html');
try { fs.writeFileSync(NOSUPA_FILE, montar({ nome: 'Controle de Validade', slogan: 'x', cor: '#083d81', dig: 5, valor: 'preco', dias: 30 }).html); } catch (e) {}
const URL_NOSUPA = 'file://' + NOSUPA_FILE;
const pular = chromium ? false : 'Playwright não instalado';

let navegador;
/* testes de navegador são sensíveis a timing sob carga; 1 retry elimina falha esporádica (bug real falha 2x) */
function tflaky(nome, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(nome, opts, async (t) => {
    let erro;
    for (let i = 0; i < 2; i++) { try { return await fn(t); } catch (e) { erro = e; } }
    throw erro;
  });
}
test.before(async () => { if (chromium) navegador = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }); });
test.after(async () => { if (navegador) await navegador.close(); });

/* abre o app; `dados` vai para o localStorage antes de carregar; `respostas` responde prompts/confirms em ordem */
async function abrir({ dados, chave = 'validade_dados', respostas = [], opcoes = {}, antes, url } = {}) {
  const ctx = await navegador.newContext({ acceptDownloads: true, ...opcoes });
  const p = await ctx.newPage(), erros = [], dialogos = [];
  p.on('pageerror', e => erros.push(e.message));
  p.on('dialog', d => { dialogos.push({ msg: d.message(), padrao: d.defaultValue() }); const r = respostas.shift();
    if (r === null || r === false) d.dismiss(); else d.accept(r === true || r === undefined ? (d.type() === 'prompt' ? d.defaultValue() : undefined) : String(r)); });
  await p.addInitScript(() => { window.__noSplash = 1; });
  await p.addInitScript(() => { window.__ag = []; window.__ca = [];
    window.Android = { agendarLembrete: id => window.__ag.push(id), cancelarLembrete: id => window.__ca.push(id) }; });
  if (antes) await antes(p);
  await p.goto(url || URL_NOSUPA);
  if (dados !== undefined) { await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }, [chave, dados]); await p.reload(); }
  const salvo = () => p.evaluate(() => JSON.parse(localStorage.getItem('validade_dados')));
  return { p, ctx, erros, dialogos, respostas, salvo, fechar: () => ctx.close() };
}
const lote = (id, val, qtd = 1, l = 'L1') => ({ id, lote: l, qtd, val });

tflaky('migra a chave antiga e junta UPC-A de 12 com 13 dígitos', { skip: pular }, async () => {
  const a = await abrir({ chave: 'validade_Controle de Validade', dados: {
    prod: { '012345678905': { nome: 'A', lotes: [lote('a', '2030-01-01')] }, '0012345678905': { nome: 'A', lotes: [lote('b', '2030-02-01')] } },
    cat: { '012345678905': { nome: 'A' } }, pere: { itens: {}, regs: [] } } });
  assert.deepStrictEqual(await a.p.evaluate(() => Object.keys(localStorage)), ['validade_dados']);
  const d = await a.salvo();
  assert.deepStrictEqual(Object.keys(d.prod), ['0012345678905']);
  assert.strictEqual(d.prod['0012345678905'].lotes.length, 2);
  assert.deepStrictEqual(Object.keys(d.cat), ['0012345678905']);
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '012345678905'); await a.p.click('#bBuscar');
  assert.strictEqual(await a.p.textContent('#pEan'), '0012345678905');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('UPC-E do leitor nativo vira EAN-13', { skip: pular }, async () => {
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

tflaky('metadados legados de produto migram para o catálogo único local', { skip: pular }, async () => {
  const ean = '7891000315507';
  const a = await abrir({ dados: {
    prod: { [ean]: { nome: 'Nome legado', marca: 'Marca antiga', img: 'https://img.test/p.jpg', lotes: [lote('legado', '2030-01-01')] } },
    cat: { [ean]: { nome: 'Nome canônico', marca: 'Marca canônica', img: 'https://img.test/c.jpg' } }
  } });
  const d = await a.salvo();
  assert.deepStrictEqual(Object.keys(d.prod[ean]).sort(), ['lotes']);
  assert.deepStrictEqual(d.cat[ean], { nome: 'Nome canônico', marca: 'Marca canônica', img: 'https://img.test/c.jpg' });
  await a.p.click('nav button[data-v="prod"]');
  assert.ok((await a.p.textContent('#listaProd')).includes('Nome canônico'));
  assert.ok(!(await a.p.textContent('#listaProd')).includes('Nome legado'));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('backup incompleto é importado sem travar', { skip: pular }, async () => {
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

tflaky('lembretes: mudar dias reagenda, desligar cancela, apagar tudo cancela', { skip: pular }, async () => {
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

tflaky('lote novo é salvo; lote duplicado (mesmo lote+validade) é rejeitado', { skip: pular }, async () => {
  // Comportamento atual (PR #18): salva no Supabase; duplicado é rejeitado
  // (atualizar quantidade passa a ser feito pela edição do lote).
  const a = await abrirRegistro(rotasRegistro, { prod: { '7891000315507': { nome: 'Café', lotes: [lote('x', '2031-01-01', 5, 'L1')] } }, cat: {}, pere: { itens: {}, regs: [] } });
  const salvarLote = async (nome, qtd, val) => {
    await a.p.click('#bTipoIndustrial');
    await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
    await a.p.waitForSelector('#cardProd', { state: 'visible' });
    await a.p.waitForFunction(() => document.getElementById('pNome').value !== '');
    await a.p.fill('#pLote', nome); await a.p.fill('#pQtd', String(qtd)); await a.p.fill('#pVal', val);
    await a.p.selectOption('#pSetor', 'Mercearia');
    await a.p.click('#bSalvarLote');
  };
  // lote NOVO (L2) → salvo
  await salvarLote('l2', 3, '2031-02-01');
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_dados')).prod['7891000315507'].lotes.length === 2; } catch (e) { return false; } });
  // lote DUPLICADO (mesmo L1 + 2031-01-01) → rejeitado, nada muda
  await salvarLote('l1', 9, '2031-01-01');
  const ls = (await a.salvo()).prod['7891000315507'].lotes;
  assert.strictEqual(ls.length, 2, 'duplicado não cria novo lote');
  assert.ok(ls.some(l => l.lote === 'L1' && l.qtd === 5), 'lote existente permanece com qtd 5');
  assert.ok(ls.some(l => l.lote === 'L2' && l.qtd === 3), 'lote novo L2 foi salvo');
  await a.fechar();
});

tflaky('editar registro de perecível (peso, validade, SIF) e apagar', { skip: pular }, async () => {
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

tflaky('nome do arquivo usa a data local (depois das 21h no Brasil)', { skip: pular }, async () => {
  const a = await abrir({ opcoes: { timezoneId: 'America/Sao_Paulo' },
    antes: p => p.clock.install({ time: new Date('2026-11-06T23:30:00-03:00') }) });
  await a.p.click('nav button[data-v="aj"]');
  const [baixa] = await Promise.all([a.p.waitForEvent('download'), a.p.click('#bExp')]);
  assert.strictEqual(baixa.suggestedFilename(), 'backup_validade_2026-11-06.json');
  await a.fechar();
});

tflaky('slogan da configuração aparece no cabeçalho', { skip: pular }, async () => {
  const a = await abrir({ url: URL_APP });
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
  assert.strictEqual(await a.p.textContent('#slogan'), cfg.slogan);
  await a.fechar();
});

tflaky('lê etiqueta GS1 (DataMatrix) e preenche os perecíveis', { skip: pular }, async () => {
  // simula o leitor nativo devolvendo o conteúdo do DataMatrix da etiqueta (peso 0,576 kg, validade 08/11/26)
  const cap = {};
  const a = await abrirRegistro(p => rotasRegistro(p, cap), { pere: { itens: {}, regs: [] } }, p => p.addInitScript(() => {
    window.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['data_matrix', 'ean_13']); }
      detect() { return Promise.resolve([{ rawValue: '010789123456789517261108' + '3103000576', format: 'data_matrix' }]); }
    };
  }));
  await a.p.click('nav button[data-v="pere"]');
  await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pePeso').value !== '');
  assert.strictEqual(await a.p.inputValue('#pePeso'), '0.576');
  assert.strictEqual(await a.p.inputValue('#peVal'), '2026-11-08');
  assert.ok((await a.p.textContent('#peCod')).includes('07891234567895'));
  assert.ok((await a.p.textContent('#peInfo')).includes('08/11/2026'));
  // cadastra a descrição e salva o registro
  await a.p.fill('#peDesc', 'Picanha Suína Fracionada');
  await a.p.fill('#peSif', '01259');
  await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  await a.p.waitForFunction(() => document.getElementById('cardPe').style.display === 'none');
  // o registro vai para o Supabase (payload capturado)
  assert.strictEqual(cap.rpc_perecivel[0].p_peso, 0.576);
  assert.strictEqual(cap.rpc_perecivel[0].p_val, '2026-11-08');
  assert.strictEqual(cap.rpc_perecivel[0].p_descricao, 'Picanha Suína Fracionada');
  // ao reler a mesma etiqueta, a descrição já vem preenchida (D em memória)
  await a.p.click('#bEscanearBal');
  await a.p.waitForFunction(() => document.getElementById('peDesc').value === 'Picanha Suína Fracionada');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('GS1 com etiqueta de balança embutida no GTIN: extrai código 6019 e peso do (3103)', { skip: pular }, async () => {
  // etiqueta do lombo: (01)02060190009984 (17)261108 (3103)000312 ; loja usa dig=5
  const cap = {};
  const a = await abrirRegistro(p => rotasRegistro(p, cap), { aj: { dig: 5, valor: 'preco' }, pere: { itens: {}, regs: [] } },
    p => p.addInitScript(() => {
      window.BarcodeDetector = class {
        static getSupportedFormats() { return Promise.resolve(['data_matrix']); }
        detect() { return Promise.resolve([{ rawValue: '0102060190009984' + '17261108' + '3103000312', format: 'data_matrix' }]); }
      };
    }));
  await a.p.click('nav button[data-v="pere"]');
  await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pePeso').value !== '');
  assert.ok((await a.p.textContent('#peCod')).includes('6019'), 'peCod deve mostrar 6019');
  assert.strictEqual(await a.p.inputValue('#pePeso'), '0.312');       // peso do (3103), não do valor embutido
  assert.strictEqual(await a.p.inputValue('#peVal'), '2026-11-08');   // validade do (17)
  assert.ok((await a.p.textContent('#peInfo')).includes('9,98'), 'mostra o preço R$9,98 embutido');
  await a.p.fill('#peDesc', 'Lombo Fracionado Bife');
  await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  await a.p.waitForFunction(() => document.getElementById('cardPe').style.display === 'none');
  assert.strictEqual(String(cap.rpc_perecivel[0].p_cod), '6019');
  assert.strictEqual(cap.rpc_perecivel[0].p_peso, 0.312);
  assert.strictEqual(cap.rpc_perecivel[0].p_descricao, 'Lombo Fracionado Bife');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('OCR preenche descrição e lote (SIF) ao escanear a etiqueta', { skip: pular }, async () => {
  const OCRTEXT = 'PERNIL FRACIONADO\\nSEARA RESERVA ks\\nCARNE RESFRIADA DE SUINO SEM OSSO - PERNIL\\nDATA: 05/11/26 VALIDADE: 08/11/26\\nLOTE: 876-040326\\n';
  const cap = {};
  const a = await abrirRegistro(p => rotasRegistro(p, cap), { aj: { dig: 5, valor: 'preco', ocr: true }, pere: { itens: {}, regs: [] } },
    p => p.addInitScript(`
      window.BarcodeDetector = class {
        static getSupportedFormats(){ return Promise.resolve(['data_matrix']); }
        detect(){ return Promise.resolve([{ rawValue: '0102031950017263'+'17261108'+'3103000864', format: 'data_matrix' }]); }
      };
      window.Tesseract = {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => ({ data: { text: "${OCRTEXT}" } }),
          terminate: async () => {},
        }),
      };
    `));
  await a.p.click('nav button[data-v="pere"]');
  await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  // código e peso vêm do QR; descrição e lote vêm do OCR (assíncrono)
  assert.ok((await a.p.textContent('#peCod')).includes('3195'), 'código 3195 do QR');
  assert.strictEqual(await a.p.inputValue('#pePeso'), '0.864');
  await a.p.waitForFunction(() => document.getElementById('peDesc').value === 'Pernil Fracionado');
  await a.p.waitForFunction(() => document.getElementById('peSif').value === '876-040326');
  await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  await a.p.waitForFunction(() => document.getElementById('cardPe').style.display === 'none');
  assert.strictEqual(cap.rpc_perecivel[0].p_descricao, 'Pernil Fracionado');
  assert.strictEqual(cap.rpc_perecivel[0].p_sif, '876-040326');
  assert.strictEqual(cap.rpc_perecivel[0].p_peso, 0.864);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('mobile: sem rolagem horizontal nas telas com tabela (360px)', { skip: pular }, async () => {
  const a = await abrir({ opcoes: { viewport: { width: 360, height: 740 } }, dados: {
    prod: { '7891000315507': { nome: 'Café Torrado e Moído Nome Bem Comprido Para Testar', lotes: [lote('x', '2031-01-01', 5, 'L1')] } },
    pere: { itens: { '1246': { desc: 'Pernil Suíno Fracionado Descrição Grande', sif: '876-040326' } }, regs: [{ id: 'r', cod: '1246', sif: '876-040326', peso: 0.33, val: '2026-11-09' }] } } });
  const semOverflow = async () => a.p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  await a.p.click('nav button[data-v="reg"]');
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });           // tabela de lotes
  assert.ok(await semOverflow(), 'tela Registrar/produto não pode rolar horizontalmente');
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="lista"]');
  await a.p.waitForFunction(() => document.querySelector('#listaPe table'));
  assert.ok(await semOverflow(), 'tela Perecíveis não pode rolar horizontalmente');
  await a.fechar();
});

/* Rotas de registro com um interruptor de rede: abort() simula falta de internet. */
async function rotasRede(p, estado) {
  const resp = (r) => { const m = r.request().method(); if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); return estado.online ? r.fulfill({ status: 201, body: '' }) : r.abort(); };
  await p.route(/\/rest\/v1\/perfis/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Teste' }]) }));
  await p.route(/\/rest\/v1\/catalogo/, resp);
  for (const rpc of ['registrar_lote', 'registrar_perecivel']) await p.route(new RegExp('/rest/v1/rpc/' + rpc + '$'), r => estado.online ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Teste', criado: Date.now() }) }) : r.abort('internetdisconnected'));
  for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs', 'auditoria', 'preferencias', 'lojas', 'loja_membros']) await p.route(new RegExp('/rest/v1/' + t + '(\\?|$)'), resp);
}

tflaky('offline: perecível salva no aparelho sem rede e sincroniza ao reconectar', { skip: pular }, async () => {
  const net = { online: false };
  const a = await abrirRegistro(p => rotasRede(p, net), { aj: { dig: 5, valor: 'preco' }, pere: { itens: {}, regs: [] } },
    p => p.addInitScript(() => { window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['data_matrix']); } detect() { return Promise.resolve([{ rawValue: '0102060190009984' + '17261108' + '3103000312', format: 'data_matrix' }]); } }; }));
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pePeso').value !== '');
  await a.p.fill('#peDesc', 'Lombo Fracionado');
  await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  // sem rede: cartão fecha e o registro fica salvo no aparelho, marcado como pendente
  await a.p.waitForFunction(() => document.getElementById('cardPe').style.display === 'none');
  await a.p.waitForFunction(() => { try { const d = JSON.parse(localStorage.getItem('validade_dados')); return d.pere.regs.length === 1 && String(d.pere.regs[0].cod) === '6019'; } catch (e) { return false; } });
  assert.ok((await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).pendentes || 0)) >= 1, 'marca pendente');
  // volta a internet → dispara "online" → sincroniza e zera pendentes
  net.online = true;
  await a.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.p.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem('validade_sync')) || {}).pendentes === 0; } catch (e) { return false; } });
  await a.fechar();
});

tflaky('offline: lote salva no aparelho sem rede e marca pendente', { skip: pular }, async () => {
  const net = { online: false };
  const a = await abrirRegistro(p => rotasRede(p, net), { prod: { '7891000315507': { nome: 'Café', lotes: [] } }, cat: {}, pere: { itens: {}, regs: [] } });
  await a.p.click('nav button[data-v="reg"]'); await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Café');
  await a.p.fill('#pLote', 'l9'); await a.p.fill('#pQtd', '2'); await a.p.fill('#pVal', '2031-01-01'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => { try { const d = JSON.parse(localStorage.getItem('validade_dados')); return d.prod['7891000315507'] && d.prod['7891000315507'].lotes.some(l => l.lote === 'L9'); } catch (e) { return false; } });
  assert.ok((await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).pendentes || 0)) >= 1, 'marca pendente');
  await a.fechar();
});

tflaky('OCR desligado: não mexe na descrição nem no SIF', { skip: pular }, async () => {
  const a = await abrir({ dados: { aj: { dig: 5, valor: 'preco', ocr: false }, pere: { itens: {}, regs: [] } },
    antes: p => p.addInitScript(`
      window.BarcodeDetector = class {
        static getSupportedFormats(){ return Promise.resolve(['data_matrix']); }
        detect(){ return Promise.resolve([{ rawValue: '0102031950017263'+'17261108'+'3103000864', format: 'data_matrix' }]); }
      };
      window.Tesseract = { createWorker: async () => { throw new Error('não deveria ser chamado'); } };
    `) });
  await a.p.click('nav button[data-v="pere"]');
  await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  await a.p.waitForTimeout(300);
  assert.strictEqual(await a.p.inputValue('#peDesc'), '');
  assert.strictEqual(await a.p.inputValue('#peSif'), '');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('conta: entra (usuário→e-mail interno), lista e escolhe a loja', { skip: pular }, async () => {
  const a = await abrir({ url: URL_SUPA, chave: 'validade_sessao', dados: null });
  let authBody = null;
  await a.p.route('**/auth/v1/token*', async r => { try { authBody = r.request().postDataJSON(); } catch (e) {}
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: 'joao@loja.validade' } }) }); });
  await a.p.route('**/rest/v1/lojas*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'L1', nome: 'Bangu' }, { id: 'L2', nome: 'Campo Grande' }]) }));
  await a.p.waitForSelector('#conta', { state: 'visible' });
  await a.p.fill('#cUser', 'joao'); await a.p.fill('#cPass', '1234');
  await a.p.click('#bEntrar');
  await a.p.waitForFunction(() => document.querySelectorAll('#selectLoja option').length === 3);
  assert.strictEqual(authBody && authBody.email, 'joao@loja.validade'); // usuário vira e-mail interno
  await a.p.selectOption('#selectLoja', 'L2');
  await a.p.click('#bSelecionarLoja');
  await a.p.waitForFunction(() => !document.getElementById('conta').classList.contains('on'));
  const sess = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_sessao')));
  assert.strictEqual(sess.access_token, 'tok');
  assert.strictEqual(sess.usuario, 'joao');
  assert.strictEqual(sess.lojaId, 'L2');
  assert.strictEqual(sess.lojaNome, 'Campo Grande');
  await a.p.click('nav button[data-v="aj"]');
  await a.p.waitForSelector('#cardConta', { state: 'visible' });
  assert.ok((await a.p.textContent('#contaInfo')).includes('Campo Grande'));
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('conta: sair invalida token e retorna à tela de login', { skip: pular }, async () => {
  const a = await abrir({ url: URL_SUPA, chave: 'validade_sessao', dados: { access_token: 'logout-token', refresh_token: 'logout-refresh', expira: Date.now()+3600000, usuario: 'joao', uid: 'u1', lojaId: 'L1', lojaNome: 'Bangu' } });
  let logoutAuthorization = '';
  await a.p.route('**/auth/v1/logout', async r => { logoutAuthorization = r.request().headers().authorization || ''; await r.fulfill({ status: 204, body: '' }); });
  await a.p.evaluate(() => document.getElementById('bLogoutHdr').click());
  await a.p.waitForFunction(() => localStorage.getItem('validade_sessao') === null);
  await a.p.waitForSelector('#conta-login', { state: 'visible' });
  assert.strictEqual(logoutAuthorization, 'Bearer logout-token');
  assert.strictEqual(await a.p.evaluate(() => localStorage.getItem('validade_sessao')), null);
  // simula botão Voltar após logout: sessão/tela autenticada não pode reaparecer
  await a.p.evaluate(() => { history.pushState({protected:true}, '', location.href.split('#')[0]+'#protected'); history.back(); });
  await a.p.waitForFunction(() => localStorage.getItem('validade_sessao') === null);
  await a.p.waitForSelector('#conta-login', { state: 'visible' });
  assert.strictEqual(await a.p.evaluate(() => localStorage.getItem('validade_sessao')), null);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('conta: senha errada mostra mensagem de erro', { skip: pular }, async () => {
  const a = await abrir({ url: URL_SUPA });
  await a.p.route('**/auth/v1/token*', r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error_description: 'Invalid login credentials' }) }));
  await a.p.waitForSelector('#conta', { state: 'visible' });
  await a.p.fill('#cUser', 'joao'); await a.p.fill('#cPass', 'errada');
  await a.p.click('#bEntrar');
  await a.p.waitForSelector('#cErro', { state: 'visible' });
  assert.match((await a.p.textContent('#cErro')).toLowerCase(), /inválid|invalid/);
  const sess = await a.p.evaluate(() => localStorage.getItem('validade_sessao'));
  assert.strictEqual(sess, null); // não cria sessão
  await a.fechar();
});

tflaky('sem Supabase configurado: card de conta fica oculto', { skip: pular }, async () => {
  const a = await abrir({ url: URL_NOSUPA });
  await a.p.click('nav button[data-v="aj"]');
  await a.p.waitForSelector('#v-aj.on');
  assert.strictEqual(await a.p.isVisible('#cardConta'), false);
  await a.fechar();
});

/* abre o app já logado (sessão posta via evaluate + reload, como os demais testes);
   setupRotas registra as rotas ANTES do reload, para o pull inicial ser interceptado */
async function abrirLogado(setupRotas, dados, sessaoExtra) {
  const a = await abrir({ url: URL_SUPA });
  if (setupRotas) await setupRotas(a.p);
  await a.p.evaluate(([d, extra]) => { localStorage.setItem('validade_sessao', JSON.stringify(Object.assign({ access_token: 'tok', refresh_token: 'ref', expira: Date.now() + 3600000, usuario: 'teste', email: 'teste@loja.validade', uid: 'u1', lojaId: 'L1', lojaNome: 'Loja Teste' }, extra || {}))); if (d) localStorage.setItem('validade_dados', JSON.stringify(d)); }, [dados, sessaoExtra]);
  await a.p.reload();
  return a;
}
/* Como abrirLogado, porém injeta o leitor nativo/OCR (antes) ANTES de carregar,
   para os testes de scanner. Desde o PR #18 o registro salva direto no Supabase,
   então estes testes rodam logados e com as rotas de salvar mockadas. */
async function abrirRegistro(setupRotas, dados, antes) {
  const a = await abrir({ url: URL_SUPA, antes });
  if (setupRotas) await setupRotas(a.p);
  await a.p.evaluate((d) => {
    localStorage.setItem('validade_sessao', JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expira: Date.now() + 3600000, usuario: 'teste', email: 'teste@loja.validade', uid: 'u1', papel: 'operador', nome: 'Teste', lojaId: 'L1', lojaNome: 'Loja Teste' }));
    if (d) localStorage.setItem('validade_dados', JSON.stringify(d));
  }, dados);
  await a.p.reload();
  return a;
}
/* Mocks do Supabase para o fluxo de registro logado (salvar lote/perecível, pull, auditoria…).
   `cap` (opcional) coleta os corpos enviados por tabela, para os testes verificarem o payload. */
async function rotasRegistro(p, cap) {
  cap = cap || {};
  await p.route(/\/rest\/v1\/perfis/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Teste' }]) }));
  await p.route(/\/rest\/v1\/catalogo/, r => { const m = r.request().method(); r.fulfill({ status: m === 'GET' ? 200 : 201, contentType: 'application/json', body: m === 'GET' ? '[]' : '' }); });
  await p.route(/\/rest\/v1\/rpc\/registrar_lote$/, r => { const body = r.request().postDataJSON(); (cap.rpc_lote = cap.rpc_lote || []).push(body); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Teste', criado: Date.now() }) }); });
  await p.route(/\/rest\/v1\/rpc\/registrar_perecivel$/, r => { const body = r.request().postDataJSON(); (cap.rpc_perecivel = cap.rpc_perecivel || []).push(body); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Teste', descricao: body.p_descricao, sif: body.p_sif, criado: Date.now() }) }); });
  for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs', 'auditoria', 'preferencias', 'lojas', 'loja_membros']) {
    await p.route(new RegExp('/rest/v1/' + t + '(\\?|$)'), r => {
      const m = r.request().method();
      if (m !== 'GET') { try { (cap[t] = cap[t] || []).push(...r.request().postDataJSON()); } catch (e) {} }
      r.fulfill({ status: m === 'GET' ? 200 : 201, contentType: 'application/json', body: m === 'GET' ? '[]' : '' });
    });
  }
  return cap;
}
const R_PULL = /\/catalogo\?updated_at=gt/, R_LOOK = /\/catalogo\?ean=eq\./, R_PUSH = /\/catalogo\?on_conflict=ean/, R_OFF = /openfoodfacts\.org/;

tflaky('sessão: renova token expirado antes de sincronizar produtos e lotes', { skip: pular }, async () => {
  let renovacoes = 0; const autorizacoes = [];
  const a = await abrirLogado(async p => {
    await p.route('**/auth/v1/token*', async r => {
      if (!r.request().url().includes('grant_type=refresh_token')) return r.continue();
      renovacoes++;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'token-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } }) });
    });
    await p.route('**/rest/v1/**', async r => {
      autorizacoes.push(r.request().headers().authorization || '');
      const url = new URL(r.request().url());
      let rows = [];
      if (r.request().method() === 'GET' && url.pathname === '/rest/v1/catalogo') rows = [{ ean: '7891234567890', nome: 'Produto compartilhado', marca: '', img: '', updated_at: '2026-11-07T20:00:00Z' }];
      if (r.request().method() === 'GET' && url.pathname === '/rest/v1/produtos') rows = [{ ean: '7891234567890', updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      if (r.request().method() === 'GET' && url.pathname === '/rest/v1/lotes') rows = [{ id: 'lote-compartilhado', ean: '7891234567890', lote: 'L05', qtd: 5, val: '2026-12-01', criado: 1, updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
  }, null, { expira: Date.now() - 1000 });
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_sync') || '{}').recebido; } catch (e) { return false; } });
  assert.ok(renovacoes >= 1, 'renovou a sessão expirada');
  assert.ok(autorizacoes.length > 0 && autorizacoes.every(x => x === 'Bearer token-novo'), 'as chamadas de sincronização usaram o token renovado');
  assert.strictEqual(JSON.parse(await a.p.evaluate(() => localStorage.getItem('validade_sessao'))).refresh_token, 'ref-novo');
  const dados = await a.salvo();
  assert.strictEqual(dados.cat['7891234567890'].nome, 'Produto compartilhado');
  assert.ok(dados.prod['7891234567890'], 'a associação do produto da loja foi sincronizada');
  assert.strictEqual(dados.prod['7891234567890'].lotes[0].id, 'lote-compartilhado');
  await a.p.click('nav button[data-v="prod"]');
  assert.ok((await a.p.textContent('#listaProd')).includes('Produto compartilhado'), 'o produto da mesma loja aparece na lista');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('sessão: renova e repete uma chamada ao receber 401', { skip: pular }, async () => {
  let renovacoes = 0, tentativasCatalogo = 0, liberarRetry;
  const retryConcluido = new Promise(resolve => { liberarRetry = resolve; });
  const a = await abrirLogado(async p => {
    await p.route('**/*', async r => {
      const url = new URL(r.request().url());
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        renovacoes++;
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'token-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } }) });
      }
      if (url.hostname === 'test.supabase.co' && url.pathname === '/rest/v1/catalogo' && url.searchParams.has('updated_at')) {
        tentativasCatalogo++;
        if (tentativasCatalogo === 1) return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"JWT expired"}' });
        await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        liberarRetry();
        return;
      }
      if (url.hostname === 'test.supabase.co') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return r.continue();
    });
  });
  await retryConcluido;
  assert.strictEqual(renovacoes, 1);
  assert.strictEqual(tentativasCatalogo, 2, 'repetiu uma vez a chamada recusada');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('catálogo: usa o nome do catálogo compartilhado (antes das fontes externas)', { skip: pular }, async () => {
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(R_LOOK, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ nome: 'Café Pilão 500g', marca: 'Pilão', img: '' }]) }));
    await p.route(R_PUSH, r => r.fulfill({ status: 201, body: '' }));
    await p.route(R_OFF, r => r.fulfill({ status: 200, body: '{"status":0}' }));
  });
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Café Pilão 500g');
  assert.ok((await a.p.textContent('#pStatus')).includes('catálogo'));
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('catálogo: não achou local, acha no Open Food Facts e envia para o catálogo', { skip: pular }, async () => {
  let pushBody = null;
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(R_LOOK, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(R_PUSH, async r => { try { pushBody = r.request().postDataJSON(); } catch (e) {} await r.fulfill({ status: 201, body: '' }); });
    await p.route(R_OFF, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 1, product: { product_name: 'Biscoito X', brands: 'MarcaY', image_front_small_url: '' } }) }));
  });
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7899999999999'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Biscoito X');
  await a.p.waitForTimeout(300);
  assert.ok(pushBody && pushBody[0] && pushBody[0].nome === 'Biscoito X', 'enviou o nome ao catálogo');
  assert.ok((await a.p.textContent('#pStatus')).includes('Open Food Facts'));
  await a.fechar();
});

tflaky('catálogo: pull junta os produtos do servidor no cache local', { skip: pular }, async () => {
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { ean: '111', nome: 'Arroz', marca: '', img: '', updated_at: '2026-11-06T10:00:00Z' },
      { ean: '222', nome: 'Feijão', marca: '', img: '', updated_at: '2026-11-06T11:00:00Z' }]) }));
  });
  await a.p.waitForFunction(() => { try { const d = JSON.parse(localStorage.getItem('validade_dados')); return !!(d && d.cat && d.cat['111'] && d.cat['222']); } catch (e) { return false; } });
  const d = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_dados')));
  assert.strictEqual(d.cat['111'].nome, 'Arroz');
  assert.strictEqual(d.cat['222'].nome, 'Feijão');
  const sync = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_sync')));
  assert.strictEqual(sync.catalogo, '2026-11-06T11:00:00Z');
  await a.fechar();
});

tflaky('sync: produtos por loja guardam somente EAN e leem nome do catálogo global', { skip: pular }, async () => {
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { ean: '789', nome: 'Nome do catálogo', marca: 'Marca global', img: '', updated_at: '2026-11-07T10:00:00Z' }
    ]) }));
    await p.route(/\/rest\/v1\/produtos\?loja_id=/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { ean: '789', updated_at: '2026-11-07T11:00:00Z', deleted_at: null }
    ]) }));
    for (const t of ['lotes', 'pere_itens', 'pere_regs']) await p.route(new RegExp('/rest/v1/' + t + '\\?loja_id='), r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(new RegExp('/rest/v1/catalogo\\?on_conflict'), r => r.fulfill({ status: 201, body: '' }));
    await p.route(new RegExp('/rest/v1/produtos\\?on_conflict'), r => r.fulfill({ status: 201, body: '' }));
    for (const t of ['lotes', 'pere_itens', 'pere_regs']) await p.route(new RegExp('/rest/v1/' + t + '\\?on_conflict'), r => r.fulfill({ status: 201, body: '' }));
  });
  await a.p.waitForFunction(() => { const d = JSON.parse(localStorage.getItem('validade_dados') || '{}'); return !!(d.prod && d.prod['789'] && d.cat && d.cat['789']); });
  const d = await a.salvo();
  assert.deepStrictEqual(Object.keys(d.prod['789']), ['lotes']);
  await a.p.click('nav button[data-v="prod"]');
  assert.ok((await a.p.textContent('#listaProd')).includes('Nome do catálogo'));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('backup: envia atributos ao catálogo único e apenas associações loja-EAN em produtos', { skip: pular }, async () => {
  const bodies = {};
  const dados = {
    prod: { '789': { nome: 'Café', marca: '', img: '', lotes: [{ id: 'l1', lote: 'L1', qtd: 3, val: '2027-01-01', criado: 1 }] } },
    cat: {},
    pere: { itens: { '6019': { desc: 'Pernil', sif: '876' } }, regs: [{ id: 'r1', cod: '6019', sif: '876', peso: 0.8, val: '2026-12-01', criado: 2 }] },
    aj: { dig: 5, valor: 'preco', dias: 30, notif: true, ocr: true, cosmos: '' }
  };
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(new RegExp('/rest/v1/catalogo\\?on_conflict'), async r => {
      try { bodies.catalogo = r.request().postDataJSON(); } catch (e) {}
      await r.fulfill({ status: 201, body: '' });
    });
    for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs']) {
      await p.route(new RegExp('/rest/v1/' + t + '\\?on_conflict'), async r => {
        try { (bodies[t] = bodies[t] || []).push(...r.request().postDataJSON()); } catch (e) {}
        await r.fulfill({ status: 201, body: '' });
      });
    }
  }, dados);
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_sync') || '{}').backup; } catch (e) { return false; } });
  assert.ok(bodies.catalogo.some(r => r.ean === '789' && r.nome === 'Café'), 'metadados enviados ao catálogo global');
  assert.ok(bodies.produtos.some(r => r.ean === '789' && r.loja_id === 'L1' && Object.keys(r).sort().join(',').includes('ean') && Object.keys(r).sort().join(',').includes('loja_id')), 'associação loja-EAN enviada sem atributos duplicados');
  assert.ok(bodies.lotes.some(r => r.id === 'l1' && r.ean === '789' && r.qtd === 3 && r.loja_id === 'L1'), 'lote enviado');
  assert.ok(bodies.pere_itens.some(r => r.cod === '6019' && r.descricao === 'Pernil' && r.loja_id === 'L1'), 'código enviado');
  assert.ok(bodies.pere_regs.some(r => r.id === 'r1' && r.peso === 0.8 && r.loja_id === 'L1'), 'registro enviado');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('sincronização por loja: Jonatas vê o lote de William com setor e autoria', { skip: pular }, async () => {
  const a = await abrirLogado(async p => {
    await p.route('**/rest/v1/**', async r => {
      const u = new URL(r.request().url()), method = r.request().method();
      let rows = [];
      if (u.pathname === '/rest/v1/perfis') rows = [{ papel: 'operador', nome: 'Jonatas' }];
      if (method === 'GET' && u.pathname === '/rest/v1/catalogo' && u.searchParams.has('updated_at')) rows = [{ ean: '7891234567890', nome: 'Produto compartilhado', marca: '', img: '', updated_at: '2026-11-07T20:00:00Z' }];
      if (method === 'GET' && u.pathname === '/rest/v1/produtos') rows = [{ ean: '7891234567890', updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      if (method === 'GET' && u.pathname === '/rest/v1/lotes') rows = [{ id: 'lote-william', ean: '7891234567890', lote: 'FL05-W', qtd: 7, val: '2026-12-10', setor: 'Açougue', criado: 1, created_by: 'u1', created_by_nome: 'William', updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      return r.fulfill({ status: method === 'GET' ? 200 : 201, contentType: 'application/json', body: JSON.stringify(rows) });
    });
  }, null, { uid: 'u2', usuario: 'jonatas', nome: 'Jonatas' });
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_sync') || '{}').recebido; } catch (e) { return false; } });
  await a.p.click('nav button[data-v="prod"]');
  const texto = await a.p.textContent('#listaProd');
  assert.ok(texto.includes('Produto compartilhado'));
  assert.ok(texto.includes('Açougue'));
  assert.ok(texto.includes('informado por William'));
  assert.ok((await a.p.textContent('#lojaAtualLabel')).includes('Jonatas'));
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('cadastro do operador: lote e perecível enviam setor à RPC e armazenam autoria do servidor', { skip: pular }, async () => {
  const chamadas = {};
  const a = await abrirLogado(async p => {
    await p.route('**/rest/v1/**', async r => {
      const u = new URL(r.request().url()), method = r.request().method();
      if (u.pathname === '/rest/v1/perfis') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Jonatas' }]) });
      if (u.pathname === '/rest/v1/rpc/registrar_lote') {
        chamadas.lote = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Jonatas', criado: 1794170000000 }) });
      }
      if (u.pathname === '/rest/v1/rpc/registrar_perecivel') {
        chamadas.perecivel = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Jonatas', descricao: 'Pernil', sif: 'SIF-1', criado: 1794170000001 }) });
      }
      if (method === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 201, body: '' });
    });
  }, { cat: { '7891234567890': { nome: 'Arroz' } } });
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891234567890'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Arroz');
  await a.p.fill('#pLote', 'L-W'); await a.p.fill('#pQtd', '4'); await a.p.fill('#pVal', '2026-12-20'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => { const d=JSON.parse(localStorage.getItem('validade_dados')); return !!(d.prod['7891234567890']&&d.prod['7891234567890'].lotes.length); });
  assert.strictEqual(chamadas.lote.p_setor, 'Mercearia');
  assert.strictEqual(chamadas.lote.p_loja_id, 'L1');
  assert.strictEqual((await a.salvo()).prod['7891234567890'].lotes[0].created_by_nome, 'Jonatas');

  await a.p.click('nav button[data-v="pere"]');
  await a.p.fill('#tCodBal', '6019'); await a.p.click('#bBuscarBal');
  await a.p.fill('#peDesc', 'Pernil'); await a.p.fill('#peSif', 'SIF-1'); await a.p.fill('#pePeso', '0.650'); await a.p.fill('#peVal', '2026-12-18'); await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  await a.p.waitForFunction(() => { const d=JSON.parse(localStorage.getItem('validade_dados')); return d.pere.regs.length===1; });
  assert.strictEqual(chamadas.perecivel.p_setor, 'Açougue');
  assert.strictEqual(chamadas.perecivel.p_cod, '6019');
  assert.strictEqual((await a.salvo()).pere.regs[0].created_by_nome, 'Jonatas');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('compatibilidade de migration: mantém leitura quando as colunas novas ainda não existem', { skip: pular }, async () => {
  let fallbackLote = 0, fallbackPere = 0;
  const a = await abrirLogado(async p => {
    await p.route('**/rest/v1/**', async r => {
      const u = new URL(r.request().url()), method = r.request().method();
      if (u.pathname === '/rest/v1/perfis') return r.fulfill({ status: 200, contentType: 'application/json', body: '[{"papel":"operador","nome":"Jonatas"}]' });
      if (method === 'GET' && u.pathname === '/rest/v1/catalogo') return r.fulfill({ status: 200, contentType: 'application/json', body: '[{"ean":"7891234567890","nome":"Produto legado","updated_at":"2026-11-07T20:00:00Z"}]' });
      if (method === 'GET' && u.pathname === '/rest/v1/lotes' && u.searchParams.get('select').includes('setor')) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"PGRST204","message":"Could not find the setor column of lotes in the schema cache"}' });
      if (method === 'GET' && u.pathname === '/rest/v1/lotes') { fallbackLote++; return r.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"old-lot","ean":"7891234567890","lote":"LEGADO","qtd":2,"val":"2026-12-10","created_by":"u1","updated_at":"2026-11-07T20:00:00Z","deleted_at":null}]' }); }
      if (method === 'GET' && u.pathname === '/rest/v1/pere_regs' && u.searchParams.get('select').includes('setor')) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"PGRST204","message":"Could not find the setor column of pere_regs in the schema cache"}' });
      if (method === 'GET' && u.pathname === '/rest/v1/pere_regs') { fallbackPere++; return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); }
      if (method === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 201, body: '' });
    });
  });
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_sync') || '{}').recebido; } catch (e) { return false; } });
  assert.strictEqual(fallbackLote, 1);
  assert.strictEqual(fallbackPere, 1);
  const d = await a.salvo();
  assert.strictEqual(d.prod['7891234567890'].lotes[0].lote, 'LEGADO');
  await a.p.click('nav button[data-v="prod"]');
  const texto = await a.p.textContent('#listaProd');
  assert.ok(texto.includes('Produto legado'));
  assert.ok(texto.includes('Setor não informado'));
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

const R_PERFIL = /\/rest\/v1\/perfis/;
async function rotasBase(p, papel) {
  await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p.route(R_PERFIL, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel, nome: papel }]) }));
  for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs']) await p.route(new RegExp('/rest/v1/' + t + '\\?on_conflict'), r => r.fulfill({ status: 201, body: '' }));
}

tflaky('gate: sem sessão, exige login ao abrir (tela de login bloqueia o sistema)', { skip: pular }, async () => {
  const a = await abrir({ url: URL_SUPA });
  await a.p.waitForSelector('#conta', { state: 'visible' });
  // tela de login visível e bloqueando o acesso
  assert.strictEqual(await a.p.isVisible('#conta-login'), true);
  assert.strictEqual(await a.p.isVisible('#bEntrar'), true);
  // não há botão de cancelar/voltar enquanto não logado
  assert.strictEqual(await a.p.$('#bCancelaConta'), null);
  await a.fechar();
});

tflaky('papel analista: pode registrar dados (regra aprovada, PR #17)', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'analista'));
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).papel === 'analista'; } catch (e) { return false; } });
  // Decisão de produto (B): analista REGISTRA dados; inicia pelo seletor de tipo.
  assert.strictEqual(await a.p.isVisible('nav button[data-v="reg"]'), true);
  assert.strictEqual(await a.p.isVisible('#bTipoIndustrial'), true);
  await a.fechar();
});

tflaky('papel operador: Registrar visível; códigos (cadastro) escondido', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'operador'));
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).papel === 'operador'; } catch (e) { return false; } });
  assert.strictEqual(await a.p.isVisible('nav button[data-v="reg"]'), true);
  await a.p.click('nav button[data-v="pere"]');
  assert.strictEqual(await a.p.isVisible('#subPere button[data-s="cad"]'), false);
  await a.fechar();
});

tflaky('papel: carregarPapel busca o PRÓPRIO perfil (filtra por id), não o de outro usuário', { skip: pular }, async () => {
  // admin/analista/gerente enxergam vários perfis via RLS; sem filtro por id o
  // limit=1 pegaria o papel de outra pessoa. A rota devolve o papel conforme o id pedido.
  let pediuId = null;
  const a = await abrirLogado(async p => {
    await p.route(R_PULL, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(R_PERFIL, r => {
      const url = r.request().url();
      pediuId = /[?&]id=eq\.([^&]+)/.exec(url);
      const u = pediuId && decodeURIComponent(pediuId[1]);
      // se filtrou pelo próprio uid (u1) → admin; senão devolve OUTRO (analista)
      const papel = u === 'u1' ? 'admin' : 'analista';
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel, nome: papel }]) });
    });
    for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs']) await p.route(new RegExp('/rest/v1/' + t + '\\?on_conflict'), r => r.fulfill({ status: 201, body: '' }));
  });
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).papel === 'admin'; } catch (e) { return false; } });
  assert.ok(pediuId, 'a requisição de perfis precisa filtrar por id=eq.<uid>');
  assert.strictEqual(decodeURIComponent(pediuId[1]), 'u1');
  await a.fechar();
});

tflaky('gestão de usuários: assistente visualiza card, cria operador e envia payload ao endpoint', { skip: pular }, async () => {
  let payloadCriar=null;
  const a=await abrirLogado(async p=>{
    await rotasBase(p,'assistente');
    await p.route(/\/functions\/v1\/gerir-usuarios/,async r=>{
      const req=r.request();let body={};try{body=req.postDataJSON();}catch(e){}
      if(body.acao==='listar')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({usuarios:[],lojas:[{id:'L1',nome:'Loja Teste'}],euPapel:'assistente'})});
      if(body.acao==='criar'){payloadCriar=body;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,id:'new-user'})});}
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    });
  });
  await a.p.waitForFunction(()=>document.getElementById('cardUsuarios').style.display!=='none');
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual(await a.p.isVisible('#cardUsuarios'),true);
  assert.strictEqual(await a.p.isDisabled('#uPapel'),true);
  await a.p.fill('#uUsuario','operador.novo');
  await a.p.fill('#uNome','Operador Novo');
  await a.p.fill('#uSenha','Guanabara2026!');
  await a.p.check('#uLojas input[value="L1"]');
  await a.p.click('#bUsuarioCriar');
  await a.p.waitForFunction(()=>document.getElementById('uUsuario').value==='');
  assert.strictEqual(payloadCriar.usuario,'operador.novo');
  assert.strictEqual(payloadCriar.papel,'operador');
  assert.deepStrictEqual(payloadCriar.lojas,['L1']);
  assert.deepStrictEqual(a.erros,[]);
  await a.fechar();
});

tflaky('cosmos: cada usuário carrega e salva o seu próprio token (perfil pessoal)', { skip: pular }, async () => {
  let salvo = null;
  const a = await abrirLogado(async p => {
    await rotasBase(p, 'operador');
    await p.route(/\/rest\/v1\/preferencias\?select/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ cosmos_token: 'TKN-123' }]) }));
    await p.route(/\/rest\/v1\/preferencias\?on_conflict/, async r => { try { salvo = r.request().postDataJSON(); } catch (e) {} await r.fulfill({ status: 201, body: '' }); });
  });
  // o token do usuário chega na sessão
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).cosmos === 'TKN-123'; } catch (e) { return false; } });
  await a.p.click('nav button[data-v="aj"]');
  // operador (sem permissão de ajustes) ainda edita o PRÓPRIO token
  assert.strictEqual(await a.p.getAttribute('#aCosmos', 'disabled'), null);
  assert.strictEqual(await a.p.inputValue('#aCosmos'), 'TKN-123');
  // troca o token → faz upsert em preferencias com o uid do usuário
  await a.p.fill('#aCosmos', 'NOVO-999');
  await a.p.dispatchEvent('#aCosmos', 'change');
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).cosmos === 'NOVO-999'; } catch (e) { return false; } });
  assert.ok(salvo && salvo[0] && salvo[0].user_id === 'u1' && salvo[0].cosmos_token === 'NOVO-999', 'upsert com uid e token do usuário');
  await a.fechar();
});
