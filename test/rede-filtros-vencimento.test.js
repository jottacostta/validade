/* Painel "Todas as lojas" (Rede): filtros e contagem de validade por filial.
   Verifica a UI (src/app.html, dist/validade.html) e a lógica da migration
   que amplia public.rede_consultar com a_vencer/vencidos por filial. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
const DIST = fs.readFileSync(path.join(__dirname, '../dist/validade.html'), 'utf8');
const MIGR = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261123170000_rede_filtros_vencimento.sql'), 'utf8');

test('UI: painel Todas as lojas tem filtros Todos / A vencer / Vencidos', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /data-rfiltro="todos"/, 'botão de filtro "Todos" ausente');
    assert.match(html, /data-rfiltro="avencer"/, 'botão de filtro "A vencer" ausente');
    assert.match(html, /data-rfiltro="vencidos"/, 'botão de filtro "Vencidos" ausente');
    assert.match(html, /aria-label="Filtrar unidades por validade"/, 'grupo de filtros sem rótulo acessível');
  }
});

test('UI: cards da rede expõem contagem a vencer e vencidos', () => {
  for (const html of [SRC, DIST]) {
    assert.match(html, /data-avencer="'\+av\+'"/, 'card sem data-avencer');
    assert.match(html, /data-vencidos="'\+vc\+'"/, 'card sem data-vencidos');
    assert.match(html, /class="rede-tag wa">A vencer/, 'tag "A vencer" ausente no card');
    assert.match(html, /class="rede-tag da">Vencidos/, 'tag "Vencidos" ausente no card');
  }
});

test('UI: filtro combina com a busca por unidade (nome E situação)', () => {
  assert.match(SRC, /aplicarFiltroRede/, 'função de filtro combinada ausente');
  // o card só aparece quando casa o nome buscado E a situação escolhida
  assert.match(SRC, /nomeOk\s*&&\s*filtroOk/, 'filtro não combina nome e situação');
  // "todos" não filtra por situação; "avencer"/"vencidos" exigem contagem > 0
  assert.match(SRC, /redeFiltroAtivo==='avencer'&&Number\(card\.dataset\.avencer\)>0/);
  assert.match(SRC, /redeFiltroAtivo==='vencidos'&&Number\(card\.dataset\.vencidos\)>0/);
});

test('UI: resumo da rede soma a vencer e vencidos de todas as filiais', () => {
  assert.match(SRC, /totalAVencer=d\.reduce/, 'resumo sem total de a vencer');
  assert.match(SRC, /totalVencidos=d\.reduce/, 'resumo sem total de vencidos');
});

test('Migration: rede_consultar classifica por filial com o prazo de cada loja', () => {
  // vencido: validade já passou
  assert.match(MIGR, /val\s*<\s*current_date\)\s*vencidos/, 'regra de vencidos ausente');
  // a vencer: dentro do prazo configurado da loja (ajustes.dias), padrão 30
  assert.match(MIGR, /select a\.dias from public\.ajustes a where a\.loja_id=rede_registros\.loja_id\),30/,
    'a vencer deve usar o prazo de cada loja (ajustes.dias, padrão 30)');
  // só conta registros ativos (não recolhidos)
  assert.match(MIGR, /recolhido_em is null/, 'deve contar apenas registros ativos (não recolhidos)');
  // mantém a interface: segue sendo a função rede_consultar da visão geral
  assert.match(MIGR, /create or replace function public\.rede_consultar/);
  assert.match(MIGR, /a_vencer/);
  assert.match(MIGR, /vencidos/);
});
