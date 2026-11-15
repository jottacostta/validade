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
