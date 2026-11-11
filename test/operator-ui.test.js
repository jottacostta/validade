const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');

test('Área do Operador usa cinco abas principais e mantém o registro iniciado pela Home', () => {
  const nav = html.match(/<nav class="abas" id="abas">([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'navegação principal encontrada');
  const tabs = [...nav[1].matchAll(/data-v="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['home', 'prod', 'pere', 'alertas', 'aj']);
  assert.match(html, /id="homeRegister"/);
  assert.match(html, /function mostrarEscolhaRegistro\(\)/);
});

test('registros de produtos e perecíveis têm telas de detalhe, edição e seleção por cartão', () => {
  for (const id of ['v-prod', 'v-pere', 'v-detail', 'v-edit']) assert.match(html, new RegExp(`id="${id}"`));
  for (const control of ['detailContent', 'detailOtherLots', 'bDetailEdit', 'edLote', 'edVal', 'edQtd', 'edSetor', 'edSif', 'edPereVal', 'edPeso', 'edPereSetor', 'bEditDelete']) {
    assert.match(html, new RegExp(`id="${control}"`), `controle ${control} existe`);
  }
  assert.match(html, /data-detail-lote=/);
  assert.match(html, /data-edit-lote=/);
  assert.match(html, /data-detail-pere=/);
  assert.match(html, /data-edit-pere=/);
});

test('filtros, alertas e notificações têm destinos próprios; temperatura fora do plano', () => {
  for (const control of ['qProd', 'fPeriodoProd', 'fSetorProd', 'fSituacaoProd', 'qPe', 'fPeriodoPe', 'fSetorPe']) {
    assert.match(html, new RegExp(`id="${control}"`));
  }
  assert.match(html, /id="alertasMain"/);
  assert.match(html, /id="cardNotificacoes"[^>]*display:none/);
  assert.match(html, /data-alert-view="notifications"/);
  // decisão do proprietário (10/11/2026): temperatura saiu do plano; não há controle na tela
  assert.doesNotMatch(html, /fTemperaturaPe|[Tt]emperatura/);
});

test('listas seguem a ordem das referências e não duplicam títulos ou filtros de status', () => {
  assert.doesNotMatch(html, /<div class="page-heading"/);
  assert.doesNotMatch(html, /id="fProd"/);
  const product = html.match(/<section class="vista" id="v-prod">([\s\S]*?)<\/section>/)[1];
  const productOrder = ['id="qProd"', 'id="fPeriodoProd"', 'class="operator-summary"', 'id="listaProd"']
    .map(token => product.indexOf(token));
  assert.ok(productOrder.every(i => i >= 0));
  assert.deepEqual(productOrder, [...productOrder].sort((a, b) => a - b));
  assert.match(product, /<small>Total<\/small>[\s\S]*?<small>Válidos<\/small>/);

  const perishableStart = html.indexOf('<div id="pe-lista"');
  const perishableOrder = ['id="qPe"', 'id="fPeriodoPe"', 'class="operator-summary"', 'id="listaPe"']
    .map(token => html.indexOf(token, perishableStart));
  assert.ok(perishableOrder.every(i => i >= 0));
  assert.deepEqual(perishableOrder, [...perishableOrder].sort((a, b) => a - b));
  assert.doesNotMatch(html, /id="profileArea" style="display:none"><div class="operator-page-intro"/);
});

test('Registrar: seletor Industrializado/Perecível no topo e formulário de perecível na mesma tela', () => {
  const reg = html.match(/<section class="vista" id="v-reg">([\s\S]*?)<\/section>/)[1];
  const ordem = ['id="regTipo"', 'id="bTipoIndustrial"', 'id="bTipoPerecivel"', 'id="cardRegScan"', 'id="pe-reg"', 'id="regSucesso"'].map(t => reg.indexOf(t));
  assert.ok(ordem.every(i => i >= 0), 'seletor, leitura, perecível e confirmação ficam em v-reg: ' + ordem);
  assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b));
  assert.doesNotMatch(html, /id="regEscolha"/, 'a tela separada de escolha deixa de existir');
  const pere = html.match(/<section class="vista" id="v-pere">([\s\S]*?)<\/section>/)[1];
  assert.doesNotMatch(pere, /id="pe-reg"/, 'o formulário de perecível sai da aba Perecíveis');
});

test('Registrar: quantidade com − / +, Ler Etiqueta e confirmação com as duas saídas', () => {
  for (const id of ['pQtdMenos', 'pQtdMais', 'bLerEtiqueta', 'etqConfirm', 'bEtqUsar', 'bEtqNovamente', 'bNovoRegistro', 'bVerRegistros', 'regSucessoTitulo']) {
    assert.match(html, new RegExp(`id="${id}"`), `controle ${id} existe`);
  }
});

test('Registrar: botões usam ícones desenhados, sem emoji', () => {
  const reg = html.match(/<section class="vista" id="v-reg">([\s\S]*?)<\/section>/)[1];
  assert.doesNotMatch(reg, /[\u{1F300}-\u{1FAFF}\u{2795}]/u);
});

test('Alertas: três contadores, chips de filtro e ações, sem texto técnico', () => {
  const al = html.match(/<section class="vista" id="v-alertas">([\s\S]*?)<\/section>/)[1];
  for (const id of ['alertCountVenc', 'alertCountProx', 'alertCountPend', 'alertFilters', 'listaAlertasValidade', 'bAlertExport', 'bAlertSort']) assert.match(al, new RegExp(`id="${id}"`), id);
  assert.deepEqual([...al.matchAll(/data-alert-filter="([^"]+)"/g)].map(m => m[1]), ['all', 'expired', 'soon', 'pending']);
  assert.doesNotMatch(al.match(/id="alertasMain"[\s\S]*?id="cardNotificacoes"/)[0], /Supabase/);
});

test('Detalhe e Editar: cabeçalho do produto com selo, aviso, histórico e quantidade com − / +', () => {
  for (const id of ['detailThumb', 'detailStatus', 'detailWarning', 'bDetailHistory', 'detailHistoryList', 'bDetailSameLot', 'editProductName', 'editStatus', 'edQtdMenos', 'edQtdMais']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const v of ['v-detail', 'v-edit', 'v-alertas']) {
    const sec = html.match(new RegExp(`<section class="vista" id="${v}">([\\s\\S]*?)</section>`))[1];
    assert.doesNotMatch(sec, /[\u{1F300}-\u{1FAFF}\u{270E}\u{2715}]/u, v + ' sem emoji');
  }
});

test('Barra inferior: caixa e carne coloridas, contador dentro do ícone do sino', () => {
  const nav = html.match(/<nav class="abas" id="abas">([\s\S]*?)<\/nav>/)[1];
  assert.match(nav, /data-v="prod"><span class="nav-box">/);
  assert.match(nav, /data-v="pere"><span class="nav-meat">/);
  assert.match(nav, /data-v="alertas"><span class="nav-bell"><svg[\s\S]*?<\/svg><b id="alertBadge"/);
});

test('Listas: paginação, botão Filtrar e nenhum emoji nas telas de registros', () => {
  for (const id of ['pagerProd', 'pagerPe', 'bFiltrarProd', 'bFiltrarPe']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const v of ['v-prod', 'v-pere']) {
    const sec = html.match(new RegExp(`<section class="vista" id="${v}">([\\s\\S]*?)</section>`))[1];
    assert.doesNotMatch(sec, /[\u{1F300}-\u{1FAFF}\u{2795}]/u, v + ' sem emoji');
  }
  assert.doesNotMatch(html, /♙/);
});

test('Ajustes: Configurações, Perfil, Alterar Senha e Sobre existem; ajustes técnicos preservados', () => {
  const inicioAj = html.indexOf('<section class="vista" id="v-aj">');
  const fimMain = html.indexOf('</main>', inicioAj);
  const aj = html.slice(inicioAj, fimMain);
  const ordem = ['id="settingsRefArea"', 'id="preferencesArea"', 'id="passwordArea"', 'id="aboutArea"'].map(t => aj.indexOf(t));
  assert.ok(ordem.every(i => i >= 0), String(ordem)); assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b));
  for (const id of ['aSom', 'aVibra', 'cfgLoja', 'cfgOperador', 'cfgVersao', 'cfgSync', 'cfgSenha', 'cfgSobre', 'cfgSair', 'pwAtual', 'pwNova', 'pwConfirma', 'bPwSalvar', 'bPwCancelar', 'aboutVersao', 'aboutPlataforma', 'profileLastAccess', 'profilePassword',
    'aDig', 'aValor', 'aOcr', 'aCosmos', 'aDias', 'aNotif']) assert.match(aj, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(aj, /[\u{1F300}-\u{1FAFF}\u{2699}]/u, 'Ajustes sem emoji');
});

test('Buscar Produto e Notificações: tela de busca própria, Limpar e ícones desenhados', () => {
  for (const id of ['v-busca', 'qBusca', 'buscaFiltros', 'buscaResultados', 'bAbrirBusca']) assert.match(html, new RegExp(`id="${id}"`), id);
  const al = html.match(/<section class="vista" id="v-alertas">([\s\S]*?)<\/section>/)[1];
  assert.match(al, /id="bLimparNotificacoes"/, 'Limpar existe desde a migration de remoção lógica');
  assert.doesNotMatch(al, /[\u{1F300}-\u{1FAFF}\u{26A0}\u{24D8}\u{2713}\u{21BB}]/u);
});

test('Leitor: cabeçalho próprio, Flash, Trocar câmera e Ler da galeria, sem emoji', () => {
  const sc = html.match(/<div id="scanner">([\s\S]*?)<\/div>\n<div id="conta"/)[1];
  for (const id of ['scanTitulo', 'scanTxt', 'bLuz', 'bTrocarCam', 'fGaleria', 'fFoto', 'bFechar', 'video']) assert.match(sc, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(sc.match(/<input[^>]*id="fGaleria"[^>]*>/)[0], /capture/, 'galeria não força a câmera');
  assert.doesNotMatch(sc, /[\u{1F300}-\u{1FAFF}\u{2715}]/u);
});

test('Catálogo: tela própria, com entrada só em Configurações (administração)', () => {
  const cat = html.match(/<section class="vista" id="v-catalogo">([\s\S]*?)<\/section>/);
  assert.ok(cat, 'v-catalogo existe');
  for (const id of ['qCatalogo', 'catalogoFiltros', 'tCatTotal', 'tCatCom', 'tCatSem', 'listaCatalogo', 'pagerCatalogo']) assert.match(cat[1], new RegExp(`id="${id}"`), id);
  assert.deepEqual([...cat[1].matchAll(/data-cat-filter="([^"]+)"/g)].map(m => m[1]), ['all', 'with', 'without', 'inactive']);
  assert.match(html, /data-catalogo-inativar/);
  assert.match(html, /data-catalogo-restaurar/);
  assert.match(html, /id="cfgAdminCard"[^>]*hidden/);
  assert.match(html, /id="cfgCatalogo"/);
  assert.doesNotMatch(html.match(/<nav class="abas" id="abas">([\s\S]*?)<\/nav>/)[1], /catalogo/i, 'catálogo não entra na barra inferior');
  assert.doesNotMatch(cat[1], /[\u{1F300}-\u{1FAFF}]/u);
});

test('Push e regras pessoais: cartão dedicado aparece em Configurações e não em Alertas da loja', () => {
  const aj = html.match(/<section class="vista" id="v-aj">([\s\S]*?)<\/section>/)[1];
  const al = html.match(/<section class="vista" id="v-alertas">([\s\S]*?)<\/section>/)[1];
  for (const id of ['pushCard', 'bPushAtivar', 'bPushDesativar', 'listaRegrasAlertas']) { assert.match(html, new RegExp(`id="${id}"`)); assert.doesNotMatch(al, new RegExp(`id="${id}"`)); }
  assert.match(html, /id="pushStatus"/);
  assert.match(aj, /data-sec="alertas"[^>]*id="pushCard"|id="pushCard"[^>]*data-sec="alertas"/);
  assert.match(al, /id="bIrPush"/);
  assert.match(html, /\{id:'alertas',titulo:'Alertas e Notificações'/);
  assert.match(html, /naSecaoAlertas=v==='syssection'&&\(sysSecAtual==='alertas'\|\|sysSecAtual==='op-alertas'\)/);
  assert.match(html, /\$\('pushCard'\)\.style\.display=mostrarAlertas\?'':'none'/);
});

test('Ajustes administrativos: menu de onze seções respeita a hierarquia dos perfis', () => {
  for (const id of ['sysMenuCard', 'sysMenu', 'sysSectionHead', 'sysBackToMenu', 'sysSectionTitle', 'sysSectionView', 'sysReportsPanel']) {
    assert.match(html, new RegExp('id="' + id + '"'), id + ' existe');
  }
  const entries = [...html.matchAll(/\{id:'([^']+)',titulo:'([^']+)',sub:'[^']+',roles:\[([^\]]+)\]/g)].filter(x => !x[1].startsWith('op-'));
  assert.equal(entries.length, 11, 'onze seções administrativas definidas');
  assert.deepEqual(entries.map(x => x[1]), ['perfil','usuarios','lojas','catalogo','pereciveis','relatorios','auditoria','config','dados','alertas','sobre']);
  const access = Object.fromEntries(entries.map(x => [x[1], x[3].replace(/'/g, '').split(',')]));
  assert.deepEqual(access.perfil, ['analista','gerente','admin']);
  assert.deepEqual(access.usuarios, ['analista','gerente','admin']);
  assert.deepEqual(access.lojas, ['admin']);
  assert.deepEqual(access.catalogo, ['admin']);
  assert.deepEqual(access.pereciveis, ['analista','gerente','admin']);
  assert.deepEqual(access.relatorios, ['analista','gerente','admin']);
  assert.deepEqual(access.auditoria, ['admin']);
  assert.deepEqual(access.config, ['gerente','admin']);
  assert.deepEqual(access.dados, ['admin']);
  assert.deepEqual(access.sobre, ['analista','gerente','admin']);
  assert.match(html, /function podeVerMenuSistema\(\)\{return \['analista','gerente','admin'\]\.includes\(papelAtual\(\)\);\}/);
  assert.match(html, /function abrirSecaoSistema\(key\)/);
});

test('Ajustes administrativos: telas existentes são agrupadas sem duplicar IDs ou mover controles', () => {
  for (const [id, sec] of [
    ['aDig','pereciveis'], ['aValor','pereciveis'], ['aDias','alertas'], ['aNotif','alertas'],
    ['aCosmos','config'], ['cardConta','config'], ['cardAuditoria','auditoria'],
    ['cardSolicitacoes','pereciveis'], ['cardUsuarios','usuarios'], ['cardLojasAdmin','lojas'], ['bExp','dados']
  ]) {
    const at = html.indexOf('id="' + id + '"');
    assert.ok(at >= 0, id + ' continua no DOM');
    const start = html.lastIndexOf('data-sec="' + sec + '"', at);
    assert.ok(start >= 0 && at - start < 5000, id + ' está agrupado em ' + sec);
  }
  assert.match(html, /#preferencesArea\[data-sec-ativa="pereciveis"\][\s\S]*?display:none!important/);
  assert.match(html, /data-sys-action="bCsvProd"/);
  assert.match(html, /data-sys-action="bCsvPe"/);
  assert.match(html, /data-sys-action="bAlertExport"/);
});

test('Ajustes do Operador: menu próprio reutiliza recursos pessoais sem expor administração', () => {
  const items = [...html.matchAll(/\{id:'(op-[^']+)',titulo:'([^']+)',sub:'[^']+',roles:\[([^\]]+)\]/g)];
  assert.deepEqual(items.map(x => x[1]), ['op-perfil', 'op-preferencias', 'op-alertas', 'op-sobre']);
  for (const item of items) assert.deepEqual(item[3].replace(/'/g, '').split(','), ['operador']);
  assert.match(html, /function podeVerMenuOperador\(\)\{return papelAtual\(\)==='operador';\}/);
  assert.match(html, /data-sec-ativa="operador"/);
  assert.match(html, /#preferencesArea\[data-sec-ativa="operador"\]>.card\[data-sec\]:not\(\[data-sec="operador"\]\):not\(\[data-sec="pereciveis"\]\):not\(\[data-sec="config"\]\)/);
  assert.match(html, /if\(item\.id==='op-preferencias'\)\{\$\('settingsRefArea'\)\.style\.display='';\$\('preferencesArea'\)\.style\.display='';\$\('preferencesArea'\)\.dataset\.secAtiva='operador';\}/);
});


test('Alertas pessoais e Push: cartão unificado preserva controles e separa escopo pessoal/loja', () => {
  const area = html.match(/<div id="preferencesArea">([\s\S]*?)<\/div>\s*<\/div>/)[1];
  assert.match(html, /id="pushCard"[^>]*data-sec="alertas"|data-sec="alertas"[^>]*id="pushCard"/);
  for (const id of ['alertaRegraDias','alertaRegraHora','bAlertaRegraAdicionar','listaRegrasAlertas','alertasRegraSugestao','pushStatus','bPushAtivar','bPushDesativar','alertaLojaDias','alertaLojaStatus','pushInternoAutorizado','aDias','aNotif']) assert.match(html, new RegExp('id="'+id+'"'), id);
  assert.equal([...html.matchAll(/id="pushCard"/g)].length, 1);
  assert.doesNotMatch(html, /<div class="card" data-sec="pereciveis"><h2>Alertas<\/h2>/);
  assert.match(html, /Alertas internos compartilhados da loja/);
  assert.match(html, /validade_alertas_regras_/);
  assert.match(html, /rest\/v1\/alertas_regras\?select=id,user_id,dias,hora_local,fuso,ativo/);
  assert.match(html, /on_conflict=id/);
  assert.match(html, /data-regra-toggle/);
  assert.match(html, /data-regra-delete/);
  assert.match(html, /Destaque local quando faltarem \(dias\)/);
  assert.match(html, /function podeGerenciarAlertasLoja\(\)\{return \['admin','gerente'\]\.includes\(papelAtual\(\)\);\}/);
  assert.match(html, /function carregarAjustesAlertasLoja\(\)/);
  assert.match(html, /rest\/v1\/ajustes\?select=loja_id,dias,push_interno,push_interno_desde/);
  assert.match(html, /Autorizar Push dos alertas internos desta loja/);
  assert.match(html, /function novoIdRegra\(\).*xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx/);
  assert.ok(html.includes('function horaRegraValida(v){return /^([01]\\d|2[0-3]):[0-5]\\d$/'), 'valida o horário local HH:MM');
  assert.doesNotMatch(area, /data-sec="alertas"[\s\S]*?data-sec="pereciveis"/);
});


test('Google Calendar fica no cartão pessoal, independente do Push interno da loja', () => {
  for (const id of ['calendarCard','calendarStatus','calendarFeedback','bCalendarConnect','bCalendarSync','bCalendarDisconnect']) assert.match(html, new RegExp('id="'+id+'"'));
  assert.match(html, /Google Calendar/);
  assert.match(html, /calendário principal Google/);
  assert.match(html, /todas as lojas elegíveis/);
  assert.match(html, /próximos 365 dias/);
  assert.match(html, /function calendarAcao\(action\).*functions\/v1\/google-calendar/);
  assert.match(html, /body:\{action:action\}/);
  assert.doesNotMatch(html.match(/function calendarAcao\(action\)[\s\S]*?function calendarRender/)[0], /userId\s*[:=]|refresh_token\s*[:=]|localStorage/);
  assert.match(html, /Os eventos já criados no Google serão mantidos/);
  assert.match(html, /Date\.now\(\)-calendarUltimoSync<300000/);
});
