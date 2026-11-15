const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261115075000_checklist_diario_acougue.sql'), 'utf8');
const ADMIN = '10000000-0000-4000-8000-000000000001';
const EXECUTOR = '10000000-0000-4000-8000-000000000002';
const ENCARREGADO = '10000000-0000-4000-8000-000000000003';
const SUBGERENTE = '10000000-0000-4000-8000-000000000004';
const MEMBER_UNASSIGNED = '10000000-0000-4000-8000-000000000005';
const OUTSIDER = '10000000-0000-4000-8000-000000000006';
const STORE = '20000000-0000-4000-8000-000000000001';
const db = new PGlite();

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key,email text not null);
    create table public.perfis(id uuid primary key references auth.users(id),nome text,papel text not null);
    create table public.lojas(id uuid primary key,nome text not null);
    create table public.loja_membros(loja_id uuid not null references public.lojas(id),user_id uuid not null references auth.users(id),primary key(loja_id,user_id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function private.meu_papel() returns text language sql stable as $$ select coalesce((select papel from public.perfis where id=auth.uid()),'') $$;
    grant usage on schema auth,private to authenticated;
    grant execute on function auth.uid(),private.meu_papel() to authenticated;
    grant select on public.perfis to authenticated;
  `);
  await db.exec(migration);
  await db.query('insert into public.lojas(id,nome) values($1,$2)', [STORE, 'Filial de teste']);
  const users = [
    [ADMIN, 'admin@teste.invalid', 'admin'],
    [EXECUTOR, 'executor@teste.invalid', 'operador'],
    [ENCARREGADO, 'encarregado@teste.invalid', 'assistente'],
    [SUBGERENTE, 'subgerente@teste.invalid', 'gerente'],
    [MEMBER_UNASSIGNED, 'membro@teste.invalid', 'operador', true],
    [OUTSIDER, 'externo@teste.invalid', 'operador', false]
  ];
  for (const [id, email, role, member] of users) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await db.query('insert into public.perfis(id,nome,papel) values($1,$2,$3)', [id, email.split('@')[0], role]);
    if (member !== false) await db.query('insert into public.loja_membros(loja_id,user_id) values($1,$2)', [STORE, id]);
  }
});

after(async () => db.close());

async function setActor(uid) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
}

async function expectReject(promise, fragment) {
  await assert.rejects(promise, error => {
    assert.match(error.message, new RegExp(fragment, 'i'));
    return true;
  });
}

test('PostgreSQL: checklist protegido por membership, rascunho, submissão e dupla aprovação', async () => {
  const model = await db.query(`select jsonb_array_length(estrutura->'secoes')::int as secoes,
    (select sum(jsonb_array_length(s->'itens'))::int from jsonb_array_elements(estrutura->'secoes') s) as itens
    from public.checklist_modelos where codigo='acougue_diario' and ativo`);
  assert.deepEqual(model.rows[0], { secoes: 6, itens: 23 });

  await setActor(ADMIN);
  await db.query(`select public.checklist_configurar_loja($1,true,array[$2::uuid],$3::uuid,$4::uuid)`, [STORE, EXECUTOR, ENCARREGADO, SUBGERENTE]);
  await expectReject(
    db.query(`select public.checklist_configurar_loja($1,true,array[$2::uuid],$3::uuid,$4::uuid)`, [STORE, OUTSIDER, ENCARREGADO, SUBGERENTE]),
    'Configuração inválida'
  );

  await setActor(MEMBER_UNASSIGNED);
  assert.equal((await db.query('select private.checklist_designado($1) as ok', [STORE])).rows[0].ok, false);
  await setActor(EXECUTOR);
  assert.equal((await db.query('select private.checklist_designado($1) as ok', [STORE])).rows[0].ok, true);
  const created = await db.query('select public.checklist_criar_ronda($1,$2::date) as id', [STORE, '2026-11-15']);
  const roundId = created.rows[0].id;
  const repeated = await db.query('select public.checklist_criar_ronda($1,$2::date) as id', [STORE, '2026-11-15']);
  assert.equal(repeated.rows[0].id, roundId, 'criação repetida no dia retorna a mesma ronda');

  await db.query('select public.checklist_salvar_rascunho($1,$2::jsonb,$3)', [roundId, JSON.stringify({ item_01: { resposta: 'SIM' } }), '']);
  await expectReject(db.query('select public.checklist_submeter_ronda($1)', [roundId]), 'Complete todos os itens');

  const answers = Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`item_${String(i + 1).padStart(2, '0')}`, { resposta: 'SIM' }]));
  answers.item_05 = { resposta: 'SIM', ilhas_c: '-18.5', peixes_c: '2.5' };
  await db.query('select public.checklist_salvar_rascunho($1,$2::jsonb,$3)', [roundId, JSON.stringify(answers), 'Ronda de teste']);
  await db.query('select public.checklist_submeter_ronda($1)', [roundId]);
  assert.equal((await db.query('select estado from public.checklist_rondas where id=$1', [roundId])).rows[0].estado, 'submetida');

  await expectReject(
    db.query(`select public.checklist_assinar_ronda($1,'encarregado','validada',null)`, [roundId]),
    'Signatário não designado para esta etapa'
  );
  await setActor(ENCARREGADO);
  assert.equal((await db.query(`select public.checklist_assinar_ronda($1,'encarregado','validada',null) as resultado`, [roundId])).rows[0].resultado, 'aguardando_segunda_assinatura');
  assert.equal((await db.query('select estado from public.checklist_rondas where id=$1', [roundId])).rows[0].estado, 'submetida');
  await setActor(SUBGERENTE);
  assert.equal((await db.query(`select public.checklist_assinar_ronda($1,'subgerente','validada',null) as resultado`, [roundId])).rows[0].resultado, 'validada');
  assert.equal((await db.query('select estado from public.checklist_rondas where id=$1', [roundId])).rows[0].estado, 'validada');
  assert.equal((await db.query('select count(*)::int as n from public.checklist_assinaturas where ronda_id=$1', [roundId])).rows[0].n, 2);

  await db.query('delete from public.loja_membros where loja_id=$1 and user_id=$2', [STORE, EXECUTOR]);
  await setActor(EXECUTOR);
  assert.equal((await db.query('select private.checklist_designado($1) as ok', [STORE])).rows[0].ok, false,
    'a remoção do vínculo revoga acesso ainda que a atribuição histórica siga ativa');
  await db.exec('set role authenticated');
  assert.equal((await db.query('select count(*)::int as n from public.checklist_rondas')).rows[0].n, 0,
    'RLS esconde rondas após remoção do vínculo à loja');
  await db.exec('reset role');
});

test('PostgreSQL: modelos por filial, revisões e pausa individual preservam histórico e acesso', async () => {
  const otherStore = '20000000-0000-4000-8000-000000000002';
  const date = '2026-11-15';
  const secoes = titulo => JSON.stringify([{ titulo: 'Balcão', itens: [titulo] }]);
  const salvar = (loja, codigo, versao, titulo, perguntas) => db.query(
    'select public.checklist_salvar_modelo($1,$2,$3,$4,$5::jsonb) as codigo', [loja, codigo, versao, titulo, perguntas]);
  const criar = (loja, codigo, dia = date) => db.query(
    'select public.checklist_criar_ronda($1,$2::date,$3) as id', [loja, dia, codigo]);
  const ativar = (loja, id, ativa) => db.query('select public.checklist_definir_ronda_ativa($1,$2,$3)', [loja, id, ativa]);
  await db.query('insert into public.loja_membros(loja_id,user_id) values($1,$2)', [STORE, EXECUTOR]);
  await db.query('insert into public.lojas(id,nome) values($1,$2)', [otherStore, 'Outra filial']);
  await db.query('update public.checklist_configuracoes set ativo=false where loja_id=$1', [STORE]);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261115125146_rondas_personalizadas.sql'), 'utf8'));

  await setActor(ADMIN);
  await expectReject(salvar(STORE, null, null, 'Inválido', secoes(' ')), '1 a 20 perguntas');
  const abertura = (await salvar(STORE, null, null, 'Abertura', secoes('Balcão abastecido?'))).rows[0].codigo;
  const fechamento = (await salvar(STORE, null, null, 'Fechamento', secoes('Balcão limpo?'))).rows[0].codigo;
  const estrangeiro = (await salvar(otherStore, null, null, 'Outra filial', secoes('Balcão limpo?'))).rows[0].codigo;

  await setActor(EXECUTOR);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select private.checklist_designado($1) as ok', [STORE])).rows[0].ok, true);
  const modelos = (await db.query('select codigo from public.checklist_modelos')).rows.map(r => r.codigo);
  assert.deepEqual(new Set(modelos), new Set(['acougue_diario', abertura, fechamento]));
  await expectReject(criar(STORE, estrangeiro), 'Template ativo');
  await expectReject(salvar(STORE, null, null, 'Indevido', secoes('Pergunta?')), 'Somente o Administrador');
  const a = (await criar(STORE, abertura)).rows[0].id;
  const f = (await criar(STORE, fechamento)).rows[0].id;
  assert.notEqual(a, f);
  assert.equal((await criar(STORE, abertura)).rows[0].id, a);
  await expectReject(ativar(STORE, a, false), 'Somente o Administrador');
  await db.query('select public.checklist_salvar_rascunho($1,$2::jsonb,$3)', [a, JSON.stringify({ item_1_1: { resposta: 'SIM' } }), 'Observação']);
  await db.query('select public.checklist_submeter_ronda($1)', [a]);
  const original = (await db.query("select id,ativa,estado from public.checklist_rondas where modelo_codigo='acougue_diario'")).rows[0];
  assert.equal(original.ativa, false);
  assert.equal(original.estado, 'validada');
  assert.equal((await db.query('select count(*)::int as n from public.checklist_assinaturas where ronda_id=$1', [original.id])).rows[0].n, 2);

  await setActor(ADMIN);
  await expectReject(ativar(otherStore, a, false), 'Ronda indisponível nesta filial');
  await ativar(STORE, a, false);
  await salvar(STORE, abertura, 1, 'Abertura revisada', secoes('Balcão e etiquetas conferidos?'));
  await expectReject(salvar(STORE, abertura, 1, 'Edição antiga', secoes('Pergunta?')), 'O modelo mudou');

  await setActor(EXECUTOR);
  const pausada = (await db.query('select ativa,modelo_titulo,modelo_snapshot,respostas from public.checklist_rondas where id=$1', [a])).rows[0];
  assert.equal(pausada.ativa, false);
  assert.equal(pausada.modelo_titulo, 'Abertura');
  assert.equal(pausada.modelo_snapshot.secoes[0].itens[0].titulo, 'Balcão abastecido?');
  assert.equal(pausada.respostas.item_1_1.resposta, 'SIM');
  assert.equal((await db.query('select ativa from public.checklist_rondas where id=$1', [f])).rows[0].ativa, true);
  await expectReject(db.query("select public.checklist_salvar_rascunho($1,'{}',null)", [a]), 'Ronda inativa');
  await expectReject(db.query('select public.checklist_submeter_ronda($1)', [a]), 'Ronda inativa');
  const revisada = (await criar(STORE, abertura, '2026-11-16')).rows[0].id;
  assert.equal((await db.query('select modelo_titulo from public.checklist_rondas where id=$1', [revisada])).rows[0].modelo_titulo, 'Abertura revisada');
  await setActor(ENCARREGADO);
  await expectReject(db.query("select public.checklist_assinar_ronda($1,'encarregado','validada',null)", [a]), 'Ronda inativa');
  await setActor(ADMIN);
  await ativar(STORE, a, true);
  await setActor(ENCARREGADO);
  const aprovado = await db.query("select public.checklist_assinar_ronda($1,'encarregado','validada',null) as estado", [a]);
  assert.equal(aprovado.rows[0].estado, 'aguardando_segunda_assinatura');
  const eventos = await db.query("select acao from public.checklist_eventos where ronda_id=$1 and acao in ('pausada','reativada') order by id", [a]);
  assert.deepEqual(eventos.rows.map(r => r.acao), ['pausada', 'reativada']);
  await db.exec('reset role');
});

test('PostgreSQL: editar o checklist padrão cria uma versão por filial e preserva o histórico assinado', async () => {
  const otherStore = '20000000-0000-4000-8000-000000000002';
  const migrationPath = '../supabase/migrations/20261115132300_editar_checklist_padrao.sql';
  await db.exec(fs.readFileSync(path.join(__dirname, migrationPath), 'utf8'));
  for (const actor of [EXECUTOR, ENCARREGADO, SUBGERENTE]) {
    await db.query('insert into public.loja_membros(loja_id,user_id) values($1,$2)', [otherStore, actor]);
  }
  await setActor(ADMIN);
  await db.query('select public.checklist_configurar_loja($1,true,array[$2::uuid],$3::uuid,$4::uuid)', [otherStore, EXECUTOR, ENCARREGADO, SUBGERENTE]);
  const modelo = (await db.query("select estrutura from public.checklist_modelos where codigo='acougue_diario' and loja_id is null")).rows[0];
  const secoes = modelo.estrutura.secoes;
  secoes[0].titulo = 'Seção da filial';
  const salvar = (loja, versao) => db.query("select public.checklist_salvar_modelo($1,'acougue_diario',$2,'Checklist da filial',$3::jsonb)", [loja, versao, JSON.stringify(secoes)]);
  await salvar(STORE, 1);
  await expectReject(salvar(STORE, 1), 'O modelo mudou');
  await setActor(EXECUTOR);
  await expectReject(salvar(otherStore, 1), 'Somente o Administrador');
  const criar = loja => db.query("select public.checklist_criar_ronda($1,'2026-11-17') as id", [loja]);
  const localId = (await criar(STORE)).rows[0].id;
  const outraId = (await criar(otherStore)).rows[0].id;
  const locais = (await db.query('select modelo_titulo,modelo_snapshot from public.checklist_rondas where id=$1', [localId])).rows;
  const outras = (await db.query('select modelo_titulo,modelo_snapshot from public.checklist_rondas where id=$1', [outraId])).rows;
  assert.equal(locais[0].modelo_titulo, 'Checklist da filial');
  assert.equal(locais[0].modelo_snapshot.secoes[0].titulo, 'Seção da filial');
  const item = locais[0].modelo_snapshot.secoes[0].itens.find(i => i.temperaturas);
  assert.deepEqual(item.temperaturas, ['ilhas_c', 'peixes_c']);
  assert.match(item.descricao, /geladeira de peixes/);
  assert.notEqual(outras[0].modelo_snapshot.secoes[0].titulo, 'Seção da filial');
  const assinada = (await db.query("select id,modelo_snapshot from public.checklist_rondas where modelo_codigo='acougue_diario' and estado='validada' and loja_id=$1", [STORE])).rows[0];
  assert.deepEqual(assinada.modelo_snapshot, outras[0].modelo_snapshot);
  assert.equal((await db.query('select count(*)::int as n from public.checklist_assinaturas where ronda_id=$1', [assinada.id])).rows[0].n, 2);
  await setActor(ADMIN);
  await salvar(otherStore, 1);
});
