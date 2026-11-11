const test = require('node:test');
const assert = require('node:assert/strict');

const logicPromise = import('../supabase/functions/google-calendar/sync-logic.mjs');
const resposta = status => ({ status, ok: status >= 200 && status < 300 });

test('invalid_grant durante refresh exige nova autorização; outros grants/erros não são classificados como revogação', async () => {
  const { classificarFalhaToken } = await logicPromise;
  assert.equal(classificarFalhaToken('refresh_token', 'invalid_grant'), 'refresh_token_revoked');
  assert.equal(classificarFalhaToken('authorization_code', 'invalid_grant'), 'google_token_exchange_failed');
  assert.equal(classificarFalhaToken('refresh_token', 'invalid_client'), 'google_token_exchange_failed');
  assert.equal(classificarFalhaToken('refresh_token', undefined), 'google_token_exchange_failed');
});

test('duas sincronizações simultâneas sem mapping não criam dois eventos: 409 reconcilia com PATCH', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  let eventoRemotoExiste = false;
  let insercoes = 0;
  let atualizacoes = 0;
  const callbacks = {
    priorAtivo: false,
    payloadIgual: false,
    consultar: async () => resposta(404),
    inserir: async () => {
      insercoes++;
      // Simula o insert atômico do Google: só a primeira chamada cria o ID estável.
      if (eventoRemotoExiste) return resposta(409);
      eventoRemotoExiste = true;
      return resposta(201);
    },
    atualizar: async () => { atualizacoes++; return resposta(eventoRemotoExiste ? 200 : 404); },
  };

  const resultados = await Promise.all([
    reconciliarEventoCalendar(callbacks),
    reconciliarEventoCalendar(callbacks),
  ]);

  assert.equal(insercoes, 2, 'as duas requisições tentam inserir o mesmo ID determinístico');
  assert.equal(atualizacoes, 1, 'a colisão 409 atualiza o evento já criado em vez de duplicá-lo');
  assert.equal(resultados.filter(x => x.tipo === 'created').length, 1);
  assert.equal(resultados.filter(x => x.tipo === 'updated').length, 1);
  assert.equal(eventoRemotoExiste, true);
});

test('mapping ativo com payload igual consulta o Calendar e recria evento apagado remotamente', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  const chamadas = [];
  const resultado = await reconciliarEventoCalendar({
    priorAtivo: true,
    payloadIgual: true,
    consultar: async () => { chamadas.push('get'); return resposta(404); },
    inserir: async () => { chamadas.push('post'); return resposta(201); },
    atualizar: async () => { chamadas.push('patch'); return resposta(200); },
  });
  assert.deepEqual(chamadas, ['get', 'post']);
  assert.equal(resultado.tipo, 'created');
});

test('mapping ativo alterado recria evento ausente; conflito concorrente termina em PATCH', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  const chamadas = [];
  const resultado = await reconciliarEventoCalendar({
    priorAtivo: true,
    payloadIgual: false,
    consultar: async () => { chamadas.push('get'); return resposta(200); },
    inserir: async () => { chamadas.push('post'); return resposta(409); },
    atualizar: async () => { chamadas.push('patch'); return resposta(chamadas.filter(x => x === 'patch').length === 1 ? 404 : 200); },
  });
  assert.deepEqual(chamadas, ['patch', 'post', 'patch']);
  assert.equal(resultado.tipo, 'updated');
});

test('HTTP 410 também confirma ausência e permite recriar o mesmo evento', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  const chamadas = [];
  const resultado = await reconciliarEventoCalendar({
    priorAtivo: true,
    payloadIgual: true,
    consultar: async () => { chamadas.push('get'); return resposta(410); },
    inserir: async () => { chamadas.push('post'); return resposta(201); },
    atualizar: async () => { chamadas.push('patch'); return resposta(200); },
  });
  assert.deepEqual(chamadas, ['get', 'post']);
  assert.equal(resultado.tipo, 'created');
});

test('HTTP 500 em GET/PATCH falha sem tentar inserir evento', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  let insercoes = 0;
  const getFalhou = await reconciliarEventoCalendar({
    priorAtivo: true, payloadIgual: true,
    consultar: async () => resposta(500),
    inserir: async () => { insercoes++; return resposta(201); },
    atualizar: async () => resposta(200),
  });
  const patchFalhou = await reconciliarEventoCalendar({
    priorAtivo: true, payloadIgual: false,
    consultar: async () => resposta(200),
    inserir: async () => { insercoes++; return resposta(201); },
    atualizar: async () => resposta(500),
  });
  assert.equal(getFalhou.tipo, 'failed');
  assert.equal(patchFalhou.tipo, 'failed');
  assert.equal(insercoes, 0);
});

test('falha de autorização ao verificar evento não é confundida com evento ausente', async () => {
  const { reconciliarEventoCalendar } = await logicPromise;
  let escritas = 0;
  const resultado = await reconciliarEventoCalendar({
    priorAtivo: true,
    payloadIgual: true,
    consultar: async () => resposta(403),
    inserir: async () => { escritas++; return resposta(201); },
    atualizar: async () => { escritas++; return resposta(200); },
  });
  assert.equal(resultado.tipo, 'failed');
  assert.equal(resultado.response.status, 403);
  assert.equal(escritas, 0);
});
