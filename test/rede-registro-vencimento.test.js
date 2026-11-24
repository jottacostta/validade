/* Painel "Todas as lojas" (detalhe da filial): selo de validade por registro.
   Verifica a UI (src/app.html, dist/validade.html) e a lógica da migration
   que amplia a visão por filial de public.rede_consultar com vencido/a_vencer
   por registro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
const DIST = fs.readFileSync(path.join(__dirname, '../dist/validade.html'), 'utf8');
const MIGR = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261124120000_rede_registros_situacao_vencimento.sql'), 'utf8');

test('UI: card da filial exibe selo Vencido e A vencer', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /class="filial-status vencido">Vencido/, 'selo "Vencido" ausente no card');
    assert.match(html, /class="filial-status avencer">A vencer/, 'selo "A vencer" ausente no card');
  }
});

test('UI: o selo do card vem da situação de cada registro', () => {
  // vencido tem prioridade sobre a_vencer; recolhido não recebe selo (vem do backend)
  assert.match(SRC, /r\.vencido\?' <span class="filial-status vencido">Vencido<\/span>':r\.a_vencer\?/,
    'card deve priorizar vencido e, senão, a_vencer');
});

test('UI: estilos dos selos de vencimento do card', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /\.filial-status\.vencido\{/, 'estilo .filial-status.vencido ausente');
    assert.match(html, /\.filial-status\.avencer\{/, 'estilo .filial-status.avencer ausente');
  }
});

test('UI: detalhe da filial tem filtro Todos / A vencer / Vencidos', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /data-rfiltroreg="todos"/, 'botão de filtro "Todos" dos registros ausente');
    assert.match(html, /data-rfiltroreg="avencer"/, 'botão de filtro "A vencer" dos registros ausente');
    assert.match(html, /data-rfiltroreg="vencidos"/, 'botão de filtro "Vencidos" dos registros ausente');
    assert.match(html, /aria-label="Filtrar registros por validade"/, 'grupo de filtros dos registros sem rótulo acessível');
  }
});

test('UI: cada card expõe a situação de validade para o filtro', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /data-situacao="'\+\(r\.vencido\?'vencido':r\.a_vencer\?'avencer':'ok'\)\+'"/, 'card sem data-situacao');
  }
  // o filtro usa a situação de cada card
  assert.match(SRC, /redeRegFiltro==='avencer'&&s==='avencer'/);
  assert.match(SRC, /redeRegFiltro==='vencidos'&&s==='vencido'/);
});

test('Migration: detalhe da filial classifica cada registro pelo prazo da loja', () => {
  // vencido: validade já passou
  assert.match(MIGR, /r\.val\s*<\s*current_date\)\s*vencido/, 'regra de vencido por registro ausente');
  // a vencer: dentro do prazo configurado da loja (ajustes.dias, padrão 30) para p_loja
  assert.match(MIGR, /select a\.dias from public\.ajustes a where a\.loja_id=p_loja\),30/,
    'a vencer deve usar o prazo da loja consultada (ajustes.dias, padrão 30)');
  // só classifica registros ativos (não recolhidos)
  assert.match(MIGR, /r\.recolhido_em is null/, 'deve classificar apenas registros ativos');
  // mantém a interface da função e a visão geral inalterada
  assert.match(MIGR, /create or replace function public\.rede_consultar/);
  assert.match(MIGR, /a_vencer/);
  assert.match(MIGR, /vencido/);
});
