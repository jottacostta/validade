const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/app.html'), 'utf8');
const source = html.split('/* BEGIN ADMIN_DASHBOARD_INSIGHTS */')[1].split('/* END ADMIN_DASHBOARD_INSIGHTS */')[0];
const sandbox = { console, Intl, Date, Number, String, Math, Object, Array, JSON };
vm.runInNewContext(source, sandbox, { filename: 'dashboard.js' });
const insights = sandbox.adminDashboardInsights;
assert.equal(typeof insights, 'function');

function row(overrides = {}) {
  return Object.assign({
    tipo: 'Lote', codigo: '001', nome: 'Produto', lote: 'L1', quantidade: 10, peso: 0,
    setor: 'Mercearia', localizacao: 'Área de Vendas', validade: '2026-11-20', dias: 8,
    informante: 'Ana', informanteId: 'a', recolhido: false, ocultoPorVencimento: false,
    criado: '2026-11-12T10:00:00-03:00', lojaId: 'loja-1', lojaNome: 'Loja Centro'
  }, overrides);
}

const agora = new Date(2026, 10, 12, 12, 0, 0);

test('separa janelas de prazo, histórico recolhido e risco sem somar peso', () => {
  const rows = [
    row({ codigo: 'a', dias: -2, quantidade: 4 }),
    row({ codigo: 'b', dias: 0, quantidade: 3 }),
    row({ codigo: 'c', dias: 5, quantidade: 2, peso: 99 }),
    row({ codigo: 'd', dias: 6, quantidade: 7 }),
    row({ codigo: 'e', dias: 15, quantidade: 8 }),
    row({ codigo: 'f', dias: 16, quantidade: 9 }),
    row({ codigo: 'g', dias: 30, quantidade: 11 }),
    row({ codigo: 'h', dias: 31, quantidade: 13 }),
    row({ codigo: 'i', dias: null, validade: '' }),
    row({ codigo: 'j', dias: 2, quantidade: 100, peso: 40, recolhido: true }),
    row({ codigo: 'k', dias: -8, quantidade: 5, ocultoPorVencimento: true })
  ];
  const m = insights(rows, agora);
  assert.equal(m.activeRows, 9);
  assert.equal(m.collectedCount, 1);
  assert.equal(m.hiddenExpiredCount, 1);
  assert.equal(m.upTo5, 2);
  assert.equal(m.sixTo15, 2);
  assert.equal(m.sixteenTo30, 2);
  assert.equal(m.unitsAtRisk, 9, '4 vencidas + 3 hoje + 2 em D+5; peso não entra');
  assert.deepEqual(JSON.parse(JSON.stringify(m.expiration.map(x => x.count))), [1, 2, 2, 2, 1, 1]);
});

test('conta qualidade, setores, localizações e informantes por registro ativo', () => {
  const rows = [
    row({ codigo: 'a', setor: '', informante: '', informanteId: null, localizacao: 'Depósito', dias: 4 }),
    row({ codigo: 'b', setor: 'Padaria', informante: 'Bruno', informanteId: 'b', localizacao: 'Área de Vendas', dias: 10 }),
    row({ codigo: 'c', setor: 'Padaria', informante: 'Bruno', informanteId: 'b', localizacao: 'Área de Vendas', dias: 20 }),
    row({ codigo: 'd', setor: 'FLV', informante: 'Ana', informanteId: 'a', localizacao: 'Depósito', dias: 40, tipo: 'Perecível', quantidade: 0, peso: 1.25 }),
    row({ codigo: 'e', setor: 'Açougue', informante: 'Ana', informanteId: 'a', localizacao: 'Outro', dias: 50 }),
    row({ codigo: 'f', setor: 'Salgados', informante: 'Usuário local', informanteId: null, localizacao: 'Área de Vendas', dias: 8, recolhido: true })
  ];
  const m = insights(rows, agora);
  assert.equal(m.missingSector, 1);
  assert.equal(m.missingAuthor, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(m.sectors.slice(0, 3))), [
    { label: 'Padaria', count: 2 },
    { label: 'Açougue', count: 1 },
    { label: 'FLV', count: 1 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(m.locations)), [
    { key: 'area', label: 'Área de Vendas', count: 2, units: 20, weight: 0 },
    { key: 'deposito', label: 'Depósito', count: 2, units: 10, weight: 1.25 },
    { key: 'unknown', label: 'Sem localização', count: 1, units: 10, weight: 0 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(m.informants.slice(0, 3))), [
    { label: 'Ana', count: 2 },
    { label: 'Bruno', count: 2 },
    { label: 'Autoria não identificada', count: 1 }
  ]);
});

test('evolução usa timestamp/date local, janela de 14 dias e não inventa criado ausente', () => {
  const rows = [
    row({ codigo: 'hoje-1', criado: '2026-11-12T15:30:00Z' }),
    row({ codigo: 'hoje-2', criado: '2026-11-12' }),
    row({ codigo: 'ontem', criado: new Date(2026, 10, 11, 8, 0, 0) }),
    row({ codigo: 'fora', criado: '2026-10-01T12:00:00-03:00' }),
    row({ codigo: 'sem-data', criado: null })
  ];
  const m = insights(rows, agora);
  assert.equal(m.daily.length, 14);
  assert.equal(m.daily.at(-1).date, '2026-11-12');
  assert.equal(m.daily.at(-1).count, 2);
  assert.equal(m.daily.at(-2).date, '2026-11-11');
  assert.equal(m.daily.at(-2).count, 1);
  assert.equal(m.dailyWithoutDate, 1);
  assert.equal(m.dailyOutsideWindow, 1);
});

test('prioridade traz cinco prazos mais curtos e mantém unidades e kg separados', () => {
  const rows = [
    row({ codigo: 'longo', nome: 'Longo', dias: 30, quantidade: 1, peso: 0 }),
    row({ codigo: 'curto', nome: 'Curto', dias: 0, quantidade: 12, peso: 0 }),
    row({ codigo: 'peso', nome: 'Peso', dias: 2, quantidade: 0, peso: 1.25 }),
    row({ codigo: 'sem-data', nome: 'Sem data', dias: null, validade: '' }),
    row({ codigo: 'recolhido', nome: 'Histórico', dias: -1, recolhido: true }),
    row({ codigo: 'vencido', nome: 'Vencido', dias: -3, quantidade: 2 })
  ];
  const m = insights(rows, agora);
  assert.deepEqual(m.priority.map(x => x.row.codigo), ['vencido', 'curto', 'peso', 'longo']);
  assert.equal(m.priority[1].row.quantidade, 12);
  assert.equal(m.priority[2].row.peso, 1.25);
  assert.equal(m.priority.length, 4);
});
