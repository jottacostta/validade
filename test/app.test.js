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
  await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
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
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="alertas"]');
  await zera();
  await a.p.fill('#aDias', '10'); await a.p.press('#aDias', 'Tab');
  assert.deepStrictEqual(await ver(), [['r_a', 'r_v', 'x_a', 'x_v'], ['r_a', 'r_v', 'x_a', 'x_v']]);
  await zera(); await a.p.locator('#aNotif').uncheck();
  assert.deepStrictEqual(await ver(), [[], ['r_a', 'r_v', 'x_a', 'x_v']]);
  await zera();
  if (await a.p.isVisible('#sysSectionHead')) { await a.p.click('#sysBackToMenu'); await a.p.click('#sysMenu [data-sys-open="dados"]'); }
  a.respostas.push(true, true); await a.p.click('#bZerar');
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
  // fluxo aprovado: depois de salvar aparece a confirmação; "Novo registro" volta ao formulário
  await a.p.waitForSelector('#regSucesso', { state: 'visible' }); await a.p.click('#bNovoRegistro');
  // lote DUPLICADO (mesmo L1 + 2031-01-01) → rejeitado, nada muda
  await salvarLote('l1', 9, '2031-01-01');
  assert.strictEqual(await a.p.isVisible('#regSucesso'), false, 'duplicado rejeitado não mostra confirmação');
  const ls = (await a.salvo()).prod['7891000315507'].lotes;
  assert.strictEqual(ls.length, 2, 'duplicado não cria novo lote');
  assert.ok(ls.some(l => l.lote === 'L1' && l.qtd === 5), 'lote existente permanece com qtd 5');
  assert.ok(ls.some(l => l.lote === 'L2' && l.qtd === 3), 'lote novo L2 foi salvo');
  await a.fechar();
});

tflaky('editar registro de perecível (peso, validade, SIF) e apagar', { skip: pular }, async () => {
  const a = await abrir({ dados: { pere: { itens: { 12: { desc: 'Picanha', sif: '1' } }, regs: [{ id: 'r', cod: '12', sif: '1', peso: 1.25, val: '2031-01-01' }] } } });
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="lista"]');
  await a.p.click('[data-edit-pere="r"]');
  await a.p.fill('#edPeso', '2.5'); await a.p.fill('#edPereVal', '15/3/32'); await a.p.fill('#edSif', '999'); await a.p.selectOption('#edPereSetor', 'Açougue'); await a.p.click('#bEditSave');
  let r = (await a.salvo()).pere.regs[0];
  assert.deepStrictEqual([r.peso, r.val, r.sif], [2.5, '2032-03-15', '999']);
  assert.ok((await a.p.textContent('#listaPe')).includes('15/03/2032'));
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('[data-edit-pere="r"]'); await a.p.fill('#edPeso', '3'); await a.p.fill('#edPereVal', '31/02/2032'); await a.p.selectOption('#edPereSetor', 'Açougue'); await a.p.click('#bEditSave');  // data inexistente: nada muda
  r = (await a.salvo()).pere.regs[0];
  assert.deepStrictEqual([r.peso, r.val], [2.5, '2032-03-15']);
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('[data-edit-pere="r"]'); a.respostas.push(true); await a.p.click('#bEditDelete');
  assert.strictEqual((await a.salvo()).pere.regs.length, 0);
  await a.fechar();
});

tflaky('nome do arquivo usa a data local (depois das 21h no Brasil)', { skip: pular }, async () => {
  const a = await abrir({ opcoes: { timezoneId: 'America/Sao_Paulo' },
    antes: p => p.clock.install({ time: new Date('2026-11-06T23:30:00-03:00') }) });
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="dados"]');
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
  await a.p.click('#subPere button[data-s="reg"]'); await a.p.click('#bEscanearBal');
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
  // fluxo aprovado: confirmação do registro e "Novo registro" volta ao formulário de perecível
  await a.p.waitForSelector('#regSucesso', { state: 'visible' });
  assert.ok((await a.p.textContent('#regSucesso')).includes('Picanha Suína Fracionada'));
  await a.p.click('#bNovoRegistro');
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
  await a.p.click('#subPere button[data-s="reg"]'); await a.p.click('#bEscanearBal');
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
  await a.p.click('#subPere button[data-s="reg"]'); await a.p.click('#bEscanearBal');
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
  await a.p.click('nav button[data-v="home"]'); await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });           // tabela de lotes
  assert.ok(await semOverflow(), 'tela Registrar/produto não pode rolar horizontalmente');
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="lista"]');
  await a.p.waitForFunction(() => document.querySelector('#listaPe .operator-record'));
  assert.ok(await semOverflow(), 'tela Perecíveis não pode rolar horizontalmente');
  await a.fechar();
});

/* Rotas de registro com um interruptor de rede: abort() simula falta de internet. */
async function rotasRede(p, estado) {
  estado.rpcs = estado.rpcs || []; estado.upserts = estado.upserts || [];
  const resp = (r) => { const m = r.request().method(), u = new URL(r.request().url()); if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    try { estado.upserts.push({ tabela: u.pathname.split('/').pop(), body: r.request().postDataJSON() }); } catch (e) {}
    return estado.online ? r.fulfill({ status: 201, body: '' }) : r.abort(); };
  await p.route(/\/rest\/v1\/perfis/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Teste' }]) }));
  await p.route(/\/rest\/v1\/catalogo/, resp);
  for (const rpc of ['registrar_lote', 'registrar_perecivel']) await p.route(new RegExp('/rest/v1/rpc/' + rpc + '$'), r => {
    let payload = null; try { payload = r.request().postDataJSON(); } catch (e) {}
    const forcarFalha = (estado.falhaRpcIds || []).includes(payload && payload.p_id);
    estado.rpcs.push({ rpc, payload, online: estado.online, forcarFalha });
    return estado.online && !forcarFalha ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Teste', criado: Date.now() }) }) : r.abort('internetdisconnected');
  });
  for (const t of ['produtos', 'lotes', 'pere_itens', 'pere_regs', 'auditoria', 'preferencias', 'lojas', 'loja_membros']) await p.route(new RegExp('/rest/v1/' + t + '(\\?|$)'), resp);
}

tflaky('offline: perecível salva no aparelho sem rede e sincroniza ao reconectar', { skip: pular }, async () => {
  const net = { online: false };
  const a = await abrirRegistro(p => rotasRede(p, net), { aj: { dig: 5, valor: 'preco' }, pere: { itens: {}, regs: [] } },
    p => p.addInitScript(() => { window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['data_matrix']); } detect() { return Promise.resolve([{ rawValue: '0102060190009984' + '17261108' + '3103000312', format: 'data_matrix' }]); } }; }));
  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="reg"]'); await a.p.click('#bEscanearBal');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pePeso').value !== '');
  await a.p.fill('#peDesc', 'Lombo Fracionado');
  await a.p.selectOption('#peSetor', 'Açougue');
  await a.p.click('#bSalvarPe');
  // sem rede: cartão fecha e o registro fica salvo no aparelho, marcado como pendente
  await a.p.waitForFunction(() => document.getElementById('cardPe').style.display === 'none');
  await a.p.waitForFunction(() => { try { const d = JSON.parse(localStorage.getItem('validade_dados')); return d.pere.regs.length === 1 && String(d.pere.regs[0].cod) === '6019'; } catch (e) { return false; } });
  assert.ok((await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).pendentes || 0)) >= 1, 'marca pendente');
  const fila = await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).filaRegistros || []);
  assert.strictEqual(fila.length, 1); assert.strictEqual(fila[0].tipo, 'perecivel'); assert.strictEqual(fila[0].payload.p_setor, 'Açougue');
  // reiniciar comprova que o registro e o payload RPC continuam duráveis no aparelho
  await a.p.reload(); await a.p.waitForSelector('#abas button[data-v="aj"]', { state: 'visible' });
  await a.p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.filaRegistros && s.filaRegistros.length === 1; });
  // volta a internet → dispara "online" → repete a RPC original e zera pendências
  net.online = true;
  await a.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.p.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.pendentes === 0 && (!s.filaRegistros || s.filaRegistros.length === 0); } catch (e) { return false; } });
  assert.ok(net.rpcs.some(x => x.online && x.rpc === 'registrar_perecivel' && x.payload.p_id === fila[0].payload.p_id), 'reconectou repetindo a RPC original com o mesmo ID');
  assert.ok(!net.upserts.some(x => x.tabela === 'pere_regs' && Array.isArray(x.body) && x.body.some(r => r.id === fila[0].payload.p_id)), 'não duplica pelo upsert REST genérico');
  await a.fechar();
});

tflaky('offline: lote salva fila RPC durável e reproduz RPC idempotente após reconexão', { skip: pular }, async () => {
  const net = { online: false };
  const a = await abrirRegistro(p => rotasRede(p, net), { prod: { '7891000315507': { nome: 'Café', lotes: [] } }, cat: {}, pere: { itens: {}, regs: [] } });
  await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Café');
  await a.p.fill('#pLote', 'l9'); await a.p.fill('#pQtd', '2'); await a.p.fill('#pVal', '2031-01-01'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => { try { const d = JSON.parse(localStorage.getItem('validade_dados')); return d.prod['7891000315507'] && d.prod['7891000315507'].lotes.some(l => l.lote === 'L9'); } catch (e) { return false; } });
  assert.ok((await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).pendentes || 0)) >= 1, 'marca pendente');
  const fila = await a.p.evaluate(() => (JSON.parse(localStorage.getItem('validade_sync')) || {}).filaRegistros || []);
  assert.strictEqual(fila.length, 1); assert.strictEqual(fila[0].tipo, 'lote'); assert.strictEqual(fila[0].payload.p_setor, 'Mercearia');
  await a.p.reload(); await a.p.waitForSelector('#abas button[data-v="aj"]', { state: 'visible' });
  await a.p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.filaRegistros && s.filaRegistros.length === 1; });
  net.online = true; await a.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.p.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.pendentes === 0 && (!s.filaRegistros || s.filaRegistros.length === 0); } catch (e) { return false; } });
  const replay = net.rpcs.filter(x => x.online && x.rpc === 'registrar_lote');
  assert.strictEqual(replay.length, 1, 'reconexão reproduz exatamente uma RPC');
  assert.strictEqual(replay[0].payload.p_id, fila[0].payload.p_id);
  assert.strictEqual(replay[0].payload.p_loja_id, 'L1');
  assert.strictEqual(replay[0].payload.p_lote, 'L9');
  assert.ok(!net.upserts.some(x => x.tabela === 'lotes' && Array.isArray(x.body) && x.body.some(r => r.id === fila[0].payload.p_id)), 'não duplica pelo upsert REST genérico');
  await a.fechar();
});

tflaky('offline: falha individual mantém seu item e não impede os próximos RPCs', { skip: pular }, async () => {
  const loteId = 'lote-pendente-1', pereId = 'pere-pendente-2', ean = '7891000315507';
  const net = { online: true, falhaRpcIds: [loteId] };
  const a = await abrirRegistro(p => rotasRede(p, net), {});
  await a.p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.recebido && s.backup; });
  const dados = {
    prod: { [ean]: { lotes: [{ id: loteId, lote: 'L1', qtd: 2, val: '2031-01-01', setor: 'Mercearia', created_by: 'u1' }] } },
    cat: { [ean]: { nome: 'Café' } },
    pere: { itens: { '6019': { desc: 'Lombo', sif: '' } }, regs: [{ id: pereId, cod: '6019', sif: '', peso: 0.4, val: '2031-02-01', setor: 'Açougue', created_by: 'u1' }] }
  };
  const fila = [
    { tipo: 'lote', uid: 'u1', payload: { p_id: loteId, p_loja_id: 'L1', p_ean: ean, p_nome: 'Café', p_lote: 'L1', p_qtd: 2, p_val: '2031-01-01', p_setor: 'Mercearia' } },
    { tipo: 'perecivel', uid: 'u1', payload: { p_id: pereId, p_loja_id: 'L1', p_cod: '6019', p_descricao: 'Lombo', p_sif: '', p_peso: 0.4, p_val: '2031-02-01', p_setor: 'Açougue' } }
  ];
  await a.p.evaluate(([d, q]) => { localStorage.setItem('validade_dados', JSON.stringify(d)); localStorage.setItem('validade_sync', JSON.stringify({ pendentes: q.length, filaRegistros: q })); }, [dados, fila]);
  await a.p.reload(); await a.p.waitForSelector('#abas button[data-v="aj"]', { state: 'visible' });
  await a.p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.pendentes === 1 && s.filaRegistros && s.filaRegistros.length === 1; }, null, { timeout: 10000 });
  const restou = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_sync')).filaRegistros[0]);
  assert.strictEqual(restou.payload.p_id, loteId, 'preserva exatamente o RPC que falhou');
  assert.ok(net.rpcs.some(x => x.rpc === 'registrar_lote' && x.forcarFalha && x.payload.p_id === loteId));
  assert.ok(net.rpcs.some(x => x.rpc === 'registrar_perecivel' && !x.forcarFalha && x.payload.p_id === pereId), 'processa o próximo RPC apesar da falha anterior');
  const regs = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_dados')).pere.regs);
  assert.strictEqual(regs.find(x => x.id === pereId).rpcConfirmado, true, 'marca como confirmada somente a linha aceita pelo servidor');
  net.falhaRpcIds = [];
  await a.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await a.p.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('validade_sync') || '{}'); return s.pendentes === 0 && (!s.filaRegistros || s.filaRegistros.length === 0); });
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
  await a.p.click('#subPere button[data-s="reg"]'); await a.p.click('#bEscanearBal');
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
  await a.p.click('#sysMenu [data-sys-open="op-preferencias"]');
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
  const a = await abrir({ url: URL_SUPA, opcoes: { viewport: { width: 390, height: 844 } } });
  await a.p.route(/\/rest\/v1\/notificacoes(?:\?|$)/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fulfill({ status: 204, body: '' }));
  if (setupRotas) await setupRotas(a.p);
  await a.p.evaluate(([d, extra]) => { localStorage.setItem('validade_sessao', JSON.stringify(Object.assign({ access_token: 'tok', refresh_token: 'ref', expira: Date.now() + 3600000, usuario: 'teste', email: 'teste@loja.validade', uid: 'u1', lojaId: 'L1', lojaNome: 'Loja Teste' }, extra || {}))); if (d) localStorage.setItem('validade_dados', JSON.stringify(d)); }, [dados, sessaoExtra]);
  await a.p.reload();
  return a;
}
/* Como abrirLogado, porém injeta o leitor nativo/OCR (antes) ANTES de carregar,
   para os testes de scanner. Desde o PR #18 o registro salva direto no Supabase,
   então estes testes rodam logados e com as rotas de salvar mockadas. */
async function abrirRegistro(setupRotas, dados, antes) {
  const a = await abrir({ url: URL_SUPA, antes, opcoes: { viewport: { width: 390, height: 844 } } });
  await a.p.route(/\/rest\/v1\/notificacoes(?:\?|$)/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fulfill({ status: 204, body: '' }));
  if (setupRotas) await setupRotas(a.p);
  await a.p.evaluate((d) => {
    localStorage.setItem('validade_sessao', JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expira: Date.now() + 3600000, usuario: 'teste', email: 'teste@loja.validade', uid: 'u1', papel: 'operador', nome: 'Teste', lojaId: 'L1', lojaNome: 'Loja Teste' }));
    if (d) localStorage.setItem('validade_dados', JSON.stringify(d));
  }, dados);
  await a.p.reload();
  await a.p.click('#homeRegister');
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
      if (r.request().method() === 'GET' && url.pathname === '/rest/v1/lotes') rows = [{ id: 'lote-compartilhado', ean: '7891234567890', lote: 'L05', qtd: 5, val: '2026-12-01', criado: 1, em_area_vendas: false, updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
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
  assert.strictEqual(dados.prod['7891234567890'].lotes[0].em_area_vendas, false, 'a localização compartilhada chega ao cache');
  await a.p.click('nav button[data-v="prod"]');
  assert.ok((await a.p.textContent('#listaProd')).includes('Produto compartilhado'), 'o produto da mesma loja aparece na lista');
  assert.ok((await a.p.textContent('#listaProd')).includes('Depósito'), 'a localização compartilhada aparece no cartão');
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
  await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
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
  await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
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
  // produto sem lote não aparece mais em Meus Registros (fica no Catálogo do administrador); o nome continua vindo do catálogo global
  assert.strictEqual(d.cat['789'].nome, 'Nome do catálogo');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('produto conhecido sem lotes abre cadastro direto do cartão do Catálogo', { skip: pular }, async () => {
  const ean = '7891000315507';
  const a = await abrir({ dados: { prod: { [ean]: { lotes: [] } }, cat: { [ean]: { nome: 'Café', marca: 'Marca', img: '' } } } });
  await a.p.click('nav button[data-v="prod"]');
  assert.ok(!(await a.p.textContent('#listaProd')).includes('Café'), 'produto sem lote não aparece em Meus Registros');
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="catalogo"]');
  else await a.p.click('#cfgCatalogo');
  assert.ok((await a.p.textContent('#listaCatalogo')).includes('Café'));
  await a.p.click(`#listaCatalogo [data-register-ean="${ean}"]`);
  await a.p.waitForSelector('#cardProd', { state: 'visible' });
  assert.strictEqual(await a.p.textContent('#pEan'), ean);
  assert.strictEqual(await a.p.inputValue('#pNome'), 'Café');
  assert.strictEqual(await a.p.isVisible('#v-reg'), true);
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

tflaky('cadastro do operador: lote e perecível enviam setor/local à RPC e armazenam autoria do servidor', { skip: pular }, async () => {
  const chamadas = {}; let falharLote = false;
  const a = await abrirLogado(async p => {
    await p.route('**/rest/v1/**', async r => {
      const u = new URL(r.request().url()), method = r.request().method();
      if (u.pathname === '/rest/v1/perfis') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Jonatas' }]) });
      if (u.pathname === '/rest/v1/rpc/registrar_lote') {
        chamadas.lote = r.request().postDataJSON();
        if (falharLote) return r.abort();
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
  await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
  assert.strictEqual(await a.p.isChecked('#pEmAreaVendas'), true, 'a localização inicial é Área de Vendas');
  await a.p.fill('#tCodigo', '7891234567890'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Arroz');
  await a.p.uncheck('#pEmAreaVendas');
  await a.p.fill('#pLote', 'L-W'); await a.p.fill('#pQtd', '4'); await a.p.fill('#pVal', '2026-12-20'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => { const d=JSON.parse(localStorage.getItem('validade_dados')); return !!(d.prod['7891234567890']&&d.prod['7891234567890'].lotes.length); });
  assert.strictEqual(chamadas.lote.p_setor, 'Mercearia');
  assert.strictEqual(chamadas.lote.p_em_area_vendas, false, 'o checkbox desmarcado segue no payload RPC');
  assert.strictEqual(chamadas.lote.p_loja_id, 'L1');
  assert.strictEqual((await a.salvo()).prod['7891234567890'].lotes[0].created_by_nome, 'Jonatas');
  assert.strictEqual((await a.salvo()).prod['7891234567890'].lotes[0].em_area_vendas, false, 'a escolha permanece no registro local');

  await a.p.click('nav button[data-v="pere"]'); await a.p.click('#subPere button[data-s="reg"]');
  await a.p.fill('#tCodBal', '6019'); await a.p.click('#bBuscarBal');
  await a.p.fill('#peDesc', 'Pernil'); await a.p.fill('#peSif', 'SIF-1'); await a.p.fill('#pePeso', '0.650'); await a.p.fill('#peVal', '2026-12-18'); await a.p.selectOption('#peSetor', 'Açougue');
  assert.strictEqual(await a.p.isChecked('#peEmAreaVendas'), true);
  await a.p.click('#bSalvarPe');
  await a.p.waitForFunction(() => { const d=JSON.parse(localStorage.getItem('validade_dados')); return d.pere.regs.length===1; });
  assert.strictEqual(chamadas.perecivel.p_setor, 'Açougue');
  assert.strictEqual(chamadas.perecivel.p_em_area_vendas, true, 'Área de Vendas é enviada na RPC de perecíveis');
  assert.strictEqual(chamadas.perecivel.p_cod, '6019');
  assert.strictEqual((await a.salvo()).pere.regs[0].created_by_nome, 'Jonatas');
  assert.strictEqual((await a.salvo()).pere.regs[0].em_area_vendas, true);

  await a.p.context().setOffline(true);
  await a.p.click('nav button[data-v="home"]'); await a.p.click('#homeRegister'); await a.p.click('#bTipoIndustrial');
  await a.p.fill('#tCodigo', '7891234567890'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Arroz');
  await a.p.fill('#pLote', 'L-OFFLINE'); await a.p.fill('#pQtd', '1'); await a.p.fill('#pVal', '2026-12-21'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.uncheck('#pEmAreaVendas'); falharLote = true; await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => { const d=JSON.parse(localStorage.getItem('validade_dados')||'{}'),q=JSON.parse(localStorage.getItem('validade_sync')||'{}').filaRegistros||[]; return !!(d.prod['7891234567890']&&d.prod['7891234567890'].lotes.some(x=>x.lote==='L-OFFLINE'))&&q.some(x=>x.payload&&x.payload.p_lote==='L-OFFLINE'&&x.payload.p_em_area_vendas===false); });
  let dadosOffline = await a.salvo(); const loteOffline = dadosOffline.prod['7891234567890'].lotes.find(x => x.lote === 'L-OFFLINE');
  assert.strictEqual(loteOffline.em_area_vendas, false, 'a gravação offline retém Depósito');
  await a.p.click('nav button[data-v="prod"]'); await a.p.click(`#listaProd [data-edit-lote="${loteOffline.id}"]`);
  assert.strictEqual(await a.p.isChecked('#edEmAreaVendas'), false, 'a edição carrega a localização pendente');
  await a.p.check('#edEmAreaVendas'); await a.p.click('#bEditSave');
  await a.p.waitForFunction(() => { const q=JSON.parse(localStorage.getItem('validade_sync')||'{}').filaRegistros||[]; return q.some(x=>x.payload&&x.payload.p_lote==='L-OFFLINE'&&x.payload.p_em_area_vendas===true); });
  assert.strictEqual((await a.salvo()).prod['7891234567890'].lotes.find(x => x.lote === 'L-OFFLINE').em_area_vendas, true, 'editar offline atualiza também o payload da fila');
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
  assert.strictEqual(await a.p.isVisible('#homeRegister'), true);
  await a.p.click('#homeRegister');
  assert.strictEqual(await a.p.isVisible('#bTipoIndustrial'), true);
  await a.fechar();
});

tflaky('papel operador: Registrar visível; códigos (cadastro) escondido', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'operador'));
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).papel === 'operador'; } catch (e) { return false; } });
  assert.strictEqual(await a.p.isVisible('#homeRegister'), true);
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

tflaky('papel admin remoto substitui sessão antiga de Operador e restaura a central administrativa', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'admin'), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'admin' });
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_sessao')).papel === 'admin'; } catch (e) { return false; } });
  assert.strictEqual(await a.p.isVisible('#homeRegister'), true, 'permissões atualizadas de admin permitem registrar');
  assert.strictEqual(await a.p.textContent('#homeStore'), 'Administrador · Loja Teste', 'home deve atualizar o papel exibido');
  assert.strictEqual(await a.p.locator('#operatorRolePill').textContent(), 'Área do Administrador', 'cabeçalho deve refletir o papel confirmado');
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual((await a.p.textContent('#slogan')).trim(), 'Área do Administrador', 'o subtítulo de Ajustes acompanha o papel admin');
  assert.strictEqual(await a.p.textContent('#sysMenuTitle'), 'Ajustes do Sistema');
  assert.strictEqual(await a.p.isVisible('#sysMenu [data-sys-open="lojas"]'), true, 'admin recupera administração de lojas');
  assert.strictEqual(await a.p.isVisible('#sysMenu [data-sys-open="catalogo"]'), true, 'admin recupera administração do catálogo');
  assert.strictEqual(await a.p.isVisible('#sysMenu [data-sys-open="auditoria"]'), true, 'admin recupera auditoria');
  assert.strictEqual(await a.p.isVisible('#sysMenu [data-sys-open="op-preferencias"]'), false, 'menu exclusivo de Operador não aparece para admin');
  assert.deepStrictEqual(a.erros, []);
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

tflaky('gestão de usuários: admin redefine a senha e pode exigir troca no próximo acesso', { skip: pular }, async () => {
  let payloadEditar=null;
  const a=await abrirLogado(async p=>{
    await rotasBase(p,'admin');
    await p.route(/\/functions\/v1\/gerir-usuarios/,async r=>{
      let body={};try{body=r.request().postDataJSON();}catch(e){}
      if(body.acao==='listar')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({usuarios:[{id:'u2',usuario:'maria',nome:'Maria Silva',papel:'operador',lojas:[{id:'L1',nome:'Loja Teste'}]}],lojas:[{id:'L1',nome:'Loja Teste'}],euPapel:'admin'})});
      if(body.acao==='editar'){payloadEditar=body;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});}
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    });
  });
  await a.p.waitForFunction(()=>document.getElementById('cardUsuarios').style.display!=='none');
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  await a.p.waitForSelector('.uEdit');
  await a.p.click('.uEdit');
  await a.p.waitForSelector('#modalEditarUsuario.on');
  await a.p.fill('#editarSenha','NovaSenha2026!');
  await a.p.check('#editarExigirTroca');
  await a.p.click('#salvarEditarUsuario');
  await a.p.waitForFunction(()=>!document.getElementById('modalEditarUsuario').classList.contains('on'));
  assert.ok(payloadEditar,'enviou editar ao endpoint');
  assert.strictEqual(payloadEditar.id,'u2');
  assert.strictEqual(payloadEditar.senha,'NovaSenha2026!');
  assert.strictEqual(payloadEditar.exigir_troca_senha,true);
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
  await a.p.click('#sysMenu [data-sys-open="op-preferencias"]');
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

tflaky('Registrar: abre com Industrializado selecionado e alterna para Perecível na mesma tela', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: {}, cat: {}, pere: { itens: {}, regs: [] } } });
  await a.p.click('#homeRegister');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Registrar Produto');
  assert.strictEqual(await a.p.getAttribute('#bTipoIndustrial', 'aria-pressed'), 'true');
  assert.strictEqual(await a.p.isVisible('#bEscanear'), true);
  assert.strictEqual(await a.p.isVisible('#pe-reg'), false);
  await a.p.click('#bTipoPerecivel');
  assert.strictEqual(await a.p.getAttribute('#bTipoPerecivel', 'aria-pressed'), 'true');
  assert.strictEqual(await a.p.getAttribute('#bTipoIndustrial', 'aria-pressed'), 'false');
  assert.strictEqual(await a.p.isVisible('#bEscanearBal'), true);
  assert.strictEqual(await a.p.isVisible('#bLerEtiqueta'), true);
  assert.strictEqual(await a.p.isVisible('#bEscanear'), false);
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Registrar Produto');
  assert.strictEqual(await a.p.isVisible('#v-reg'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Registrar: − / + ajustam a quantidade sem ficar abaixo de 1', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: {}, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } } });
  await a.p.click('#homeRegister'); await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });
  await a.p.click('#pQtdMais'); await a.p.click('#pQtdMais');
  assert.strictEqual(await a.p.inputValue('#pQtd'), '2');
  await a.p.click('#pQtdMenos'); await a.p.click('#pQtdMenos'); await a.p.click('#pQtdMenos');
  assert.strictEqual(await a.p.inputValue('#pQtd'), '1');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Registrar: confirmação só aparece depois da resposta do Supabase e oferece as duas saídas', { skip: pular }, async () => {
  let liberar; const espera = new Promise(r => { liberar = r; });
  const a = await abrirRegistro(async p => {
    await rotasRegistro(p);
    await p.route(/\/rest\/v1\/rpc\/registrar_lote$/, async r => { await espera; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_by: 'u1', created_by_nome: 'Teste', criado: Date.now() }) }); });
  }, { prod: {}, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } });
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Café');
  await a.p.fill('#pLote', 'l5'); await a.p.fill('#pQtd', '3'); await a.p.fill('#pVal', '2031-02-01'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForFunction(() => document.getElementById('bSalvarLote').disabled);
  assert.strictEqual(await a.p.isVisible('#regSucesso'), false, 'sem confirmação antes do servidor responder');
  liberar();
  await a.p.waitForSelector('#regSucesso', { state: 'visible' });
  assert.strictEqual(await a.p.textContent('#regSucessoTitulo'), 'Registro concluído');
  assert.ok((await a.p.textContent('#regSucesso')).includes('Café'));
  assert.strictEqual(await a.p.isVisible('#cardRegScan'), false, 'não volta sozinho ao leitor');
  await a.p.click('#bNovoRegistro');
  assert.strictEqual(await a.p.isVisible('#regSucesso'), false);
  assert.strictEqual(await a.p.isVisible('#bEscanear'), true);
  assert.strictEqual(await a.p.inputValue('#pLote'), '');
  await a.fechar();
});

tflaky('Registrar: sem rede a confirmação avisa que está pendente de sincronização', { skip: pular }, async () => {
  const net = { online: false };
  const a = await abrirRegistro(p => rotasRede(p, net), { prod: { '7891000315507': { nome: 'Café', lotes: [] } }, cat: {}, pere: { itens: {}, regs: [] } });
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.waitForFunction(() => document.getElementById('pNome').value === 'Café');
  await a.p.fill('#pLote', 'l9'); await a.p.fill('#pQtd', '2'); await a.p.fill('#pVal', '2031-01-01'); await a.p.selectOption('#pSetor', 'Mercearia');
  await a.p.click('#bSalvarLote');
  await a.p.waitForSelector('#regSucesso', { state: 'visible' });
  assert.strictEqual(await a.p.textContent('#regSucessoTitulo'), 'Salvo no aparelho');
  assert.match(await a.p.textContent('#regSucesso'), /sincroniz/i);
  await a.p.click('#bVerRegistros');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Meus Registros');
  await a.fechar();
});

tflaky('Ler Etiqueta: mostra os dados lidos e só preenche o formulário ao tocar em Usar dados', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: {}, cat: {}, pere: { itens: { '6019': { desc: 'Acém Bovino', sif: 'B12345' } }, regs: [] }, aj: { dig: 4, valor: 'peso', dias: 30 } },
    antes: p => p.addInitScript(() => { window.BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: '2601900012504', format: 'ean_13' }]); } }; }) });
  await a.p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await a.p.click('#homeRegister'); await a.p.click('#bTipoPerecivel'); await a.p.click('#bLerEtiqueta');
  const png = path.join(os.tmpdir(), 'validade-teste.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await a.p.setInputFiles('#fFoto', png);
  await a.p.waitForSelector('#etqConfirm', { state: 'visible' });
  const lido = await a.p.textContent('#etqConfirm');
  assert.ok(lido.includes('Acém Bovino') && lido.includes('1,250 kg'), lido);
  assert.strictEqual(await a.p.isVisible('#cardPe'), false, 'formulário não é preenchido antes da confirmação');
  await a.p.click('#bEtqUsar');
  await a.p.waitForSelector('#cardPe', { state: 'visible' });
  assert.strictEqual(await a.p.inputValue('#pePeso'), '1.250');
  assert.strictEqual(await a.p.inputValue('#peDesc'), 'Acém Bovino');
  assert.strictEqual(await a.p.isVisible('#etqConfirm'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Alertas: contadores e filtros refletem os registros; o cartão abre o detalhe com aviso de vencido', { skip: pular }, async () => {
  const dia = n => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const a = await abrir({ dados: {
    prod: { '7891000315507': { lotes: [{ id: 'v1', lote: 'LV', qtd: 2, val: dia(-3), setor: 'Mercearia' }, { id: 'p1', lote: 'LP', qtd: 4, val: dia(5), setor: 'Mercearia' }, { id: 'ok1', lote: 'LOK', qtd: 1, val: dia(200), setor: 'Mercearia' }] } },
    cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: { '12': { desc: 'Picanha' } }, regs: [{ id: 'r1', cod: '12', sif: 'S1', peso: 1.25, val: dia(-1), setor: 'Açougue' }] } } });
  await a.p.click('nav button[data-v="alertas"]');
  assert.deepStrictEqual([await a.p.textContent('#alertCountVenc'), await a.p.textContent('#alertCountProx'), await a.p.textContent('#alertCountPend')], ['2', '1', '0']);
  assert.strictEqual(await a.p.locator('#listaAlertasValidade .alert-card').count(), 3, 'válido distante não entra');
  await a.p.click('#alertFilters [data-alert-filter="soon"]');
  assert.strictEqual(await a.p.locator('#listaAlertasValidade .alert-card').count(), 1);
  assert.ok((await a.p.textContent('#listaAlertasValidade')).includes('LP'));
  await a.p.click('#alertFilters [data-alert-filter="expired"]');
  assert.strictEqual(await a.p.locator('#listaAlertasValidade .alert-card').count(), 2);
  await a.p.click('#listaAlertasValidade .alert-card[data-detail-lote="v1"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Detalhe do registro');
  assert.strictEqual((await a.p.textContent('#detailStatus')).trim(), 'Vencido');
  assert.strictEqual(await a.p.isVisible('#detailWarning'), true);
  await a.p.click('#bDetailHistory');
  assert.strictEqual(await a.p.locator('#detailHistoryList [data-detail-lote]').count(), 2, 'histórico lista os outros registros do produto');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Detalhe de registro válido não mostra aviso; Editar tem cabeçalho do produto e − / +', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [lote('l1', '2032-12-01', 5, 'L1')] } }, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } } });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]');
  assert.strictEqual(await a.p.isVisible('#detailWarning'), false);
  assert.strictEqual((await a.p.textContent('#detailStatus')).trim(), 'Válido');
  await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.textContent('#editProductName'), 'Café');
  await a.p.click('#edQtdMais'); assert.strictEqual(await a.p.inputValue('#edQtd'), '6');
  await a.p.click('#edQtdMenos'); await a.p.click('#edQtdMenos'); assert.strictEqual(await a.p.inputValue('#edQtd'), '4');
  await a.p.selectOption('#edSetor', 'Mercearia'); await a.p.click('#bEditSave');
  assert.strictEqual((await a.salvo()).prod['7891000315507'].lotes[0].qtd, 4);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Registrar: tocar num lote já registrado do produto abre o detalhe', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [lote('l1', '2032-12-01', 5, 'L1')] } }, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } } });
  await a.p.click('#homeRegister'); await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar');
  await a.p.click('#pLotes [data-id="l1"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Detalhe do registro');
  await a.fechar();
});

tflaky('Meus Registros: cartão não repete o setor, mostra validade e selo, e pagina de 8 em 8', { skip: pular }, async () => {
  const lotes = []; for (let i = 1; i <= 10; i++) lotes.push({ id: 'l' + i, lote: 'L' + String(i).padStart(2, '0'), qtd: i, val: '2032-01-' + String(i).padStart(2, '0'), setor: 'Laticínios', created_by_nome: 'William' });
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes } }, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } } });
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.locator('#listaProd .operator-record').count(), 8);
  const cartao = await a.p.textContent('#listaProd .operator-record >> nth=0');
  assert.strictEqual(cartao.split('Laticínios').length - 1, 1, 'setor aparece uma vez só: ' + cartao);
  assert.ok(cartao.includes('informado por William') && cartao.includes('01/01/2032') && cartao.includes('Válido'), cartao);
  assert.strictEqual((await a.p.textContent('#pagerProd')).replace(/\s+/g, ' ').includes('Página 1 de 2'), true);
  await a.p.click('#pagerProd [data-page="1"]');
  assert.strictEqual(await a.p.locator('#listaProd .operator-record').count(), 2);
  await a.p.fill('#qProd', 'L03');
  assert.strictEqual(await a.p.locator('#listaProd .operator-record').count(), 1, 'buscar volta para a primeira página');
  assert.strictEqual(await a.p.isVisible('#pagerProd'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Cabeçalho: subtítulo próprio em cada tela interna; contador de alertas fica sobre o sino', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [lote('v', new Date(Date.now() - 86400000).toISOString().slice(0, 10), 1, 'L1')] } }, cat: {}, pere: { itens: {}, regs: [] } } });
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.textContent('#slogan'), 'Produtos (Industrializados)');
  await a.p.click('nav button[data-v="pere"]');
  assert.strictEqual(await a.p.textContent('#slogan'), 'Produtos perecíveis da loja');
  const pos = await a.p.evaluate(() => { const b = document.getElementById('alertBadge').getBoundingClientRect(), i = document.querySelector('#abas [data-v="alertas"] svg').getBoundingClientRect(); return { visivel: b.width > 0, acima: b.top < i.top + i.height / 2, direita: b.left > i.left + i.width / 2 - 2 }; });
  assert.deepStrictEqual(pos, { visivel: true, acima: true, direita: true });
  await a.fechar();
});

tflaky('Configurações: dados reais, preferências persistem e Sobre mostra a versão; voltar retorna a Configurações', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'operador'), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Jonatas', lojaNome: 'Filial 31' });
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual(await a.p.textContent('#sysMenuTitle'), 'Ajustes do Operador');
  assert.strictEqual(await a.p.locator('#sysMenu [data-sys-open]').count(), 4);
  await a.p.click('#sysMenu [data-sys-open="op-preferencias"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Preferências');
  assert.strictEqual(await a.p.isVisible('#aCosmos'), true, 'token pessoal continua disponível ao Operador');
  assert.strictEqual(await a.p.isVisible('#aDias'), false, 'alertas de validade ficam na seção Alertas e Notificações');
  assert.strictEqual(await a.p.isVisible('#cardUsuarios'), false, 'gestão de usuários não aparece ao Operador');
  assert.strictEqual(await a.p.isVisible('#cardLojasAdmin'), false, 'gestão de lojas não aparece ao Operador');
  assert.strictEqual(await a.p.isVisible('#bExp'), false, 'backup administrativo não aparece ao Operador');
  assert.strictEqual(await a.p.textContent('#cfgLoja'), 'Filial 31');
  // o nome exibido é o do perfil devolvido pelo servidor (rotasBase responde nome = papel)
  await a.p.waitForFunction(() => document.getElementById('cfgOperador').textContent === 'operador');
  const versao = 'v' + require('../package.json').version;
  assert.strictEqual(await a.p.textContent('#cfgVersao'), versao);
  assert.strictEqual(await a.p.isChecked('#aVibra'), true);
  await a.p.uncheck('#aVibra'); await a.p.uncheck('#aSom');
  assert.deepStrictEqual(await a.p.evaluate(() => { const d = JSON.parse(localStorage.getItem('validade_dados')).aj; return [d.vibra, d.som]; }), [false, false]);
  assert.strictEqual(await a.p.isVisible('#preferencesArea'), true, 'ajustes técnicos continuam acessíveis');
  await a.p.click('#cfgSobre');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Sobre o Sistema');
  assert.strictEqual(await a.p.textContent('#aboutVersao'), versao);
  assert.strictEqual(await a.p.isVisible('#settingsRefArea'), false);
  await a.p.click('#headerBack');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Ajustes do Operador');
  assert.strictEqual(await a.p.isVisible('#settingsRefArea'), false);
  await a.p.click('#sysMenu [data-sys-open="op-perfil"]');
  assert.strictEqual((await a.p.textContent('#profileStatus')).trim(), 'Operador Ativo');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Alterar Senha (função antiga no servidor): confere a senha atual e grava pelo Auth', { skip: pular }, async () => {
  const chamadas = { token: [], user: [] }; let senhaCerta = false;
  const a = await abrirLogado(async p => { await rotasBase(p, 'operador');
    await p.route('**/functions/v1/gerir-usuarios', r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Ação desconhecida.' }) }));
    await p.route('**/auth/v1/token?grant_type=password', r => { chamadas.token.push(r.request().postDataJSON()); senhaCerta
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok2', refresh_token: 'ref2', expires_in: 3600, user: { id: 'u1', email: 'teste@loja.validade' } }) })
      : r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error_description: 'Invalid login credentials' }) }); });
    await p.route('**/auth/v1/user', r => { chamadas.user.push({ m: r.request().method(), b: r.request().postDataJSON(), auth: r.request().headers().authorization }); r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' }); });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador' });
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-preferencias"]'); await a.p.click('#cfgSenha');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Alterar Senha');
  await a.p.fill('#pwAtual', 'antiga1'); await a.p.fill('#pwNova', 'nova123'); await a.p.fill('#pwConfirma', 'outra123'); await a.p.click('#bPwSalvar');
  assert.match(await a.p.textContent('#pwErro'), /não conferem/);
  await a.p.fill('#pwConfirma', 'nova123'); await a.p.fill('#pwNova', 'abc'); await a.p.click('#bPwSalvar');
  assert.match(await a.p.textContent('#pwErro'), /6 caracteres/);
  assert.strictEqual(chamadas.token.length, 0, 'nada vai ao servidor enquanto o formulário é inválido');
  await a.p.fill('#pwNova', 'nova123'); await a.p.click('#bPwSalvar');
  await a.p.waitForFunction(() => /senha atual/i.test(document.getElementById('pwErro').textContent));
  assert.strictEqual(chamadas.user.length, 0, 'senha atual errada não altera nada');
  senhaCerta = true; await a.p.click('#bPwSalvar');
  await a.p.waitForFunction(() => document.getElementById('screenTitle').textContent === 'Ajustes do Operador');
  assert.deepStrictEqual(chamadas.token[1], { email: 'teste@loja.validade', password: 'antiga1' });
  assert.deepStrictEqual([chamadas.user[0].m, chamadas.user[0].b, chamadas.user[0].auth], ['PUT', { password: 'nova123' }, 'Bearer tok2']);
  assert.strictEqual(await a.p.inputValue('#pwNova'), '', 'campos limpos depois de salvar');
  await a.fechar();
});

tflaky('Buscar Produto: procura em industrializados e perecíveis e filtra por tipo', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [lote('l1', '2032-12-01', 5, 'LX9')] } }, cat: { '7891000315507': { nome: 'Café Bom' } },
    pere: { itens: { '12': { desc: 'Queijo Bom' } }, regs: [{ id: 'r1', cod: '12', sif: 'S7', peso: 1.25, val: '2032-12-01', setor: 'Laticínios' }] } } });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('#bAbrirBusca');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Buscar Produto');
  await a.p.fill('#qBusca', 'bom');
  assert.strictEqual(await a.p.locator('#buscaResultados .busca-card').count(), 2);
  await a.p.click('#buscaFiltros [data-busca="pere"]');
  assert.strictEqual(await a.p.locator('#buscaResultados .busca-card').count(), 1);
  assert.ok((await a.p.textContent('#buscaResultados')).includes('Queijo Bom'));
  await a.p.click('#buscaFiltros [data-busca="all"]'); await a.p.fill('#qBusca', 'LX9');
  await a.p.click('#buscaResultados .busca-card');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Detalhe do registro');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Leitor: título conforme o modo, Trocar câmera alterna a câmera pedida e Ler da galeria lê o código', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: {}, cat: { '7891000315507': { nome: 'Café' } }, pere: { itens: {}, regs: [] } }, antes: p => p.addInitScript(() => {
    window.__cams = []; const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = c => { window.__cams.push(c.video.facingMode); return Promise.reject(Object.assign(new Error('sem câmera'), { name: 'NotFoundError' })); };
    window.BarcodeDetector = class { detect() { return Promise.resolve([{ rawValue: '7891000315507', format: 'ean_13' }]); } }; }) });
  await a.p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await a.p.click('#homeRegister'); await a.p.click('#bTipoPerecivel'); await a.p.click('#bLerEtiqueta');
  assert.strictEqual(await a.p.textContent('#scanTitulo'), 'Ler Etiqueta – Perecível');
  await a.p.click('#bFechar');
  assert.strictEqual(await a.p.isVisible('#scanner'), false);
  await a.p.click('#bTipoIndustrial'); await a.p.click('#bEscanear');
  assert.strictEqual(await a.p.textContent('#scanTitulo'), 'Escanear código de barras');
  await a.p.click('#bTrocarCam');
  await a.p.waitForFunction(() => window.__cams.length >= 3);
  assert.deepStrictEqual(await a.p.evaluate(() => window.__cams.slice(-2)), ['environment', 'user']);
  const png = path.join(os.tmpdir(), 'validade-teste.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await a.p.setInputFiles('#fGaleria', png);
  await a.p.waitForFunction(() => document.getElementById('pEan').textContent === '7891000315507');
  assert.strictEqual(await a.p.isVisible('#scanner'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Alterar Senha: usa a função do servidor e mostra o motivo quando ela recusa', { skip: pular }, async () => {
  const chamadas = []; let resposta = { status: 400, body: { error: 'Essa senha é muito comum. Escolha outra.' } }; let nativo = 0;
  const a = await abrirLogado(async p => { await rotasBase(p, 'operador');
    await p.route('**/functions/v1/gerir-usuarios', r => { chamadas.push(r.request().postDataJSON()); r.fulfill({ status: resposta.status, contentType: 'application/json', body: JSON.stringify(resposta.body) }); });
    await p.route('**/auth/v1/user', r => { nativo++; r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador' });
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-preferencias"]'); await a.p.click('#cfgSenha');
  await a.p.fill('#pwAtual', 'antiga1'); await a.p.fill('#pwNova', 'guanabara'); await a.p.fill('#pwConfirma', 'guanabara'); await a.p.click('#bPwSalvar');
  await a.p.waitForFunction(() => /muito comum/.test(document.getElementById('pwErro').textContent));
  assert.deepStrictEqual(chamadas[0], { acao: 'trocar_senha', senha_atual: 'antiga1', senha: 'guanabara' });
  resposta = { status: 200, body: { ok: true } };
  await a.p.fill('#pwNova', 'nova1234'); await a.p.fill('#pwConfirma', 'nova1234'); await a.p.click('#bPwSalvar');
  await a.p.waitForFunction(() => document.getElementById('screenTitle').textContent === 'Ajustes do Operador');
  assert.strictEqual(nativo, 0, 'com a função publicada, não usa o caminho direto do Auth');
  await a.fechar();
});

tflaky('Notificações: Limpar marca as do usuário como removidas; sem a coluna no servidor o botão some', { skip: pular }, async () => {
  const patches = []; let comColuna = true; const linhas = [{ id: 'n1', tipo: 'validade', titulo: 'Produto vencido', mensagem: 'Café', payload: {}, criado: '2026-11-09T10:00:00Z', lida_em: null }];
  const a = await abrirLogado(async p => { await rotasBase(p, 'operador');
    await p.route(/\/rest\/v1\/notificacoes/, r => { const u = r.request().url();
      if (r.request().method() === 'PATCH') { patches.push({ u, b: r.request().postDataJSON() }); linhas.length = 0; return r.fulfill({ status: 204, body: '' }); }
      if (u.includes('removida_em') && !comColuna) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'column notificacoes.removida_em does not exist' }) });
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(linhas) }); });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador' });
  a.respostas.push(true);
  await a.p.click('nav button[data-v="alertas"]'); await a.p.click('[data-alert-view="notifications"]');
  await a.p.waitForFunction(() => document.getElementById('listaNotificacoes').textContent.includes('Produto vencido'));
  await a.p.click('#bLimparNotificacoes');
  await a.p.waitForFunction(() => !document.getElementById('listaNotificacoes').textContent.includes('Produto vencido'));
  assert.ok(patches[0].u.includes('id=in.(n1)'), patches[0].u); // sem filtro de loja: alertas personalizados podem estar em outra loja do usuário; a RLS restringe ao dono
  assert.deepStrictEqual(Object.keys(patches[0].b), ['removida_em']);
  comColuna = false; linhas.push({ id: 'n2', tipo: 'validade', titulo: 'Outro aviso', mensagem: 'x', payload: {}, criado: '2026-11-09T11:00:00Z', lida_em: null });
  await a.p.click('#bAtualizarNotificacoes');
  await a.p.waitForFunction(() => document.getElementById('listaNotificacoes').textContent.includes('Outro aviso'));
  assert.strictEqual(await a.p.isVisible('#bLimparNotificacoes'), false);
  await a.fechar();
});

tflaky('Perfil: "Sair de todos os aparelhos" encerra as sessões no servidor e volta ao login', { skip: pular }, async () => {
  const saidas = [];
  const a = await abrirLogado(async p => { await rotasBase(p, 'operador');
    await p.route('**/auth/v1/logout**', r => { saidas.push(r.request().url()); r.fulfill({ status: 204, body: '' }); });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador' });
  a.respostas.push(true);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-perfil"]'); await a.p.click('#profileSessions');
  await a.p.waitForSelector('#conta-login', { state: 'visible' });
  assert.ok(saidas.some(u => u.includes('scope=global')), JSON.stringify(saidas));
  assert.strictEqual(await a.p.evaluate(() => localStorage.getItem('validade_sessao')), null);
  await a.fechar();
});

tflaky('tela estreita (360 px): campos de quantidade continuam largos o bastante e os botões de Editar não quebram', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [Object.assign(lote('l1', '2032-12-01', 12, 'L1'), { setor: 'Açougue' })] } }, cat: { '7891000315507': { nome: 'Barriga suína defumada' } }, pere: { itens: {}, regs: [] } } });
  await a.p.setViewportSize({ width: 360, height: 760 });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-edit-lote="l1"]');
  const ed = await a.p.evaluate(() => { const q = document.getElementById('edQtd').getBoundingClientRect(), s = document.getElementById('bEditSave'), c = document.getElementById('bEditCancel');
    return { largura: Math.round(q.width), salvarUmaLinha: s.getBoundingClientRect().height <= 60, cancelarUmaLinha: c.getBoundingClientRect().height <= 60, semRolagemLateral: document.documentElement.scrollWidth <= window.innerWidth }; });
  assert.ok(ed.largura >= 72, 'campo de quantidade em Editar com ' + ed.largura + ' px');
  assert.deepStrictEqual([ed.salvarUmaLinha, ed.cancelarUmaLinha, ed.semRolagemLateral], [true, true, true]);
  assert.strictEqual(await a.p.inputValue('#edQtd'), '12');
  await a.p.click('#bEditCancel'); await a.p.click('nav button[data-v="home"]'); await a.p.click('#homeRegister');
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar'); await a.p.waitForSelector('#cardProd', { state: 'visible' });
  const reg = await a.p.evaluate(() => Math.round(document.getElementById('pQtd').getBoundingClientRect().width));
  assert.ok(reg >= 48, 'campo de quantidade em Registrar com ' + reg + ' px');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('tela estreita (360 px): leitor, notificações, nome longo e áreas de toque cabem na tela', { skip: pular }, async () => {
  const nomeLongo = 'Barriga suína defumada La Tocineta fatiada 500g';
  const a = await abrir({ dados: { prod: { '7891000315507': { lotes: [Object.assign(lote('l1', '2032-12-01', 12, 'L1'), { setor: 'Açougue' })] } }, cat: { '7891000315507': { nome: nomeLongo } }, pere: { itens: {}, regs: [] } },
    antes: p => p.addInitScript(() => { const md = navigator.mediaDevices || (navigator.mediaDevices = {}); md.getUserMedia = () => Promise.reject(Object.assign(new Error('sem câmera'), { name: 'NotFoundError' })); }) });
  await a.p.setViewportSize({ width: 360, height: 760 });
  const foraDaTela = sel => a.p.evaluate(s => [...document.querySelectorAll(s)].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(e => e.id || e.textContent.trim().slice(0, 20)), sel);
  const caixa = sel => a.p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
  const verTudo = await caixa('#homeSeeAll'); assert.ok(verTudo.h >= 40, 'Ver todos com ' + verTudo.h + ' px de altura');
  await a.p.click('#homeRegister');
  const voltar = await caixa('#headerBack'); assert.ok(voltar.w >= 40 && voltar.h >= 40, 'voltar com ' + voltar.w + 'x' + voltar.h);
  await a.p.fill('#tCodigo', '7891000315507'); await a.p.click('#bBuscar'); await a.p.waitForSelector('#cardProd', { state: 'visible' });
  assert.strictEqual(await a.p.inputValue('#pNome'), nomeLongo);
  assert.strictEqual(await a.p.evaluate(() => { const e = document.getElementById('pNome'); return e.scrollWidth <= e.clientWidth + 2 && e.scrollHeight <= e.clientHeight + 2; }), true, 'nome longo aparece inteiro');
  await a.p.click('#bEscanear');
  assert.deepStrictEqual(await foraDaTela('#scanner *'), []);
  await a.p.click('#bFechar');
  await a.p.click('nav button[data-v="prod"]');
  const seta = await caixa('#listaProd .operator-record-actions button:last-child'); assert.ok(seta.w >= 30 && seta.h >= 30, 'seta do cartão com ' + seta.w + 'x' + seta.h);
  await a.p.click('nav button[data-v="alertas"]'); await a.p.click('[data-alert-view="notifications"]');
  assert.deepStrictEqual(await a.p.evaluate(() => [...document.querySelectorAll('#notificationTabs button')].filter(b => b.scrollWidth > b.clientWidth + 2).map(b => b.textContent.trim())), [], 'abas sem texto cortado');
  for (const id of ['#bLerNotificacoes', '#bAtualizarNotificacoes']) { const c = await caixa(id); assert.ok(c.h <= 60, id + ' em uma linha (' + c.h + ' px)'); }
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Catálogo: operador não vê produtos sem registro nem a entrada do catálogo, e não abre a tela', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'operador'), { prod: { '7891000315507': { lotes: [] }, '7896040703727': { lotes: [lote('l1', '2032-12-01', 5, 'L1')] } },
    cat: { '7891000315507': { nome: 'Café Sem Registro' }, '7896040703727': { nome: 'Limpador Com Registro' } }, pere: { itens: {}, regs: [] } }, { papel: 'operador' });
  await a.p.click('nav button[data-v="prod"]');
  const lista = await a.p.textContent('#listaProd');
  assert.ok(lista.includes('Limpador Com Registro') && !lista.includes('Café Sem Registro'), lista);
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual(await a.p.isVisible('#cfgCatalogo'), false);
  // mesmo forçando o clique no botão oculto, a tela não abre para o operador
  await a.p.evaluate(() => document.getElementById('cfgCatalogo').click());
  assert.strictEqual(await a.p.isVisible('#v-catalogo'), false);
  assert.notStrictEqual(await a.p.textContent('#screenTitle'), 'Catálogo de Produtos');
  await a.fechar();
});

tflaky('Catálogo: administrador abre por Configurações, vê todos os produtos, filtra e registra a partir do cartão', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, 'admin'), { prod: { '7891000315507': { lotes: [] }, '7896040703727': { lotes: [lote('l1', '2032-12-01', 5, 'L1'), lote('l2', '2032-12-02', 5, 'L2')] } },
    cat: { '7891000315507': { nome: 'Café Sem Registro', marca: 'Marca A' }, '7896040703727': { nome: 'Limpador Com Registro' }, '7890000000017': { nome: 'Só no Catálogo' } }, pere: { itens: {}, regs: [] } }, { papel: 'admin' });
  await a.p.click('nav button[data-v="prod"]');
  assert.ok(!(await a.p.textContent('#listaProd')).includes('Café Sem Registro'), 'Meus Registros não mistura catálogo');
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="catalogo"]');
  else await a.p.click('#cfgCatalogo');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Catálogo de Produtos');
  assert.deepStrictEqual([await a.p.textContent('#tCatTotal'), await a.p.textContent('#tCatCom'), await a.p.textContent('#tCatSem')], ['3', '1', '2']);
  const txt = await a.p.textContent('#listaCatalogo');
  assert.ok(txt.includes('Café Sem Registro') && txt.includes('Marca A') && txt.includes('Só no Catálogo') && txt.includes('2 registros nesta loja'), txt);
  await a.p.click('#catalogoFiltros [data-cat-filter="with"]');
  assert.strictEqual(await a.p.locator('#listaCatalogo .catalog-card').count(), 1);
  await a.p.click('#catalogoFiltros [data-cat-filter="all"]'); await a.p.fill('#qCatalogo', '7891000315507');
  assert.strictEqual(await a.p.locator('#listaCatalogo .catalog-card').count(), 1);
  await a.p.click('#listaCatalogo [data-register-ean="7891000315507"]');
  await a.p.waitForSelector('#cardProd', { state: 'visible' });
  assert.strictEqual(await a.p.textContent('#pEan'), '7891000315507');
  assert.strictEqual(await a.p.inputValue('#pNome'), 'Café Sem Registro');
  await a.fechar();
});

tflaky('Catálogo: administrador inativa e restaura item global sem apagar registros da loja', { skip: pular }, async () => {
  const ean = '7890000000017', alteracoes = [];
  let item = { ean, nome: 'Produto Global', marca: 'Marca', img: '', updated_at: '2026-11-10T00:00:00Z', deleted_at: null };
  const a = await abrirLogado(async p => {
    await rotasBase(p, 'admin');
    await p.route(/\/rest\/v1\/catalogo(?:\?|$)/, r => {
      const u = new URL(r.request().url()), method = r.request().method();
      if (method === 'GET') {
        const filtraAtivo = u.searchParams.get('deleted_at') === 'is.null';
        const filtraInativo = u.searchParams.get('deleted_at') === 'not.is.null';
        const visivel = (!filtraAtivo || !item.deleted_at) && (!filtraInativo || !!item.deleted_at);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(visivel ? [item] : []) });
      }
      if (method === 'PATCH') {
        const body = r.request().postDataJSON();
        alteracoes.push({ body, filtro: u.searchParams.get('deleted_at') });
        item = Object.assign({}, item, body, { updated_at: new Date().toISOString() });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([item]) });
      }
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin' });
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_dados')).cat['7890000000017']; } catch (e) { return false; } });
  await a.p.click('nav button[data-v="aj"]');
  if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="catalogo"]');
  else await a.p.click('#cfgCatalogo');
  await a.p.waitForSelector('#listaCatalogo [data-catalogo-inativar="7890000000017"]');
  a.respostas.push(false);
  await a.p.click('#listaCatalogo [data-catalogo-inativar="7890000000017"]');
  assert.strictEqual(alteracoes.length, 0, 'cancelar a confirmação não chama o backend');
  a.respostas.push(true);
  await a.p.click('#listaCatalogo [data-catalogo-inativar="7890000000017"]');
  assert.strictEqual(alteracoes[0].filtro, 'is.null');
  assert.ok(alteracoes[0].body.deleted_at, 'inativação envia tombstone');
  await a.p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_dados')).cat['7890000000017'].deleted_at; } catch (e) { return false; } });
  let dados = await a.salvo();
  assert.ok(dados.cat[ean].deleted_at, 'tombstone persiste no cache local');
  assert.deepStrictEqual(dados.prod, {}, 'os registros por loja não foram apagados');
  await a.p.click('#catalogoFiltros [data-cat-filter="inactive"]');
  await a.p.waitForSelector('#listaCatalogo [data-catalogo-restaurar="7890000000017"]');
  assert.ok((await a.p.textContent('#listaCatalogo')).includes('Inativo global'));
  await a.p.click('#listaCatalogo [data-catalogo-restaurar="7890000000017"]');
  await a.p.waitForFunction(() => { try { return !JSON.parse(localStorage.getItem('validade_dados')).cat['7890000000017'].deleted_at; } catch (e) { return false; } });
  await a.p.click('#catalogoFiltros [data-cat-filter="all"]');
  await a.p.waitForSelector('#listaCatalogo [data-catalogo-inativar="7890000000017"]');
  assert.strictEqual(alteracoes[1].filtro, 'not.is.null');
  assert.strictEqual(alteracoes[1].body.deleted_at, null, 'restauração remove o tombstone');
  dados = await a.salvo();
  assert.ok(!dados.cat[ean].deleted_at, 'restauração também persiste no cache local');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('Push: operador, assistente, analista, gerente e administrador ativam em Configurações', { skip: pular }, async () => {
  for (const papel of ['operador', 'assistente', 'analista', 'gerente', 'admin']) {
    const a = await abrirLogado(async p => { await rotasBase(p, papel);
      await p.addInitScript(() => { Object.defineProperty(window, 'isSecureContext', { value: true });
        Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }) } });
        window.PushManager = function () {}; window.Notification = function () {}; });
    }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel });
    await a.p.click('nav button[data-v="aj"]');
    if (await a.p.isVisible('#sysMenuCard')) await a.p.click('#sysMenu [data-sys-open="' + (papel === 'operador' ? 'op-alertas' : 'alertas') + '"]');
    await a.p.waitForFunction(() => /ainda não ativado/.test(document.getElementById('pushStatus').textContent));
    assert.strictEqual(await a.p.isVisible('#pushCard'), true, papel + ' vê o cartão de push');
    assert.strictEqual(await a.p.isVisible('#bPushAtivar'), true, papel + ' vê o botão Ativar');
    if (papel === 'operador') { await a.p.click('nav button[data-v="alertas"]'); await a.p.click('[data-alert-view="notifications"]'); await a.p.click('#bIrPush');
      assert.strictEqual(await a.p.textContent('#screenTitle'), 'Alertas e Notificações'); assert.strictEqual(await a.p.isVisible('#pushCard'), true); }
    await a.fechar();
  }
});

tflaky('Área do Operador: abas, alertas/notificações e detalhe/edição de lote', { skip: pular }, async () => {
  const a = await abrir({ dados: {
    prod: { '7891000315507': { nome: 'Café', lotes: [lote('l1', '2032-12-01', 5, 'L1')] } },
    cat: {}, pere: { itens: { '12': { desc: 'Picanha' } }, regs: [{ id: 'r1', cod: '12', sif: 'SIF-1', peso: 1.25, val: '2032-12-01', setor: 'Açougue' }] }
  } });
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Meus Registros');
  await a.p.click('[data-detail-lote="l1"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Detalhe do registro');
  await a.p.click('#bDetailEdit');
  await a.p.fill('#edLote', 'L2'); await a.p.fill('#edQtd', '8'); await a.p.selectOption('#edSetor', 'Mercearia'); await a.p.click('#bEditSave');
  const salvo = await a.salvo(), loteEditado = salvo.prod['7891000315507'].lotes[0];
  assert.deepStrictEqual([loteEditado.lote, loteEditado.qtd, loteEditado.setor], ['L2', 8, 'Mercearia']);
  await a.p.click('nav button[data-v="pere"]');
  assert.strictEqual(await a.p.isVisible('#pe-lista'), true);
  assert.strictEqual(await a.p.isVisible('#pe-reg'), false);
  await a.p.click('nav button[data-v="alertas"]');
  assert.strictEqual(await a.p.isVisible('#alertasMain'), true);
  assert.strictEqual(await a.p.isVisible('#cardNotificacoes'), false);
  await a.p.click('nav button[data-v="home"]'); await a.p.click('#homeBell');
  assert.strictEqual(await a.p.isVisible('#cardNotificacoes'), true);
  assert.strictEqual(await a.p.isVisible('#alertasMain'), false);
  await a.p.click('nav button[data-v="aj"]');
  const menu = await a.p.isVisible('#sysMenuCard');
  if (menu) {
    const config = a.p.locator('#sysMenu [data-sys-open="config"]');
    await a.p.click(await config.count() ? '#sysMenu [data-sys-open="config"]' : '#sysMenu [data-sys-open="op-preferencias"]');
  }
  assert.strictEqual(await a.p.isVisible('#preferencesArea'), true);
  assert.strictEqual(await a.p.isVisible('#profileArea'), false);
  if (menu) {
    await a.p.click('#sysBackToMenu');
    const perfil = a.p.locator('#sysMenu [data-sys-open="perfil"]');
    await a.p.click(await perfil.count() ? '#sysMenu [data-sys-open="perfil"]' : '#sysMenu [data-sys-open="op-perfil"]');
  }
  else await a.p.click('#settingsTabs [data-settings-view="profile"]');
  assert.strictEqual(await a.p.isVisible('#profileArea'), true);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

/* Armazenamento do navegador cheio: o app guarda os dados no IndexedDB em vez de só avisar. */
const semEspaco = p => p.addInitScript(() => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'validade_dados' || k === 'validade_sync') throw new DOMException('cheio', 'QuotaExceededError');
    return original.call(this, k, v);
  };
  window.__toasts = [];
  document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('toast');
    if (t) new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
});
const lerIdb = (p, chave) => p.evaluate(k => new Promise(res => {
  const r = indexedDB.open('validade_armazenamento', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => res(null);
  r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => { r.result.close(); res(q.result || null); }; q.onerror = () => { r.result.close(); res(null); }; };
}), chave);

tflaky('armazenamento cheio: a gravação vai para o IndexedDB e volta ao reabrir o app', { skip: pular }, async () => {
  const a = await abrir({ antes: semEspaco });
  await a.p.evaluate(() => { const e = document.getElementById('aDias'); e.value = '45'; e.dispatchEvent(new Event('change')); });
  await a.p.waitForFunction(() => new Promise(res => { const r = indexedDB.open('validade_armazenamento', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onerror = () => res(false);
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('validade_dados'); q.onsuccess = () => { r.result.close(); res(!!q.result); }; }; }));
  assert.strictEqual(JSON.parse(await lerIdb(a.p, 'validade_dados')).aj.dias, 45);
  const avisos = await a.p.evaluate(() => window.__toasts.join('|'));
  assert.ok(!/Não foi possível salvar|Armazenamento cheio/.test(avisos), 'não mostra aviso de falha quando o IndexedDB guardou: ' + avisos);
  await a.p.reload();
  await a.p.waitForFunction(() => document.getElementById('aDias').value === '45');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('armazenamento cheio: a sincronização conclui, atualiza a tela e não repete o aviso', { skip: pular }, async () => {
  const a = await abrirRegistro(async p => {
    await p.route('**/rest/v1/**', async r => {
      const u = new URL(r.request().url()), method = r.request().method();
      let rows = [];
      if (u.pathname === '/rest/v1/perfis') rows = [{ papel: 'operador', nome: 'Teste' }];
      if (method === 'GET' && u.pathname === '/rest/v1/catalogo' && u.searchParams.has('updated_at')) rows = [{ ean: '7891234567890', nome: 'Produto compartilhado', marca: '', img: '', updated_at: '2026-11-07T20:00:00Z' }];
      if (method === 'GET' && u.pathname === '/rest/v1/produtos') rows = [{ ean: '7891234567890', updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      if (method === 'GET' && u.pathname === '/rest/v1/lotes') rows = [{ id: 'lote-w', ean: '7891234567890', lote: 'FL05-W', qtd: 7, val: '2026-12-10', setor: 'Açougue', criado: 1, created_by: 'u1', created_by_nome: 'William', updated_at: '2026-11-07T20:00:00Z', deleted_at: null }];
      return r.fulfill({ status: method === 'GET' ? 200 : 201, contentType: 'application/json', body: JSON.stringify(rows) });
    });
  }, null, semEspaco);
  await a.p.waitForFunction(() => new Promise(res => { const r = indexedDB.open('validade_armazenamento', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onerror = () => res(false);
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('validade_sync'); q.onsuccess = () => { r.result.close(); try { res(!!JSON.parse(q.result || '{}').recebido); } catch (e) { res(false); } }; }; }));
  const dados = JSON.parse(await lerIdb(a.p, 'validade_dados'));
  assert.strictEqual(dados.prod['7891234567890'].lotes[0].lote, 'FL05-W');
  await a.p.click('nav button[data-v="prod"]');
  assert.ok((await a.p.textContent('#listaProd')).includes('Produto compartilhado'));
  const avisos = await a.p.evaluate(() => window.__toasts.join('|'));
  assert.ok(!/Armazenamento cheio|Falha ao gravar|Não foi possível salvar/.test(avisos), 'sem aviso de armazenamento: ' + avisos);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('alertas pessoais: regras multi-horário validam, cacheiam por UID e não dependem do Push', { skip: pular }, async () => {
  const a = await abrirLogado(async p => {
    await p.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
    await p.route(/\/rest\/v1\/perfis/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'operador', nome: 'Teste' }]) }));
    await p.route(/\/rest\/v1\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  }, null, { papel: 'operador' });
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-alertas"]');
  await a.p.fill('#alertaRegraDias', '0'); await a.p.fill('#alertaRegraHora', '08:00'); await a.p.click('#bAlertaRegraAdicionar');
  assert.equal(await a.p.locator('#listaRegrasAlertas .alert-rule').count(), 0, 'dias inválidos são rejeitados');
  for (const [dias, hora, count] of [[30,'08:00',1],[15,'09:00',2],[7,'08:00',3]]) {
    await a.p.fill('#alertaRegraDias', String(dias)); await a.p.fill('#alertaRegraHora', hora); await a.p.click('#bAlertaRegraAdicionar');
    await a.p.waitForFunction(n => document.querySelectorAll('#listaRegrasAlertas .alert-rule').length === n, count);
  }
  const rules = await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_alertas_regras_u1')));
  assert.deepStrictEqual(rules.items.map(x => [x.dias,x.hora_local,x.user_id]).sort((a,b)=>a[0]-b[0]), [[7,'08:00:00','u1'],[15,'09:00:00','u1'],[30,'08:00:00','u1']]);
  assert.ok(rules.items.every(x => x.fuso), 'cada regra guarda o fuso');
  await a.p.fill('#alertaRegraDias','30'); await a.p.fill('#alertaRegraHora','08:00'); await a.p.click('#bAlertaRegraAdicionar');
  assert.equal(await a.p.locator('#listaRegrasAlertas .alert-rule').count(), 3, 'duplicata idêntica não é incluída');
  await a.p.locator('#listaRegrasAlertas [data-regra-toggle]').first().uncheck();
  await a.p.waitForFunction(() => JSON.parse(localStorage.getItem('validade_alertas_regras_u1')).items.some(x => x.ativo === false));
  assert.equal(await a.p.evaluate(() => localStorage.getItem('validade_alertas_regras_u2')), null, 'cache não aparece sob outro UID');
  await a.p.locator('#listaRegrasAlertas [data-regra-delete]').first().click();
  await a.p.waitForFunction(() => document.querySelectorAll('#listaRegrasAlertas .alert-rule').length === 2);
  assert.equal((await a.p.evaluate(() => JSON.parse(localStorage.getItem('validade_alertas_regras_u1'))).then(c => c.items.length)), 2);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('alertas internos da loja: todos consultam, somente gerente/admin altera janela e autoriza Push', { skip: pular }, async () => {
  for (const papel of ['operador','analista','gerente','admin']) {
    const estado={loja_id:'L1',dias:21,push_interno:false,push_interno_desde:null},gravacoes=[];
    const a=await abrirLogado(async p=>{
      await rotasBase(p,papel);
      await p.route(/\/rest\/v1\/ajustes/,r=>{
        if(r.request().method()==='GET')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([estado])});
        const body=r.request().postDataJSON();gravacoes.push(body[0]);Object.assign(estado,body[0]);
        return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([estado])});
      });
    },{prod:{},cat:{},pere:{itens:{},regs:[]}},{papel});
    await a.p.waitForFunction(role=>{try{return JSON.parse(localStorage.getItem('validade_sessao')).papel===role;}catch(e){return false;}},papel);
    await a.p.click('nav button[data-v="aj"]');
    if(papel==='operador')await a.p.click('#sysMenu [data-sys-open="op-alertas"]');
    else if(['analista','gerente','admin'].includes(papel))await a.p.click('#sysMenu [data-sys-open="alertas"]');
    await a.p.waitForFunction(()=>document.getElementById('alertaLojaDias').value==='21');
    const autorizado=['gerente','admin'].includes(papel);
    assert.equal(await a.p.locator('#alertaLojaDias').isDisabled(),!autorizado,papel+' edição da janela');
    assert.equal(await a.p.locator('#pushInternoAutorizado').isDisabled(),!autorizado,papel+' autorização do Push');
    if(autorizado){
      await a.p.fill('#alertaLojaDias','45');await a.p.press('#alertaLojaDias','Tab');
      await a.p.waitForFunction(()=>document.getElementById('alertaLojaDias').value==='45');
      assert.equal(gravacoes[0].dias,45,'janela compartilhada foi persistida');
      await a.p.locator('#pushInternoAutorizado').check();
      await a.p.waitForFunction(()=>document.getElementById('pushInternoAutorizado').checked&&document.getElementById('alertaLojaStatus').textContent.includes('salva'));
      assert.equal(gravacoes[1].push_interno,true,'autorização do canal interno foi persistida');
    }
    assert.deepStrictEqual(a.erros,[]);await a.fechar();
  }
});


tflaky('Editar registro: administrador altera o nome do produto e o catálogo é atualizado', { skip: pular }, async () => {
  const a = await abrir({ dados: { prod: { '0070341558737': { lotes: [lote('l1', '2032-12-01', 15, '1382')] } }, cat: {}, pere: { itens: {}, regs: [] } } });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#edNome'), true, 'campo do nome aparece para o administrador');
  assert.strictEqual(await a.p.inputValue('#edNome'), '', 'produto sem nome começa vazio, sem repetir o EAN');
  await a.p.fill('#edNome', '  Creme de Leite 200g ');
  await a.p.selectOption('#edSetor', 'Mercearia');
  await a.p.click('#bEditSave');
  assert.strictEqual((await a.salvo()).cat['0070341558737'].nome, 'Creme de Leite 200g');
  assert.ok((await a.p.textContent('#v-detail')).includes('Creme de Leite 200g'), 'o detalhe mostra o nome novo');
  await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.inputValue('#edNome'), 'Creme de Leite 200g');
  assert.strictEqual(await a.p.textContent('#editProductName'), 'Creme de Leite 200g');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

for (const papel of ['admin', 'gerente']) tflaky('Editar registro: ' + papel + ' logado envia o nome novo ao catálogo compartilhado', { skip: pular }, async () => {
  const envios = [];
  const a = await abrirLogado(async p => { await rotasBase(p, papel);
    await p.route(/\/rest\/v1\/catalogo\?on_conflict/, r => { envios.push(r.request().postDataJSON()); r.fulfill({ status: 201, body: '' }); }); },
    { prod: { '7891000315507': { lotes: [Object.assign(lote('l1', '2032-12-01', 5, 'L1'), { setor: 'Mercearia', created_by: 'outro' })] } }, cat: { '7891000315507': { nome: 'Cafe' } }, pere: { itens: {}, regs: [] } }, { papel, nome: 'Chefe' });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#bSolicitarNome'), false, 'quem edita direto não vê o botão de solicitação');
  await a.p.fill('#edNome', 'Café Torrado 500g'); await a.p.click('#bEditSave');
  await a.p.waitForTimeout(300);
  assert.ok(envios.some(e => e[0].ean === '7891000315507' && e[0].nome === 'Café Torrado 500g'), 'catálogo recebeu o nome: ' + JSON.stringify(envios));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

for (const papel of ['operador', 'assistente', 'analista']) tflaky('Editar registro: ' + papel + ' não altera o nome, envia a correção para avaliação', { skip: pular }, async () => {
  const pedidos = [], envios = [];
  const a = await abrirLogado(async p => { await rotasBase(p, papel);
    await p.route(/\/rest\/v1\/catalogo\?on_conflict/, r => { envios.push(r.request().postDataJSON()); r.fulfill({ status: 201, body: '' }); });
    await p.route(/\/rest\/v1\/solicitacoes_nome/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(/\/rest\/v1\/rpc\/solicitar_correcao_nome$/, r => { pedidos.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: '"id-1"' }); }); },
    { prod: { '7891000315507': { lotes: [Object.assign(lote('l1', '2032-12-01', 5, 'L1'), { setor: 'Mercearia', created_by: 'u1' })] } }, cat: { '7891000315507': { nome: 'Cafe' } }, pere: { itens: {}, regs: [] } }, { papel, nome: 'Op' });
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#edNome'), true);
  assert.strictEqual(await a.p.isVisible('#bSolicitarNome'), true);
  await a.p.fill('#edNome', ' Café Torrado  500g ');
  await a.p.click('#bSolicitarNome');
  await a.p.waitForFunction(() => /avaliação/.test(document.getElementById('toast').textContent));
  assert.deepStrictEqual(pedidos, [{ p_ean: '7891000315507', p_nome: 'Café Torrado 500g', p_loja_id: 'L1' }]);
  await a.p.fill('#edNome', 'Outro nome'); await a.p.click('#bEditSave'); await a.p.waitForTimeout(300);
  assert.strictEqual((await a.salvo()).cat['7891000315507'].nome, 'Cafe', 'o nome não muda no aparelho sem aprovação');
  assert.ok(!envios.some(e => e[0].nome !== 'Cafe'), 'nenhum nome novo foi enviado direto ao catálogo: ' + JSON.stringify(envios));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Correções de nome: gerente vê a solicitação pendente e aprova', { skip: pular }, async () => {
  const revisoes = [];
  const a = await abrirLogado(async p => { await rotasBase(p, 'gerente');
    await p.route(/\/rest\/v1\/solicitacoes_exclusao/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(/\/rest\/v1\/solicitacoes_nome/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(revisoes.length ? [] : [{ id: 's1', ean: '7891000315507', nome_atual: 'Cafe', nome_sugerido: 'Café Torrado 500g', status: 'pendente', solicitante_nome: 'William', criado_em: '2026-11-11T07:00:00Z', resposta: null }]) }));
    await p.route(/\/rest\/v1\/rpc\/revisar_correcao_nome$/, r => { revisoes.push(r.request().postDataJSON()); r.fulfill({ status: 204, body: '' }); }); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'Gerente' });
  await a.p.click('nav button[data-v="aj"]');
  await a.p.waitForFunction(() => /Café Torrado 500g/.test(document.getElementById('listaSolicitacoesNome').textContent));
  const texto = await a.p.textContent('#listaSolicitacoesNome');
  assert.ok(texto.includes('Cafe') && texto.includes('William') && texto.includes('7891000315507'));
  await a.p.locator('#listaSolicitacoesNome [data-nome-review="yes"]').evaluate(b => b.click());
  await a.p.waitForFunction(() => /aprovad/i.test(document.getElementById('toast').textContent));
  assert.deepStrictEqual(revisoes, [{ p_id: 's1', p_aprovar: true, p_resposta: null }]);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Correções de nome: operador não recebe botões de aprovação', { skip: pular }, async () => {
  const a = await abrirLogado(async p => { await rotasBase(p, 'operador');
    await p.route(/\/rest\/v1\/solicitacoes_exclusao/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(/\/rest\/v1\/solicitacoes_nome/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 's1', ean: '7891000315507', nome_atual: 'Cafe', nome_sugerido: 'Café Torrado 500g', status: 'pendente', solicitante_nome: 'Op', criado_em: '2026-11-11T07:00:00Z', resposta: null }]) })); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Op' });
  await a.p.click('nav button[data-v="aj"]'); await a.p.waitForTimeout(500);
  assert.strictEqual(await a.p.locator('[data-nome-review]').count(), 0);
  assert.strictEqual(await a.p.isVisible('#cardCorrecoesNome'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

/* Alertas e Notificações: seção própria dentro do menu de Ajustes, não um cartão solto abaixo dele. */
for (const [papel, chave, depois] of [['admin', 'alertas', 'sobre'], ['gerente', 'alertas', 'sobre'], ['analista', 'alertas', 'sobre'], ['operador', 'op-alertas', 'op-sobre']]) tflaky('Ajustes: ' + papel + ' abre Alertas e Notificações pelo menu, acima de Sobre', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasBase(p, papel), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel, nome: 'Teste' });
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual(await a.p.isVisible('#sysMenuCard'), true);
  assert.strictEqual(await a.p.isVisible('#pushCard'), false, 'o cartão de alertas não fica solto abaixo do menu');
  const ordem = await a.p.locator('#sysMenu [data-sys-open]').evaluateAll(bs => bs.map(b => b.dataset.sysOpen));
  assert.strictEqual(ordem.indexOf(chave), ordem.indexOf(depois) - 1, 'fica logo acima de Sobre: ' + ordem.join(','));
  assert.ok((await a.p.textContent('#sysMenu [data-sys-open="' + chave + '"]')).includes('Alertas e Notificações'));
  await a.p.click('#sysMenu [data-sys-open="' + chave + '"]');
  assert.strictEqual(await a.p.textContent('#screenTitle'), 'Alertas e Notificações');
  assert.strictEqual(await a.p.isVisible('#pushCard'), true);
  assert.strictEqual(await a.p.isVisible('#alertaRegraDias'), true);
  assert.strictEqual(await a.p.isVisible('#sysMenuCard'), false);
  await a.p.click('#sysBackToMenu');
  assert.strictEqual(await a.p.isVisible('#sysMenuCard'), true);
  assert.strictEqual(await a.p.isVisible('#pushCard'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

/* Perfis de acesso: o administrador define as permissões de cada perfil. */
const rotasPerm = (p, papel, linhas, cap) => rotasBase(p, papel).then(async () => {
  await p.route(/\/rest\/v1\/papel_permissoes/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(linhas || []) }));
  await p.route(/\/rest\/v1\/solicitacoes_(nome|exclusao)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p.route(/\/rest\/v1\/rpc\/definir_permissao_papel$/, r => { if (cap) cap.push(r.request().postDataJSON()); r.fulfill({ status: 204, body: '' }); });
});
const dadosNome = () => ({ prod: { '7891000315507': { lotes: [Object.assign(lote('l1', '2032-12-01', 5, 'L1'), { setor: 'Mercearia', created_by: 'u1' })] } }, cat: { '7891000315507': { nome: 'Cafe' } }, pere: { itens: {}, regs: [] } });
const permsCarregadas = p => p.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('validade_sync') || '{}').permissoes; } catch (e) { return false; } });

tflaky('Perfis de acesso: administrador configura Recolher por perfil e concede permissão especial', { skip: pular }, async () => {
  const cap = [];
  const a = await abrirLogado(p => rotasPerm(p, 'admin', [], cap), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  assert.strictEqual(await a.p.isVisible('#cardPerfisAcesso'), true);
  assert.deepStrictEqual(await a.p.locator('#permPapel option').evaluateAll(o => o.map(x => x.value)), ['operador', 'assistente', 'analista', 'gerente']);
  await a.p.selectOption('#permPapel', 'gerente');
  assert.ok(await a.p.locator('#permBasicas [data-perm]').count() >= 4);
  assert.ok(await a.p.locator('#permEspeciais [data-perm]').count() >= 6);
  assert.strictEqual(await a.p.isChecked('#permEspeciais [data-perm="nome_editar"]'), true, 'gerente já edita nome por padrão');
  await a.p.selectOption('#permPapel', 'operador');
  assert.strictEqual(await a.p.isChecked('#permEspeciais [data-perm="nome_editar"]'), false);
  assert.strictEqual(await a.p.isChecked('#permBasicas [data-perm="registrar"]'), true);
  assert.strictEqual(await a.p.isChecked('#permBasicas [data-perm="registros_recolher"]'), true, 'Recolher fica habilitado por padrão para o Operador');
  assert.strictEqual(await a.p.isVisible('#bPermSalvar'), true, 'há um botão para salvar as permissões do perfil');
  assert.strictEqual(await a.p.isDisabled('#bPermSalvar'), true, 'sem alterações o botão fica inativo');
  await a.p.check('#permEspeciais [data-perm="nome_editar"]');
  await a.p.uncheck('#permBasicas [data-perm="registros_recolher"]');
  await a.p.check('#permBasicas [data-perm="relatorios"]'); await a.p.uncheck('#permBasicas [data-perm="relatorios"]');
  assert.deepStrictEqual(cap, [], 'nada é enviado antes de salvar');
  assert.ok((await a.p.textContent('#permStatus')).includes('2 alterações'), 'mostra o que falta salvar (marcar e desmarcar volta ao estado salvo)');
  await a.p.click('#bPermSalvar');
  await a.p.waitForFunction(() => /Permissões de Operador salvas/.test(document.getElementById('permStatus').textContent));
  assert.strictEqual(await a.p.isDisabled('#bPermSalvar'), true);
  assert.deepStrictEqual(cap, [{ p_papel: 'operador', p_permissao: 'nome_editar', p_permitido: true }, { p_papel: 'operador', p_permissao: 'registros_recolher', p_permitido: false }]);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso: cartão não aparece para gerente', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasPerm(p, 'gerente', []), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'G' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  assert.strictEqual(await a.p.isVisible('#cardPerfisAcesso'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso: operador com permissão especial edita o nome direto; gerente sem ela passa a solicitar', { skip: pular }, async () => {
  let a = await abrirLogado(p => rotasPerm(p, 'operador', [{ papel: 'operador', permissao: 'nome_editar', permitido: true }]), dadosNome(), { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#edNome'), true);
  assert.strictEqual(await a.p.isVisible('#bSolicitarNome'), false);
  await a.fechar();
  a = await abrirLogado(p => rotasPerm(p, 'gerente', [{ papel: 'gerente', permissao: 'nome_editar', permitido: false }]), dadosNome(), { papel: 'gerente', nome: 'G' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#bSolicitarNome'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso: básica desligada tira do operador a solicitação de nome; especial desligada tira Usuários do menu do gerente', { skip: pular }, async () => {
  let a = await abrirLogado(p => rotasPerm(p, 'operador', [{ papel: 'operador', permissao: 'nome_solicitar', permitido: false }]), dadosNome(), { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#edLote'), true);
  assert.strictEqual(await a.p.isVisible('#edNome'), false);
  await a.fechar();
  a = await abrirLogado(p => rotasPerm(p, 'gerente', [{ papel: 'gerente', permissao: 'usuarios_gerenciar', permitido: false }]), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'G' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  assert.strictEqual(await a.p.locator('#sysMenu [data-sys-open="usuarios"]').count(), 0);
  assert.strictEqual(await a.p.locator('#sysMenu [data-sys-open="relatorios"]').count(), 1);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso etapa 2: registros e exclusões ficam liberados para marcar; operador com permissão edita registro de outro', { skip: pular }, async () => {
  let a = await abrirLogado(p => rotasPerm(p, 'admin', []), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  for (const perm of ['registrar', 'editar_proprios', 'solicitar_exclusao', 'registros_editar_outros', 'exclusoes_aprovar', 'nome_editar'])
    assert.strictEqual(await a.p.isDisabled('#cardPerfisAcesso [data-perm="' + perm + '"]'), false, perm + ' habilitada para o operador');
  await a.fechar();
  const dados = dadosNome(); dados.prod['7891000315507'].lotes[0].created_by = 'outro';
  a = await abrirLogado(p => rotasPerm(p, 'operador', []), dados, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]');
  assert.strictEqual(await a.p.isVisible('#bDetailEdit'), false, 'sem a permissão, operador não edita registro de outro');
  await a.fechar();
  a = await abrirLogado(p => rotasPerm(p, 'operador', [{ papel: 'operador', permissao: 'registros_editar_outros', permitido: true }]), dados, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]'); await a.p.click('[data-detail-lote="l1"]'); await a.p.click('#bDetailEdit');
  assert.strictEqual(await a.p.isVisible('#edLote'), true, 'com a permissão, edita');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso etapa 3: nenhuma permissão fica travada para o administrador, em nenhum perfil', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasPerm(p, 'admin', []), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  for (const papel of ['operador', 'assistente', 'analista', 'gerente']) {
    await a.p.selectOption('#permPapel', papel);
    assert.strictEqual(await a.p.locator('#cardPerfisAcesso [data-perm]').count(), 18);
    assert.strictEqual(await a.p.locator('#cardPerfisAcesso [data-perm]:disabled').count(), 0, papel + ': nada desabilitado');
  }
  assert.ok(!(await a.p.textContent('#cardPerfisAcesso')).includes('Regra fixa'));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso etapa 3: operador recebe Auditoria, Relatórios e Lojas no menu só quando o administrador concede', { skip: pular }, async () => {
  let a = await abrirLogado(p => rotasPerm(p, 'operador', []), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  assert.deepStrictEqual(await a.p.locator('#sysMenu [data-sys-open]').evaluateAll(b => b.map(x => x.dataset.sysOpen)), ['op-perfil', 'op-preferencias', 'op-alertas', 'op-sobre']);
  await a.fechar();
  a = await abrirLogado(async p => { await rotasPerm(p, 'operador', ['auditoria_ver', 'relatorios', 'lojas_gerenciar'].map(x => ({ papel: 'operador', permissao: x, permitido: true })));
    await p.route(/\/rest\/v1\/auditoria/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await p.route(/\/rest\/v1\/lojas\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'L1', nome: 'FL05' }]) })); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  assert.deepStrictEqual(await a.p.locator('#sysMenu [data-sys-open]').evaluateAll(b => b.map(x => x.dataset.sysOpen)), ['op-perfil', 'op-preferencias', 'lojas', 'relatorios', 'auditoria', 'op-alertas', 'op-sobre']);
  await a.p.click('#sysMenu [data-sys-open="auditoria"]');
  assert.strictEqual(await a.p.isVisible('#cardAuditoria'), true);
  assert.strictEqual(await a.p.isVisible('#cardLojasAdmin'), false);
  await a.p.click('#sysBackToMenu'); await a.p.click('#sysMenu [data-sys-open="lojas"]');
  assert.strictEqual(await a.p.isVisible('#cardLojasAdmin'), true);
  await a.p.click('#sysBackToMenu'); await a.p.click('#sysMenu [data-sys-open="relatorios"]');
  assert.strictEqual(await a.p.isVisible('#sysReportsPanel'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso etapa 3: gerente perde Usuários e ganha Auditoria e Catálogo conforme a permissão', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasPerm(p, 'gerente', [{ papel: 'gerente', permissao: 'usuarios_gerenciar', permitido: false }, { papel: 'gerente', permissao: 'auditoria_ver', permitido: true }, { papel: 'gerente', permissao: 'catalogo_gerenciar', permitido: true }]),
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'G' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  const menu = await a.p.locator('#sysMenu [data-sys-open]').evaluateAll(b => b.map(x => x.dataset.sysOpen));
  assert.ok(!menu.includes('usuarios') && menu.includes('auditoria') && menu.includes('catalogo') && !menu.includes('lojas') && !menu.includes('dados'), menu.join(','));
  await a.p.click('#sysMenu [data-sys-open="catalogo"]');
  assert.strictEqual(await a.p.isVisible('#v-catalogo'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Perfis de acesso: trocar de perfil com alterações pendentes pede confirmação e falha ao salvar mantém a pendência', { skip: pular }, async () => {
  const a = await abrirLogado(async p => { await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/rpc\/definir_permissao_papel$/, r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Somente o Administrador define permissões' }) })); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="usuarios"]');
  await a.p.check('#permEspeciais [data-perm="auditoria_ver"]');
  a.respostas.push(false);
  await a.p.selectOption('#permPapel', 'gerente');
  assert.strictEqual(await a.p.inputValue('#permPapel'), 'operador', 'recusar a confirmação mantém o perfil');
  assert.strictEqual(await a.p.isChecked('#permEspeciais [data-perm="auditoria_ver"]'), true);
  await a.p.click('#bPermSalvar');
  await a.p.waitForFunction(() => /não foi salv|Somente o Administrador/i.test(document.getElementById('permStatus').textContent));
  assert.strictEqual(await a.p.isDisabled('#bPermSalvar'), false, 'continua pendente para tentar de novo');
  assert.strictEqual(await a.p.isChecked('#permEspeciais [data-perm="auditoria_ver"]'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

/* Alertas personalizados: quem tem a permissão envia um aviso de sistema para os usuários. */
tflaky('Alerta personalizado: administrador envia para os usuários e o push é disparado', { skip: pular }, async () => {
  const rpc = [], fn = [];
  const a = await abrirLogado(async p => { await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/lojas\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'L1', nome: 'FL05' }, { id: 'L2', nome: 'FL06' }]) }));
    await p.route(/\/rest\/v1\/rpc\/enviar_alerta_personalizado$/, r => { rpc.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ envio_id: 'e-1', destinatarios: 7 }) }); });
    await p.route(/\/functions\/v1\/alertas/, r => { if (r.request().method() === 'POST') fn.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enviados: 3 }) }); }); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="alertas"]');
  assert.strictEqual(await a.p.isVisible('#cardAlertaPersonalizado'), true);
  await a.p.click('#bApEnviar');
  assert.deepStrictEqual(rpc, [], 'não envia sem título e mensagem');
  await a.p.fill('#apTitulo', ' Inventário amanhã ');
  await a.p.fill('#apMensagem', 'Conferir a câmara fria até as 10h.');
  await a.p.waitForFunction(() => document.querySelectorAll('#apLoja option').length === 3);
  await a.p.selectOption('#apLoja', 'L2'); await a.p.selectOption('#apPapel', 'operador');
  await a.p.click('#bApEnviar');
  await a.p.waitForFunction(() => /7 usuário/.test(document.getElementById('apStatus').textContent));
  assert.deepStrictEqual(rpc, [{ p_titulo: 'Inventário amanhã', p_mensagem: 'Conferir a câmara fria até as 10h.', p_loja_id: 'L2', p_papel: 'operador' }]);
  assert.ok(fn.some(b => b.action === 'custom-push' && b.envioId === 'e-1'), 'push disparado: ' + JSON.stringify(fn));
  assert.strictEqual(await a.p.inputValue('#apTitulo'), '', 'formulário limpo após enviar');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Alerta personalizado: só aparece para quem o administrador habilitou', { skip: pular }, async () => {
  const rotas = linhas => async p => { await rotasPerm(p, 'operador', linhas);
    await p.route(/\/rest\/v1\/lojas\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })); };
  let a = await abrirLogado(rotas([]), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-alertas"]');
  assert.strictEqual(await a.p.isVisible('#pushCard'), true);
  assert.strictEqual(await a.p.isVisible('#cardAlertaPersonalizado'), false);
  await a.fechar();
  a = await abrirLogado(rotas([{ papel: 'operador', permissao: 'alertas_enviar', permitido: true }]), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Op' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="op-alertas"]');
  assert.strictEqual(await a.p.isVisible('#cardAlertaPersonalizado'), true);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

/* Instalação como aplicativo (PWA): o usuário é avisado de que pode instalar. */
const comoInstalado = p => p.addInitScript(() => { const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); });

tflaky('Instalar app: aviso aparece no Início, "Agora não" esconde e a escolha é lembrada', { skip: pular }, async () => {
  const a = await abrir();
  assert.strictEqual(await a.p.isVisible('#installCard'), true);
  assert.ok((await a.p.textContent('#installCard')).includes('Instale o aplicativo'));
  await a.p.click('#bInstalarDepois');
  assert.strictEqual(await a.p.isVisible('#installCard'), false);
  await a.p.reload();
  assert.strictEqual(await a.p.isVisible('#installCard'), false, 'não insiste depois de adiado');
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="sobre"]');
  assert.strictEqual(await a.p.isVisible('#bInstalarSobre'), true, 'continua disponível em Sobre');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Instalar app: botão abre o instalador do navegador e o aviso some depois de instalado', { skip: pular }, async () => {
  const a = await abrir();
  await a.p.evaluate(() => { window.__prompts = 0; const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompts++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await a.p.click('#bInstalar');
  assert.strictEqual(await a.p.evaluate(() => window.__prompts), 1);
  assert.strictEqual(await a.p.isVisible('#installHelp'), false, 'com instalador do navegador não precisa de instruções');
  await a.p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  assert.strictEqual(await a.p.isVisible('#installCard'), false);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Instalar app: sem instalador automático, o botão mostra o passo a passo', { skip: pular }, async () => {
  const a = await abrir();
  assert.strictEqual(await a.p.isVisible('#installHelp'), false);
  await a.p.click('#bInstalar');
  assert.strictEqual(await a.p.isVisible('#installHelp'), true);
  assert.match(await a.p.textContent('#installHelp'), /tela inicial/i);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Instalar app: aberto como aplicativo instalado, não mostra o aviso', { skip: pular }, async () => {
  const a = await abrir({ antes: comoInstalado });
  assert.strictEqual(await a.p.isVisible('#installCard'), false);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="sobre"]');
  assert.strictEqual(await a.p.isVisible('#bInstalarSobre'), false);
  assert.match(await a.p.textContent('#installSobreTexto'), /instalado/i);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Aviso do sistema: banner global exibe texto literal e marca somente o personalizado como lido', { skip: pular }, async () => {
  const loja = 'L1', avisoId = 'aviso-sistema-1';
  const titulo = 'Aviso <img src=x onerror="window.__alertXss=1">';
  const mensagem = 'Mensagem <svg onload="window.__alertXss=1">texto</svg>';
  const patches = [];
  const linhas = [
    { id: avisoId, loja_id: loja, tipo: 'sistema_personalizado', titulo, mensagem, lida_em: null },
    { id: 'aviso-validade-1', loja_id: loja, tipo: 'validade', titulo: 'Validade próxima', mensagem: 'Produto vence em breve', lida_em: null }
  ];
  const a = await abrirLogado(async p => {
    await rotasBase(p, 'operador');
    await p.route(/\/rest\/v1\/notificacoes(?:\?|$)/, r => {
      const req = r.request(), u = new URL(req.url());
      if (req.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(linhas) });
      if (req.method() === 'PATCH') {
        let body = null; try { body = req.postDataJSON(); } catch (e) {}
        const filtroId = u.searchParams.get('id') || '', registro = linhas.find(x => filtroId === 'eq.' + x.id);
        if (registro && body && body.lida_em) registro.lida_em = body.lida_em;
        patches.push({ url: u.pathname + u.search, body });
        return r.fulfill({ status: 204, body: '' });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Teste' });

  try {
    await a.p.waitForSelector('#systemAlertBanner', { state: 'visible' });
    assert.strictEqual(await a.p.textContent('#systemAlertTitle'), titulo);
    assert.strictEqual(await a.p.textContent('#systemAlertMessage'), mensagem);
    assert.strictEqual(await a.p.locator('#systemAlertBanner img, #systemAlertBanner svg').count(), 0, 'conteúdo malicioso aparece como texto, sem criar HTML');
    assert.strictEqual(await a.p.evaluate(() => window.__alertXss || 0), 0);
    assert.strictEqual(await a.p.textContent('#bSystemAlertOk'), 'OK');
    const textoBanner = await a.p.locator('#systemAlertBanner').innerText();
    assert.ok(textoBanner.includes(titulo) && textoBanner.includes(mensagem), 'banner mostra o aviso personalizado');
    assert.ok(!textoBanner.includes('Validade próxima') && !textoBanner.includes('Produto vence em breve'), 'aviso comum de validade não deve ser exibido como banner');

    await a.p.click('#bSystemAlertOk');
    await a.p.waitForSelector('#systemAlertBanner', { state: 'hidden' });
    await a.p.waitForFunction(() => document.querySelector('#systemAlertBanner')?.hidden || getComputedStyle(document.querySelector('#systemAlertBanner')).display === 'none');
    // Aguarda callbacks iniciais/duplicados da carga terminarem antes de validar a chamada de atualização.
    await a.p.waitForTimeout(150);
    assert.strictEqual(patches.length, 1, 'um único PATCH marca o aviso como lido');
    assert.strictEqual(patches[0].url, `/rest/v1/notificacoes?loja_id=eq.${loja}&id=eq.${avisoId}`);
    assert.deepStrictEqual(patches[0].body, { lida_em: patches[0].body.lida_em });
    assert.ok(typeof patches[0].body.lida_em === 'string' && !Number.isNaN(Date.parse(patches[0].body.lida_em)), 'lida_em deve ser ISO');
    assert.deepStrictEqual(a.erros, []);
  } finally { await a.fechar(); }
});


tflaky('Central desktop: admin aguarda confirmação do perfil, usa indicadores da loja ativa e exporta XLSX válido', { skip: pular }, async () => {
  let liberarPerfil;
  const perfilLiberado = new Promise(resolve => { liberarPerfil = resolve; });
  const dia = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dados = {
    prod: {
      '7890000000017': { lotes: [
        { id: 'lote-vencido', lote: 'A1', qtd: 4, val: dia(-1), setor: 'Mercearia', criado: Date.now() - 3000, created_by_nome: 'Operador A', rpcConfirmado: true },
        { id: 'lote-proximo', lote: 'A2', qtd: 3, val: dia(5), setor: 'Mercearia', em_area_vendas: false, criado: Date.now() - 2000, created_by_nome: 'Operador B', rpcConfirmado: true }
      ] },
      '7890000000024': { lotes: [
        { id: 'lote-valido', lote: 'B1', qtd: 2, val: '2099-12-31', setor: 'Bebidas', criado: Date.now() - 1000, created_by_nome: 'Operador C', rpcConfirmado: true }
      ] }
    },
    cat: {
      '7890000000017': { nome: 'Produto Vencido e Próximo', marca: 'Marca A' },
      '7890000000024': { nome: 'Produto Dentro da Validade', marca: 'Marca B' }
    },
    pere: {
      itens: { '2000001': { desc: 'Queijo Fresco', sif: 'SIF-7' } },
      regs: [{ id: 'pere-1', cod: '2000001', sif: 'SIF-7', peso: 1.25, val: '2099-12-31', setor: 'Frios', criado: Date.now(), created_by_nome: 'Operador D', rpcConfirmado: true }]
    }
  };
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/perfis(?:\?|$)/, async r => {
      await perfilLiberado;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ papel: 'admin', nome: 'Admin Teste' }]) });
    });
  }, dados, { papel: 'admin', nome: 'Papel armazenado antigo' });
  try {
    await a.p.setViewportSize({ width: 1440, height: 960 });
    await a.p.waitForFunction(() => document.documentElement.classList.contains('desktop-admin-pending'));
    assert.strictEqual(await a.p.isVisible('#adminDesktop'), false, 'não expõe a central enquanto o papel não foi confirmado');
    assert.strictEqual(await a.p.isVisible('#adminDesktopLoading'), true, 'indica que o perfil está sendo confirmado');
    liberarPerfil();
    await a.p.waitForFunction(() => document.documentElement.classList.contains('desktop-admin'));
    assert.strictEqual(await a.p.isVisible('#adminDesktop'), true);
    assert.strictEqual(await a.p.isVisible('#adminDesktopDashboard'), true);
    assert.strictEqual(await a.p.isVisible('nav.abas'), false, 'não exibe a navegação móvel no desktop admin');
    assert.strictEqual(await a.p.isVisible('#scanner'), false, 'scanner oculto no desktop');
    assert.strictEqual(await a.p.isVisible('#homeRegister'), false, 'entrada do fluxo móvel não aparece no desktop');
    assert.strictEqual(await a.p.textContent('#adminDesktopUser'), 'Admin Teste', 'usa o perfil confirmado, não o dado antigo da sessão');
    assert.strictEqual((await a.p.textContent('#adminKpiRecords')).trim(), '4');
    assert.strictEqual((await a.p.textContent('#adminKpiExpired')).trim(), '1');
    assert.strictEqual((await a.p.textContent('#adminKpiSoon')).trim(), '1');
    assert.strictEqual((await a.p.textContent('#adminKpiValid')).trim(), '2');
    assert.match(await a.p.textContent('#adminDesktopScope'), /Loja Teste/);
    await a.p.evaluate(() => document.getElementById('bEscanear').click());
    await a.p.waitForTimeout(100);
    assert.strictEqual(await a.p.locator('#scanner').evaluate(e => e.classList.contains('on')), false, 'clique programático também não inicia scanner no desktop');

    await a.p.click('#adminDesktopNav [data-admin-view="reports"]');
    assert.strictEqual(await a.p.isVisible('#adminDesktopReports'), true);
    assert.strictEqual((await a.p.textContent('#adminUserRecordsLeader')).trim(), 'Empate · 4 usuários');
    assert.strictEqual((await a.p.textContent('#adminUserRecordsLeaderCount')).trim(), '1 registro cada');
    assert.strictEqual(await a.p.locator('#adminUserRecordsChart .user-record-row').count(), 4);
    const [download] = await Promise.all([a.p.waitForEvent('download'), a.p.click('#adminExportXlsx')]);
    assert.match(download.suggestedFilename(), /^validade_relatorio_.*\.xlsx$/);
    const file = await download.path();
    const zip = fs.readFileSync(file);
    const entries = {};
    let offset = 0;
    while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
      const length = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
      const start = offset + 30 + nameLength + extraLength;
      entries[name] = zip.subarray(start, start + length).toString('utf8');
      offset = start + length;
    }
    assert.ok(entries['[Content_Types].xml'], 'pacote contém tipos Office Open XML');
    assert.match(entries['xl/worksheets/sheet2.xml'], /Localização/);
    assert.match(entries['xl/worksheets/sheet2.xml'], /Depósito/, 'XLSX exporta o local do lote');
    assert.match(entries['xl/workbook.xml'], /name="Resumo"/);
    assert.match(entries['xl/workbook.xml'], /name="Validades"/);
    assert.match(entries['xl/workbook.xml'], /name="Perecíveis"/);
    assert.match(entries['xl/workbook.xml'], /name="Alertas"/);
    assert.match(entries['xl/workbook.xml'], /name="Por usuário"/);
    assert.match(entries['xl/worksheets/sheet1.xml'], /Loja Teste/);
    assert.match(entries['xl/worksheets/sheet2.xml'], /Produto Vencido e Próximo/);
    assert.match(entries['xl/worksheets/sheet3.xml'], /Queijo Fresco/);
    assert.match(entries['xl/worksheets/sheet4.xml'], /Produto Vencido e Próximo/);
    assert.match(entries['xl/worksheets/sheet5.xml'], /Operador A/);

    await a.p.setViewportSize({ width: 390, height: 844 });
    await a.p.waitForFunction(() => !document.documentElement.classList.contains('desktop-admin'));
    assert.strictEqual(await a.p.isVisible('#adminDesktop'), false);
    assert.strictEqual(await a.p.isVisible('nav.abas'), true, 'volta à navegação móvel');
    assert.strictEqual(await a.p.isVisible('#homeRegister'), true, 'admin mantém o fluxo de registro no celular');
    assert.strictEqual((await a.p.textContent('#slogan')).trim(), 'Área do Administrador', 'o cabeçalho inicial acompanha o papel confirmado');
    await a.p.click('#homeRegister');
    assert.strictEqual(await a.p.isVisible('#bEscanear'), true, 'botão do scanner continua disponível no celular');
    assert.deepStrictEqual(a.erros, []);
  } finally { liberarPerfil(); await a.fechar(); }
});

tflaky('Central desktop: operador em PC não recebe a central administrativa nem perde a navegação existente', { skip: pular }, async () => {
  const a = await abrirLogado(p => rotasPerm(p, 'operador', []), { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'operador', nome: 'Operador Teste' });
  try {
    await a.p.setViewportSize({ width: 1440, height: 900 });
    await a.p.waitForFunction(() => JSON.parse(localStorage.getItem('validade_sessao') || '{}').papel === 'operador');
    assert.strictEqual(await a.p.locator('html').evaluate(e => e.classList.contains('desktop-admin')), false);
    assert.strictEqual(await a.p.isVisible('#adminDesktop'), false);
    assert.strictEqual(await a.p.isVisible('nav.abas'), true, 'mantém a interface já existente para não-admin');
    assert.strictEqual(await a.p.isVisible('#homeRegister'), true);
    await a.p.setViewportSize({ width: 390, height: 844 });
    assert.strictEqual(await a.p.locator('html').evaluate(e => e.classList.contains('desktop-admin')), false);
    assert.strictEqual(await a.p.isVisible('nav.abas'), true);
    assert.strictEqual((await a.p.textContent('#slogan')).trim(), 'Área do Operador', 'o cabeçalho mantém o papel do operador');
    await a.p.click('nav button[data-v="aj"]');
    assert.strictEqual((await a.p.textContent('#slogan')).trim(), 'Área do Operador', 'o subtítulo de Ajustes acompanha o papel operador');
    assert.deepStrictEqual(a.erros, []);
  } finally { await a.fechar(); }
});


tflaky('PWA iPhone: declara metadados Apple e orienta instalação como App Web', { skip: pular }, async () => {
  const a = await abrir({ url: URL_NOSUPA, opcoes: {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  } });
  try {
    assert.strictEqual(await a.p.locator('link[rel="apple-touch-icon"]').getAttribute('href'), './pwa-icon-192.png');
    assert.strictEqual(await a.p.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'), 'yes');
    assert.strictEqual(await a.p.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'), 'Validade');
    assert.strictEqual(await a.p.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'), 'black-translucent');
    assert.strictEqual(await a.p.locator('link[rel="manifest"]').getAttribute('href'), './manifest.webmanifest');
    await a.p.click('#bInstalar');
    const instrucoes = await a.p.textContent('#installHelp');
    assert.match(instrucoes, /Safari/);
    assert.match(instrucoes, /Adicionar à Tela de Início/);
    assert.match(instrucoes, /Abrir como App Web/);
    assert.deepStrictEqual(a.erros, []);
  } finally { await a.fechar(); }
});

/* Regras de antecipação não podem depender do localStorage (aparelho com armazenamento cheio). */
tflaky('alertas pessoais: com o armazenamento do aparelho cheio a regra ainda é enviada ao servidor e aparece na lista', { skip: pular }, async () => {
  const posts = []; let servidor = [];
  const a = await abrirLogado(async p => {
    await p.addInitScript(() => { const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('validade_alertas_regras_') === 0) throw new DOMException('cheio', 'QuotaExceededError'); return original.call(this, k, v); }; });
    await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/alertas_regras/, r => { const m = r.request().method();
      if (m === 'POST') { const b = r.request().postDataJSON(); posts.push(b); servidor = servidor.concat(b); return r.fulfill({ status: 201, body: '' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(servidor) }); }); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="alertas"]');
  await a.p.fill('#alertaRegraDias', '5'); await a.p.click('#bAlertaRegraAdicionar');
  await a.p.waitForFunction(() => document.querySelectorAll('#listaRegrasAlertas .alert-rule').length === 1);
  assert.strictEqual(posts.length, 1, 'regra enviada ao servidor');
  assert.strictEqual(posts[0][0].dias, 5);
  await a.p.waitForTimeout(400);
  assert.strictEqual(await a.p.locator('#listaRegrasAlertas .alert-rule').count(), 1, 'continua na lista depois de recarregar do servidor');
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Notificações: alertas personalizados aparecem mesmo gravados em outra loja do usuário', { skip: pular }, async () => {
  const urls = [];
  const a = await abrirLogado(async p => { await rotasPerm(p, 'gerente', []);
    await p.route(/\/rest\/v1\/notificacoes/, r => { urls.push(decodeURIComponent(r.request().url())); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'n1', tipo: 'sistema_personalizado', titulo: 'Inventário amanhã', mensagem: 'Conferir a câmara fria', payload: {}, criado: '2026-11-11T17:00:00Z', lida_em: null }]) }); }); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'G' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="alertas"]'); await a.p.click('[data-alert-view="notifications"]');
  await a.p.waitForFunction(() => /Inventário amanhã/.test(document.getElementById('listaNotificacoes').textContent));
  assert.ok(urls.some(u => u.includes('or=(loja_id.eq.L1,tipo.eq.sistema_personalizado)')), urls.join(' | '));
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});

tflaky('Google Calendar não aparece mais no aplicativo nem é chamado', { skip: pular }, async () => {
  const chamadas = [];
  const a = await abrirLogado(async p => { await rotasPerm(p, 'admin', []);
    await p.route(/\/functions\/v1\/google-calendar/, r => { chamadas.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }); },
    { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]'); await a.p.click('#sysMenu [data-sys-open="alertas"]');
  assert.strictEqual(await a.p.isVisible('#pushCard'), true);
  assert.strictEqual(await a.p.locator('#calendarCard, #bCalendarConnect').count(), 0);
  assert.ok(!/Google Calendar/i.test(await a.p.textContent('body')));
  await a.p.waitForTimeout(400);
  assert.deepStrictEqual(chamadas, []);
  assert.deepStrictEqual(a.erros, []); await a.fechar();
});


tflaky('Relatórios: gráfico mobile identifica quem fez mais registros e separa autoria desconhecida', { skip: pular }, async () => {
  const dados = {
    prod: { '7890000000017': { lotes: [
      { id: 'ana-1', lote: 'A1', qtd: 100, val: '2099-12-31', created_by: 'uid-ana', created_by_nome: 'Ana', rpcConfirmado: true },
      { id: 'ana-2', lote: 'A2', qtd: 50, val: '2099-12-31', created_by: 'uid-ana', created_by_nome: 'Ana', rpcConfirmado: true },
      { id: 'ana-3', lote: 'A3', qtd: 25, val: '2099-12-31', created_by: 'uid-ana', created_by_nome: 'Ana', rpcConfirmado: true },
      { id: 'bea-1', lote: 'B1', qtd: 80, val: '2099-12-31', created_by: 'uid-beatriz', created_by_nome: 'Beatriz', rpcConfirmado: true },
      { id: 'sem-autor', lote: 'X1', qtd: 1000, val: '2099-12-31', created_by: null, created_by_nome: '', rpcConfirmado: true }
    ] } },
    cat: { '7890000000017': { nome: 'Produto de teste' } },
    pere: { itens: { '2000001': { desc: 'Queijo teste' } }, regs: [
      { id: 'bea-2', cod: '2000001', sif: 'SIF-2', peso: 40, val: '2099-12-31', created_by: 'uid-beatriz', created_by_nome: 'Beatriz', rpcConfirmado: true }
    ] }
  };
  const a = await abrirLogado(p => rotasPerm(p, 'admin', []), dados, { papel: 'admin', nome: 'Admin' });
  try {
    await permsCarregadas(a.p);
    await a.p.click('nav button[data-v="aj"]');
    await a.p.click('#sysMenu [data-sys-open="relatorios"]');
    await a.p.waitForFunction(() => document.querySelectorAll('#sysUserRecordsChart .user-record-row').length === 3);
    assert.strictEqual((await a.p.textContent('#sysUserRecordsTotal')).trim(), '6', 'conta lançamentos, não unidades ou peso');
    assert.strictEqual((await a.p.textContent('#sysUserRecordsLeader')).trim(), 'Ana');
    assert.strictEqual((await a.p.textContent('#sysUserRecordsLeaderCount')).trim(), '3 registros');
    assert.strictEqual((await a.p.textContent('#sysUserRecordsUnknown')).trim(), '1');
    const nomes = await a.p.locator('#sysUserRecordsChart .user-record-name').evaluateAll(es => es.map(e => e.textContent.trim()));
    assert.deepStrictEqual(nomes, ['Ana', 'Beatriz', 'Autoria não identificada']);
    const beatriz = a.p.locator('#sysUserRecordsChart .user-record-row').nth(1);
    assert.match(await beatriz.textContent(), /1 lote · 1 perecível/);
    assert.deepStrictEqual(a.erros, []);
  } finally { await a.fechar(); }
});


const offsetValidade = dias => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + dias); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const dadoRetencao = () => {
  const loteTeste = (id, dias, extra = {}) => Object.assign(lote(id, offsetValidade(dias), 2, 'LOTE-'+id), { setor: 'Mercearia', created_by: 'u1', created_by_nome: 'Operador 1' }, extra);
  return {
    prod: { '7891000315507': { lotes: [loteTeste('vence-em-2', 2), loteTeste('vencido-5', -5), loteTeste('vencido-6', -6), loteTeste('ja-recolhido', 2, { recolhido_em: '2026-11-11T12:00:00Z', recolhido_por: 'u1' })] } },
    cat: { '7891000315507': { nome: 'Produto Retenção' } },
    pere: { itens: { '6019': { desc: 'Perecível Retenção' } }, regs: [
      { id: 'pere-vence-1', cod: '6019', sif: 'SIF-A', peso: 0.65, val: offsetValidade(1), setor: 'Açougue', created_by: 'u1', created_by_nome: 'Operador 1' },
      { id: 'pere-vencido-6', cod: '6019', sif: 'SIF-B', peso: 0.4, val: offsetValidade(-6), setor: 'Açougue', created_by: 'u1', created_by_nome: 'Operador 1' },
      { id: 'pere-recolhido', cod: '6019', sif: 'SIF-C', peso: 0.2, val: offsetValidade(2), setor: 'Açougue', created_by: 'u1', created_by_nome: 'Operador 1', recolhido_em: '2026-11-11T12:00:00Z' }
    ] }
  };
};

tflaky('retenção operacional: conserva o vencido até o quinto dia e oculta depois/recolhidos nos dois tipos', { skip: pular }, async () => {
  const a = await abrir({ dados: dadoRetencao() });
  await a.p.click('nav button[data-v="prod"]');
  let industrializados = await a.p.textContent('#listaProd');
  assert.ok(industrializados.includes('vence-em-2'));
  assert.ok(industrializados.includes('vencido-5'));
  assert.ok(!industrializados.includes('vencido-6'));
  assert.ok(!industrializados.includes('ja-recolhido'));
  assert.strictEqual(await a.p.textContent('#tLotes'), '2');
  await a.p.click('nav button[data-v="pere"]');
  const pereciveis = await a.p.textContent('#listaPe');
  assert.ok(pereciveis.includes('SIF-A'));
  assert.ok(!pereciveis.includes('SIF-B'));
  assert.ok(!pereciveis.includes('SIF-C'));
  assert.strictEqual(await a.p.textContent('#tPeTotal'), '1');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('recolhimento: operador autorizado confirma pela RPC e o registro some sem ser apagado', { skip: pular }, async () => {
  const chamadas = [];
  const dados = dadoRetencao();
  dados.prod['7891000315507'].lotes = [lote('lote-recolher', offsetValidade(3), 4, 'L-RECOLHER')];
  Object.assign(dados.prod['7891000315507'].lotes[0], { setor: 'Mercearia', created_by: 'u1', created_by_nome: 'Operador 1' });
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'operador', []);
    await p.route(/\/rest\/v1\/rpc\/marcar_registro_recolhido$/, async r => {
      chamadas.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tipo: 'lote', id: 'lote-recolher', recolhido_em: new Date().toISOString(), recolhido_por: 'u1', ja_recolhido: false }) });
    });
  }, dados, { uid: 'u1', usuario: 'operador1', nome: 'Operador 1', papel: 'operador' });
  await permsCarregadas(a.p);
  await a.p.setViewportSize({ width: 390, height: 844 });
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.isVisible('#listaProd [data-recolher]'), true);
  const geometria = await a.p.locator('#listaProd .operator-record').evaluate(card => {
    const miniatura = card.querySelector('.operator-record-thumb').getBoundingClientRect();
    const texto = card.querySelector('.operator-record-copy').getBoundingClientRect();
    const validade = card.querySelector('.operator-record-val').getBoundingClientRect();
    const acoes = card.querySelector('.operator-record-actions').getBoundingClientRect();
    return { largura: card.getBoundingClientRect().width, miniaturaRight: miniatura.right, textoLeft: texto.left, validadeLeft: validade.left, textoBottom: texto.bottom, validadeBottom: validade.bottom, acoesTop: acoes.top, acoesHeight: acoes.height };
  });
  assert.ok(geometria.largura < 520, 'cenário cobre a largura de um celular');
  assert.ok(geometria.textoLeft >= geometria.miniaturaRight, 'descrição permanece na coluna ao lado da miniatura');
  assert.ok(geometria.validadeLeft >= geometria.miniaturaRight, 'validade permanece na coluna de informações');
  assert.ok(geometria.acoesTop >= geometria.validadeBottom, 'botões ficam abaixo da descrição e da validade');
  assert.ok(geometria.acoesHeight >= 44, 'a faixa de ações tem altura confortável ao toque');
  assert.ok(geometria.validadeBottom >= geometria.textoBottom, 'a validade não é espremida ao lado dos botões');
  await a.p.click('#listaProd [data-recolher]');
  await a.p.waitForFunction(() => !document.querySelector('#listaProd [data-recolher]'));
  assert.deepStrictEqual(chamadas, [{ p_tipo: 'lote', p_id: 'lote-recolher', p_loja_id: 'L1' }]);
  const salvo = await a.salvo();
  assert.ok(salvo.prod['7891000315507'].lotes[0].recolhido_em, 'estado fica salvo no aparelho até sincronizar');
  assert.strictEqual(salvo.prod['7891000315507'].lotes.length, 1, 'registro é preservado, não apagado');
  assert.match(await a.p.textContent('#toast'), /tratado e recolhido/i);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('recolhimento: mantém o registro visível se o servidor recusar a ação', { skip: pular }, async () => {
  const dados = dadoRetencao();
  dados.prod['7891000315507'].lotes = [lote('lote-negado', offsetValidade(2), 1, 'L-NEGADO')];
  Object.assign(dados.prod['7891000315507'].lotes[0], { setor: 'Mercearia', created_by: 'u1', created_by_nome: 'Operador 1' });
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'operador', []);
    await p.route(/\/rest\/v1\/rpc\/marcar_registro_recolhido$/, r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'Sem autorização' }) }));
  }, dados, { uid: 'u1', usuario: 'operador1', nome: 'Operador 1', papel: 'operador' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]');
  await a.p.click('#listaProd [data-recolher]');
  await a.p.waitForFunction(() => document.getElementById('toast').classList.contains('on'));
  assert.strictEqual(await a.p.isVisible('#listaProd [data-recolher]'), true);
  const salvo = await a.salvo();
  assert.ok(!salvo.prod['7891000315507'].lotes[0].recolhido_em, 'falha remota não altera o estado local');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});

tflaky('recolhimento: permissão padrão permite a todos os perfis recolher na loja e o administrador pode desativá-la', { skip: pular }, async () => {
  const dados = dadoRetencao();
  dados.prod['7891000315507'].lotes = [lote('lote-outro', offsetValidade(2), 1, 'L-OUTRO'), Object.assign(lote('lote-recolhido-outro', offsetValidade(2), 1, 'L-RECOLHIDO'), { recolhido_em: '2026-11-11T12:00:00Z', recolhido_por: 'u2' })];
  Object.assign(dados.prod['7891000315507'].lotes[0], { setor: 'Mercearia', created_by: 'u2', created_by_nome: 'Outro operador' });
  let a = await abrirLogado(p => rotasPerm(p, 'operador', []), dados, { uid: 'u1', usuario: 'operador1', nome: 'Operador 1', papel: 'operador' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.locator('#listaProd [data-recolher]').count(), 1, 'operador pode recolher registro criado por outra pessoa na mesma loja');
  assert.strictEqual(await a.p.isVisible('#retencaoRecProd'), false, 'operador não pode consultar/reativar o arquivo de recolhidos');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
  a = await abrirLogado(p => rotasPerm(p, 'operador', [{ papel: 'operador', permissao: 'registros_recolher', permitido: false }]), dados, { uid: 'u1', usuario: 'operador1', nome: 'Operador 1', papel: 'operador' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.locator('#listaProd [data-recolher]').count(), 0, 'desativar no painel admin oculta o botão para esse perfil');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});


tflaky('reativação: assistente restaura um recolhimento equivocado para toda a loja', { skip: pular }, async () => {
  const chamadas = [];
  const dados = dadoRetencao();
  dados.prod['7891000315507'].lotes = [lote('lote-reativar', offsetValidade(2), 3, 'L-REATIVAR')];
  Object.assign(dados.prod['7891000315507'].lotes[0], { setor: 'Mercearia', created_by: 'u2', created_by_nome: 'Outro operador', recolhido_em: '2026-11-11T12:00:00Z', recolhido_por: 'u2' });
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'assistente', []);
    await p.route(/\/rest\/v1\/rpc\/restaurar_registro_recolhido$/, async r => {
      chamadas.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tipo: 'lote', id: 'lote-reativar', reativado: true, ja_ativo: false }) });
    });
  }, dados, { uid: 'u3', usuario: 'assistente1', nome: 'Assistente', papel: 'assistente' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="prod"]');
  assert.strictEqual(await a.p.isVisible('#retencaoRecProd'), true);
  await a.p.click('#bVerRecolhidosProd');
  assert.strictEqual(await a.p.locator('#listaProd [data-reativar]').count(), 1);
  await a.p.click('#listaProd [data-reativar]');
  await a.p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('validade_dados')).prod['7891000315507'].lotes[0].recolhido_em === null; } catch (e) { return false; } });
  await a.p.waitForFunction(() => document.querySelector('#listaProd')?.textContent.includes('L-REATIVAR'));
  assert.deepStrictEqual(chamadas, [{ p_tipo: 'lote', p_id: 'lote-reativar', p_loja_id: 'L1' }]);
  const salvo = await a.salvo();
  assert.strictEqual(salvo.prod['7891000315507'].lotes[0].recolhido_em, null);
  assert.strictEqual(salvo.prod['7891000315507'].lotes[0].recolhido_por, null);
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});


tflaky('auditoria de recolhimento aparece nos gráficos e indicadores somente para quem tem permissão', { skip: pular }, async () => {
  const consultas = [];
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/auditoria\?/, async r => {
      const url = new URL(r.request().url());
      if (url.searchParams.get('acao') === 'eq.registro_reativado') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (url.searchParams.has('acao')) {
        consultas.push({ loja: url.searchParams.get('loja_id'), acao: url.searchParams.get('acao'), criado: url.searchParams.getAll('criado'), limite: url.searchParams.get('limit'), offset: url.searchParams.get('offset') });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { user_id: 'u1', usuario: 'Ana Operadora', papel: 'operador', loja_id: 'L1', acao: 'registro_recolhido', criado: '2026-11-11T10:00:00Z', detalhe: { tipo: 'lote', produto: 'Leite Integral', registro_id: 'r1' } },
          { user_id: 'u2', usuario: 'Bia Assistente', papel: 'assistente', loja_id: 'L1', acao: 'registro_reativado', criado: '2026-11-11T11:00:00Z', detalhe: { tipo: 'perecivel', produto: 'Queijo Minas', registro_id: 'r2' } }
        ]) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  await a.p.click('#sysMenu [data-sys-open="relatorios"]');
  await a.p.waitForFunction(() => document.querySelector('#sysRecallAuditEvents')?.textContent.includes('Ana Operadora'));
  assert.strictEqual(await a.p.isVisible('#sysRecallAudit'), true);
  assert.strictEqual(await a.p.textContent('#sysRecallAuditTotal'), '2');
  assert.strictEqual(await a.p.textContent('#sysRecallAuditWithdrawn'), '1');
  assert.strictEqual(await a.p.textContent('#sysRecallAuditRestored'), '1');
  assert.ok((await a.p.textContent('#sysRecallAuditEvents')).includes('Recolheu'));
  assert.ok((await a.p.textContent('#sysRecallAuditEvents')).includes('Reativou'));
  assert.ok((await a.p.textContent('#sysRecallAuditChart')).includes('Ana Operadora'));
  assert.strictEqual(consultas[0].loja, 'eq.L1');
  assert.strictEqual(consultas[0].acao, 'in.(registro_recolhido,registro_reativado)');
  assert.strictEqual(consultas[0].criado.length, 2, 'período inicial envia limite inicial e final ao servidor');
  assert.strictEqual(consultas[0].limite, '500');
  assert.strictEqual(consultas[0].offset, '0');
  await a.p.selectOption('#sysRecallAuditPeriod', 'custom');
  await a.p.click('#sysRecallAuditApply');
  await a.p.waitForFunction(() => document.querySelector('#sysRecallAuditStatus')?.textContent.includes('Informe uma data inicial'));
  assert.strictEqual(consultas.length, 1, 'datas ausentes não disparam consulta');
  await a.p.fill('#sysRecallAuditFrom', '2026-11-01');
  await a.p.fill('#sysRecallAuditTo', '2026-11-12');
  await a.p.click('#sysRecallAuditApply');
  await a.p.waitForFunction(() => document.querySelector('#sysRecallAuditStatus')?.textContent.includes('Período: 2026-11-01 a 2026-11-12'));
  assert.strictEqual(consultas.length, 2);
  const limites = consultas[1].criado;
  assert.strictEqual(limites.length, 2);
  assert.ok(limites[0].startsWith('gte.') && limites[1].startsWith('lte.'));
  assert.ok(Date.parse(limites[0].slice(4)) < Date.parse(limites[1].slice(4)));
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});


tflaky('auditoria: gráfico ranqueia produtos reativados nos últimos 30 dias no mobile e desktop', { skip: pular }, async () => {
  const consultasTop = [];
  const quando = dias => new Date(Date.now() - dias * 86400000).toISOString();
  const eventos = [
    { loja_id: 'L1', acao: 'registro_reativado', criado: quando(0), detalhe: { tipo: 'lote', produto: 'Azeite Extra Virgem' } },
    { loja_id: 'L1', acao: 'registro_reativado', criado: quando(2), detalhe: { tipo: 'lote', produto: 'Azeite Extra Virgem' } },
    { loja_id: 'L1', acao: 'registro_reativado', criado: quando(4), detalhe: { tipo: 'perecivel', produto: 'Queijo Minas' } },
    { loja_id: 'L1', acao: 'registro_reativado', criado: quando(45), detalhe: { tipo: 'lote', produto: 'Azeite Extra Virgem' } }
  ];
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'admin', []);
    await p.route(/\/rest\/v1\/auditoria\?/, async r => {
      const url = new URL(r.request().url());
      const acao = url.searchParams.get('acao');
      if (acao === 'eq.registro_reativado') {
        const criado = url.searchParams.getAll('criado');
        consultasTop.push({ loja: url.searchParams.get('loja_id'), acao, criado, limite: url.searchParams.get('limit'), offset: url.searchParams.get('offset') });
        const desde = Date.parse(criado.find(x => x.startsWith('gte.')).slice(4));
        const ate = Date.parse(criado.find(x => x.startsWith('lte.')).slice(4));
        const dados = eventos.filter(e => Date.parse(e.criado) >= desde && Date.parse(e.criado) <= ate);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dados) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'admin', nome: 'Admin' });
  try {
    await permsCarregadas(a.p);
    await a.p.click('nav button[data-v="aj"]');
    await a.p.click('#sysMenu [data-sys-open="relatorios"]');
    await a.p.waitForFunction(() => document.querySelector('#sysRecallAuditTopProducts')?.textContent.includes('Azeite Extra Virgem'));
    const mobileRows = a.p.locator('#sysRecallAuditTopProducts .recall-audit-product-row');
    assert.strictEqual(await mobileRows.count(), 2);
    assert.match(await mobileRows.nth(0).textContent(), /Azeite Extra Virgem[\s\S]*2/);
    assert.match(await mobileRows.nth(1).textContent(), /Queijo Minas[\s\S]*1/);
    assert.ok((await mobileRows.nth(0).textContent()).includes('Industrializado'));
    assert.strictEqual(consultasTop.length, 1);
    assert.strictEqual(consultasTop[0].loja, 'eq.L1');
    assert.strictEqual(consultasTop[0].acao, 'eq.registro_reativado');
    assert.strictEqual(consultasTop[0].criado.length, 2, 'a consulta fixa envia início e fim da janela de 30 dias');
    assert.strictEqual(consultasTop[0].limite, '500');
    assert.strictEqual(consultasTop[0].offset, '0');
    const inicio = Date.parse(consultasTop[0].criado.find(x => x.startsWith('gte.')).slice(4));
    const fim = Date.parse(consultasTop[0].criado.find(x => x.startsWith('lte.')).slice(4));
    assert.ok(fim - inicio > 29 * 86400000 && fim - inicio < 31 * 86400000, 'a faixa enviada deve cobrir 30 dias locais');

    await a.p.setViewportSize({ width: 1440, height: 960 });
    await a.p.waitForFunction(() => document.documentElement.classList.contains('desktop-admin'));
    await a.p.click('#adminDesktopNav [data-admin-view="reports"]');
    await a.p.waitForFunction(() => document.querySelector('#adminRecallAuditTopProducts')?.textContent.includes('Azeite Extra Virgem'));
    assert.strictEqual(await a.p.locator('#adminRecallAuditTopProducts .recall-audit-product-row').count(), 2);
    assert.match(await a.p.locator('#adminRecallAuditTopProducts .recall-audit-product-row').first().textContent(), /Azeite Extra Virgem[\s\S]*2/);
    assert.strictEqual(consultasTop.length, 1, 'o mesmo escopo usa o cache recente, sem segunda consulta redundante');
    assert.deepStrictEqual(a.erros, []);
  } finally { await a.fechar(); }
});


tflaky('auditoria de recolhimento não é consultada no relatório sem a permissão auditoria_ver', { skip: pular }, async () => {
  const consultasAudit = [];
  const a = await abrirLogado(async p => {
    await rotasPerm(p, 'gerente', [{ papel: 'gerente', permissao: 'auditoria_ver', permitido: false }]);
    await p.route(/\/rest\/v1\/auditoria\?/, async r => {
      const url = new URL(r.request().url());
      if (url.searchParams.has('acao')) consultasAudit.push(url.searchParams.get('acao'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }, { prod: {}, cat: {}, pere: { itens: {}, regs: [] } }, { papel: 'gerente', nome: 'Gerente' });
  await permsCarregadas(a.p);
  await a.p.click('nav button[data-v="aj"]');
  await a.p.click('#sysMenu [data-sys-open="relatorios"]');
  assert.strictEqual(await a.p.isVisible('#sysReportsPanel'), true, 'o gerente mantém relatórios');
  assert.strictEqual(await a.p.isVisible('#sysRecallAudit'), false, 'auditoria fica oculta sem a permissão');
  assert.deepStrictEqual(consultasAudit, [], 'nenhuma consulta de auditoria é emitida');
  assert.deepStrictEqual(a.erros, []);
  await a.fechar();
});
