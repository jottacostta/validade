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

test('filtros, alertas e notificações têm destinos próprios; temperatura não é simulada', () => {
  for (const control of ['qProd', 'fPeriodoProd', 'fSetorProd', 'fSituacaoProd', 'qPe', 'fPeriodoPe', 'fSetorPe']) {
    assert.match(html, new RegExp(`id="${control}"`));
  }
  assert.match(html, /id="alertasMain"/);
  assert.match(html, /id="cardNotificacoes"[^>]*display:none/);
  assert.match(html, /data-alert-view="notifications"/);
  assert.match(html, /id="fTemperaturaPe"[^>]*disabled/);
  assert.match(html, /O contrato atual não armazena temperatura/);
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
