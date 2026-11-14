const { test } = require('node:test');
const assert = require('node:assert/strict');

const formatter = import('../supabase/functions/alertas/validade-push.mjs');
const aviso = {
  titulo: 'Validade próxima',
  mensagem: 'Registro vence em 2026-11-17',
  payload: { fonte: 'lote', registro_id: 'lote-1', codigo: '7891234567890', nome: '  GRANOLA   INTEGRAL  ', validade: '2026-11-17' },
};

test('Push de validade próxima mostra o produto no título e a validade no corpo', async () => {
  const { montarPushValidade } = await formatter;
  assert.deepEqual(montarPushValidade(aviso), {
    title: 'GRANOLA INTEGRAL', body: 'Vence em 17/11/2026', data: aviso.payload,
  });
});

test('Push abrevia descrição longa de perecível sem cortar palavras', async () => {
  const { montarPushValidade } = await formatter;
  const payload = { ...aviso.payload, fonte: 'perecivel', nome: 'FILÉ DE COSTELA FRACIONADO BOVINO ESPECIAL' };
  assert.equal(montarPushValidade({ ...aviso, payload }).title, 'FILÉ DE COSTELA FRACIONADO…');
});

test('Push preserva texto para produto sem nome e alertas de outros tipos', async () => {
  const { montarPushValidade } = await formatter;
  const semNome = { ...aviso.payload, nome: aviso.payload.codigo };
  assert.deepEqual(montarPushValidade({ ...aviso, payload: semNome }), {
    title: aviso.titulo, body: aviso.mensagem, data: semNome,
  });
  const vencido = { ...aviso, titulo: 'Produto vencido', mensagem: 'Registro vencido em 2026-11-17' };
  assert.deepEqual(montarPushValidade(vencido), {
    title: vencido.titulo, body: vencido.mensagem, data: vencido.payload,
  });
});
