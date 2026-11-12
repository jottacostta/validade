const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261112123000_escopo_individual_gerente.sql'), 'utf8');
const scopeSource = fs.readFileSync(path.join(root, 'supabase/functions/gerir-usuarios/scope.ts'), 'utf8')
  .replace(/\bexport\s+/g, '');
const usersEdge = fs.readFileSync(path.join(root, 'supabase/functions/gerir-usuarios/index.ts'), 'utf8');
const alertsEdge = fs.readFileSync(path.join(root, 'supabase/functions/alertas/index.ts'), 'utf8');

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const MANAGER_A = '20000000-0000-4000-8000-000000000001';
const MANAGER_B = '20000000-0000-4000-8000-000000000002';
const MANAGER_NONE = '20000000-0000-4000-8000-000000000003';
const ANALYST = '30000000-0000-4000-8000-000000000001';
const ADMIN = '30000000-0000-4000-8000-000000000002';
const TARGET_A = '40000000-0000-4000-8000-000000000001';
const TARGET_C = '40000000-0000-4000-8000-000000000002';
const UNATTACHED = '40000000-0000-4000-8000-000000000003';
const TARGET_EXTRA = '40000000-0000-4000-8000-000000000004';
const RULE_A = '50000000-0000-4000-8000-000000000001';
const OUTBOX_FOREIGN = '60000000-0000-4000-8000-000000000001';
const OUTBOX_DIRECT_FOREIGN = '60000000-0000-4000-8000-000000000002';
const INTERNAL_FOREIGN = '70000000-0000-4000-8000-000000000001';
const NOTIF_FOREIGN = '80000000-0000-4000-8000-000000000001';
const NOTIF_MEMBER = '80000000-0000-4000-8000-000000000002';

const fixture = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema private;

  create table auth.users(id uuid primary key, email text not null);
  create table public.perfis(id uuid primary key references auth.users(id), nome text, papel text not null);
  create table public.lojas(id uuid primary key, nome text not null);
  create table public.loja_membros(loja_id uuid references public.lojas(id), user_id uuid references auth.users(id), primary key(loja_id,user_id));
  create table public.papel_permissoes(papel text, permissao text, permitido boolean, primary key(papel,permissao));
  create table public.produtos(loja_id uuid, ean text, created_by uuid, primary key(loja_id,ean));
  create table public.lotes(
    id text primary key, loja_id uuid, ean text, lote text, val date, deleted_at timestamptz,
    recolhido_em timestamptz, recolhido_por uuid, setor text, created_by uuid
  );
  create table public.pere_itens(loja_id uuid, cod text, descricao text, created_by uuid, primary key(loja_id,cod));
  create table public.pere_regs(
    id text primary key, loja_id uuid, cod text, sif text, val date, deleted_at timestamptz,
    recolhido_em timestamptz, recolhido_por uuid, setor text, created_by uuid
  );
  create table public.ajustes(
    loja_id uuid primary key, dias smallint default 30, push_interno boolean default false,
    push_interno_desde timestamptz
  );
  create table public.auditoria(
    id bigint generated always as identity, user_id uuid, usuario text, papel text,
    loja_id uuid, loja_nome text, acao text, detalhe jsonb default '{}'::jsonb,
    criado timestamptz default now()
  );
  create table public.notificacoes(
    id uuid primary key default gen_random_uuid(), user_id uuid, loja_id uuid,
    dedupe_key text not null, tipo text, titulo text, mensagem text,
    payload jsonb default '{}'::jsonb, criado timestamptz default now(), removida_em timestamptz,
    unique(user_id,dedupe_key)
  );
  create table public.catalogo(ean text primary key, nome text);
  create table public.alertas_regras(
    id uuid primary key default gen_random_uuid(), user_id uuid, dias smallint,
    hora_local time, fuso text default 'UTC', ativo boolean default true,
    unique(user_id,dias,hora_local,fuso)
  );
  create table public.alertas_push_outbox(
    id uuid primary key default gen_random_uuid(), regra_id uuid not null references public.alertas_regras(id),
    user_id uuid not null references auth.users(id), loja_id uuid not null references public.lojas(id),
    registro_id text not null, fonte text not null, validade date not null, data_local date not null,
    titulo text not null, mensagem text not null, payload jsonb not null,
    status text not null default 'pending', attempts integer not null default 0,
    available_at timestamptz not null default now(), lease_until timestamptz,
    last_error text, created_at timestamptz default now(), sent_at timestamptz,
    unique(regra_id,user_id,loja_id,registro_id,validade,data_local)
  );
  create table public.alertas_push_internos_outbox(
    id uuid primary key default gen_random_uuid(), notificacao_id uuid not null unique references public.notificacoes(id),
    user_id uuid not null references auth.users(id), loja_id uuid not null references public.lojas(id),
    titulo text not null, mensagem text not null, payload jsonb not null,
    status text not null default 'pending', attempts integer not null default 0,
    available_at timestamptz not null default now(), lease_until timestamptz,
    last_error text, created_at timestamptz default now(), sent_at timestamptz
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('test.role', true), ''), 'anon')
  $$;
  create function private.meu_papel() returns text language sql stable security definer set search_path='' as $$
    select papel from public.perfis where id=auth.uid()
  $$;
  create function private.membro_da(loja uuid) returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.loja_membros where loja_id=loja and user_id=auth.uid())
  $$;
  create function private.tem_permissao(perm text) returns boolean language sql stable security definer set search_path='' as $$
    select coalesce(
      (select permitido from public.papel_permissoes
        where papel=private.meu_papel() and permissao=perm),
      case
        when private.meu_papel()='admin' then true
        when perm in ('registrar','editar_proprios','registros_editar_outros','usuarios_excluir','auditoria_ver','alertas_enviar')
          and private.meu_papel() in ('gerente','analista') then true
        when perm='usuarios_gerenciar' and private.meu_papel() in ('gerente','analista') then true
        when perm='avisos_todas_lojas' and private.meu_papel() in ('gerente','analista') then true
        else false
      end
    )
  $$;
  create function private.tem_escopo_global() returns boolean language sql stable security definer set search_path='' as $$
    select false
  $$;
  create function public.papel_tem_permissao(p_papel text, p_permissao text)
  returns boolean language sql stable security definer set search_path='' as $$
    select case
      when p_papel is null then false
      when p_papel='admin' then true
      else coalesce(
        (select permitido from public.papel_permissoes
          where papel=p_papel and permissao=p_permissao),
        (p_papel in ('analista','gerente') and p_permissao in ('avisos_todas_lojas','usuarios_gerenciar'))
      )
    end
  $$;

  insert into auth.users values
    ('${MANAGER_A}', 'manager-a@example.invalid'), ('${MANAGER_B}', 'manager-b@example.invalid'),
    ('${MANAGER_NONE}', 'manager-none@example.invalid'), ('${ANALYST}', 'analyst@example.invalid'),
    ('${ADMIN}', 'admin@example.invalid'), ('${TARGET_A}', 'target-a@example.invalid'),
    ('${TARGET_C}', 'target-c@example.invalid'), ('${UNATTACHED}', 'unattached@example.invalid'),
    ('${TARGET_EXTRA}', 'target-extra@example.invalid');
  insert into public.perfis values
    ('${MANAGER_A}', 'Gerente A', 'gerente'), ('${MANAGER_B}', 'Gerente B', 'gerente'),
    ('${MANAGER_NONE}', 'Gerente Sem Loja', 'gerente'), ('${ANALYST}', 'Analista', 'analista'),
    ('${ADMIN}', 'Administrador', 'admin'), ('${TARGET_A}', 'Alvo A', 'operador'),
    ('${TARGET_C}', 'Alvo C', 'operador'), ('${UNATTACHED}', 'Sem Loja', 'operador'),
    ('${TARGET_EXTRA}', 'Alvo Extra', 'operador');
  insert into public.lojas values ('${A}','Loja A'),('${B}','Loja B'),('${C}','Loja C');
  insert into public.loja_membros values
    ('${A}','${MANAGER_A}'),('${B}','${MANAGER_A}'),('${B}','${MANAGER_B}'),
    ('${A}','${TARGET_A}'),('${C}','${TARGET_C}');
  insert into public.papel_permissoes values
    ('gerente','avisos_todas_lojas',true),
    ('gerente','lojas_gerenciar',true),
    ('gerente','usuarios_gerenciar',true),
    ('analista','avisos_todas_lojas',false),
    ('analista','usuarios_gerenciar',false),
    ('operador','avisos_todas_lojas',true),
    ('operador','lojas_gerenciar',true);
  insert into public.produtos values
    ('${A}','EAN-A','${TARGET_A}'),('${B}','EAN-B','${TARGET_A}'),('${C}','EAN-C','${TARGET_C}');
  insert into public.lotes values
    ('lot-a','${A}','EAN-A','A',current_date,null,null,null,'FLV','${TARGET_A}'),
    ('lot-b','${B}','EAN-B','B',current_date,null,null,null,'FLV','${TARGET_A}'),
    ('lot-c','${C}','EAN-C','C',current_date,null,null,null,'FLV','${TARGET_C}');
  insert into public.pere_itens values
    ('${A}','P-A','P A','${TARGET_A}'),('${B}','P-B','P B','${TARGET_A}'),('${C}','P-C','P C','${TARGET_C}');
  insert into public.pere_regs values
    ('reg-a','${A}','P-A','S-A',current_date,null,null,null,'FLV','${TARGET_A}'),
    ('reg-b','${B}','P-B','S-B',current_date,null,null,null,'FLV','${TARGET_A}'),
    ('reg-c','${C}','P-C','S-C',current_date,null,null,null,'FLV','${TARGET_C}');
  insert into public.ajustes(loja_id) values ('${A}'),('${B}'),('${C}');
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao) values
    ('${TARGET_A}','Alvo A','operador','${A}','Loja A','a'),
    ('${TARGET_C}','Alvo C','operador','${C}','Loja C','c'),
    ('${MANAGER_A}','Gerente A','gerente',null,null,'global');

  alter table public.lojas enable row level security;
  alter table public.loja_membros enable row level security;
  alter table public.perfis enable row level security;
  alter table public.produtos enable row level security;
  alter table public.lotes enable row level security;
  alter table public.pere_itens enable row level security;
  alter table public.pere_regs enable row level security;
  alter table public.ajustes enable row level security;
  alter table public.auditoria enable row level security;
  alter table public.notificacoes enable row level security;

  create policy produtos_sel on public.produtos for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy produtos_ins on public.produtos for insert to authenticated with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy produtos_upd on public.produtos for update to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id)) with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy lotes_sel on public.lotes for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy lotes_ins on public.lotes for insert to authenticated with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy lotes_upd on public.lotes for update to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id)) with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_itens_sel on public.pere_itens for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_itens_ins on public.pere_itens for insert to authenticated with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_itens_upd on public.pere_itens for update to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id)) with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_regs_sel on public.pere_regs for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_regs_ins on public.pere_regs for insert to authenticated with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy pere_regs_upd on public.pere_regs for update to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id)) with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy ajustes_sel on public.ajustes for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy ajustes_ins on public.ajustes for insert to authenticated with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy ajustes_upd on public.ajustes for update to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id)) with check (private.tem_escopo_global() or private.membro_da(loja_id));
  create policy lojas_sel on public.lojas for select to authenticated using (private.tem_escopo_global() or private.membro_da(id));
  create policy lojas_ins on public.lojas for insert to authenticated with check (private.meu_papel()='admin');
  create policy lojas_upd on public.lojas for update to authenticated using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
  create policy lojas_del on public.lojas for delete to authenticated using (private.meu_papel()='admin');
  create policy loja_membros_sel on public.loja_membros for select to authenticated using (user_id=auth.uid() or private.tem_escopo_global());
  create policy loja_membros_ins on public.loja_membros for insert to authenticated with check (private.meu_papel()='admin');
  create policy loja_membros_upd on public.loja_membros for update to authenticated using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
  create policy loja_membros_del on public.loja_membros for delete to authenticated using (private.meu_papel()='admin');
  create policy perfis_sel on public.perfis for select to authenticated using (id=auth.uid() or private.tem_permissao('usuarios_gerenciar'));
  create policy perfis_upd on public.perfis for update to authenticated using (private.tem_permissao('usuarios_gerenciar')) with check (private.tem_permissao('usuarios_gerenciar'));
  create policy auditoria_sel on public.auditoria for select to authenticated using (private.tem_permissao('auditoria_ver'));
  create policy notificacoes_sel_own_store on public.notificacoes for select to authenticated using (user_id=auth.uid() and (private.membro_da(loja_id) or private.tem_escopo_global()));
  create policy notificacoes_upd_own_store on public.notificacoes for update to authenticated using (user_id=auth.uid() and private.membro_da(loja_id)) with check (user_id=auth.uid() and private.membro_da(loja_id));

  grant usage on schema public,auth,private to authenticated,service_role;
  grant select,insert,update,delete on public.lojas,public.loja_membros to authenticated;
  grant select,insert,update on public.produtos,public.lotes,public.pere_itens,public.pere_regs,public.ajustes,public.perfis,public.auditoria,public.notificacoes to authenticated;
  grant all on all tables in schema public to service_role;
`;

let db;
before(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
});
after(async () => { if (db) await db.close(); });

async function actor(id) {
  await db.exec('set role authenticated');
  await db.query("select set_config('test.uid',$1,false), set_config('test.role','authenticated',false)", [id]);
}
async function serviceActor() {
  await db.exec('set role service_role');
  await db.query("select set_config('test.uid',$1,false), set_config('test.role','service_role',false)", [ADMIN]);
}
async function ownerQuery(sql, params = []) {
  await db.exec('reset role');
  return db.query(sql, params);
}
async function ownerExec(sql, params = []) {
  await db.exec('reset role');
  return db.query(sql, params);
}
async function ids(sql, params = []) {
  return (await db.query(sql, params)).rows.map(row =>
    row.id !== undefined ? row.id : row.loja_id !== undefined ? row.loja_id : row.user_id
  );
}
async function notificationStoreIds(userId, asOwner = false) {
  const query = 'select distinct loja_id from public.notificacoes where user_id=$1 and loja_id is not null order by loja_id';
  const result = asOwner ? await ownerQuery(query, [userId]) : await db.query(query, [userId]);
  return result.rows.map(row => row.loja_id);
}
function jsonResult(row, column) {
  const value = row[column];
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function loadScopeHelper() {
  const module = { exports: {} };
  new Function('module', `${scopeSource}\nmodule.exports = { resolveListScope, buildScopedUserList };`)(module);
  return module.exports;
}

 test('PGlite: Gerente A vê/escreve apenas A+B e não vê C, auditoria global ou memberships de terceiros', async () => {
  await actor(MANAGER_A);
  assert.equal((await db.query('select private.tem_escopo_global() as global')).rows[0].global, false);
  assert.deepEqual(await ids('select id from public.lojas order by id'), [A, B]);
  assert.deepEqual(await ids('select loja_id from public.lotes order by loja_id'), [A, B]);
  assert.deepEqual(await ids('select loja_id from public.ajustes order by loja_id'), [A, B]);
  assert.deepEqual(await ids('select distinct loja_id from public.loja_membros order by loja_id'), [A, B]);
  assert.deepEqual(await ids('select id from public.perfis order by id'), [MANAGER_A, MANAGER_B, TARGET_A]);
  assert.deepEqual(await ids('select loja_id from public.auditoria order by loja_id nulls last'), [A]);
  await db.query("insert into public.lotes(id,loja_id,ean,lote,val,created_by) values('new-a',$1,'E','A',current_date,$2)", [A, MANAGER_A]);
  await assert.rejects(db.query("insert into public.lotes(id,loja_id,ean,lote,val,created_by) values('new-c',$1,'E','C',current_date,$2)", [C, MANAGER_A]), /row-level security|policy/i);
  await db.query("update public.lotes set lote='A2' where id='lot-a'");
  await db.query("update public.lotes set lote='C2' where id='lot-c'");
  await db.exec('reset role');
  assert.equal((await db.query("select lote from public.lotes where id='lot-c'")).rows[0].lote, 'C');
});

test('PGlite: Gerente B compartilha B, gerente sem vínculo fica sem exposição e helper/API não forja loja', async () => {
  await actor(MANAGER_B);
  assert.deepEqual(await ids('select id from public.lojas order by id'), [B]);
  assert.deepEqual(await ids('select loja_id from public.produtos order by loja_id'), [B]);
  assert.deepEqual(await ids('select id from public.perfis order by id'), [MANAGER_A, MANAGER_B]);
  await actor(MANAGER_NONE);
  assert.deepEqual(await ids('select id from public.lojas order by id'), []);
  assert.deepEqual(await ids('select loja_id from public.lotes order by loja_id'), []);
  assert.deepEqual(await ids('select id from public.perfis order by id'), [MANAGER_NONE]);
  assert.deepEqual(await ids('select loja_id from public.auditoria'), []);

  const { resolveListScope, buildScopedUserList } = loadScopeHelper();
  const base = {
    permitidas: new Set([A, B]),
    perfis: [
      { id: MANAGER_A, nome: 'Gerente A', papel: 'gerente' },
      { id: TARGET_A, nome: 'Alvo A', papel: 'operador' },
      { id: TARGET_C, nome: 'Alvo C', papel: 'operador' },
      { id: UNATTACHED, nome: 'Sem Loja', papel: 'operador' },
    ],
    membros: [
      { user_id: MANAGER_A, loja_id: A }, { user_id: MANAGER_A, loja_id: B },
      { user_id: TARGET_A, loja_id: A }, { user_id: TARGET_C, loja_id: C },
    ],
    lojas: [{ id: A, nome: 'Loja A' }, { id: B, nome: 'Loja B' }, { id: C, nome: 'Loja C' }],
    emailPorId: { [MANAGER_A]: 'gerente-a@loja.validade', [TARGET_A]: 'alvo-a@loja.validade' },
    escopoTotal: false,
  };
  const all = resolveListScope({ acao: 'listar', escopo: 'todas' });
  const result = buildScopedUserList({ ...base, scope: all.scope });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.lojas.map(loja => loja.id), [A, B]);
  assert.deepEqual(result.data.usuarios.map(user => user.id), [TARGET_A, MANAGER_A]);
  assert.equal(resolveListScope({ acao: 'listar', loja_id: C }).ok, true);
  assert.equal(buildScopedUserList({ ...base, scope: { kind: 'specific', lojaId: C } }).ok, false);
  assert.equal(buildScopedUserList({ ...base, scope: { kind: 'legacy' } }).data.usuarios.some(user => user.id === UNATTACHED), false);
});

test('PGlite real: gerar_alertas_validade respeita overrides e nunca globaliza Gerente', async () => {
  await serviceActor();
  const result = jsonResult((await db.query('select public.gerar_alertas_validade()')).rows[0], 'gerar_alertas_validade');
  assert.ok(Array.isArray(result));

  const byUser = (await ownerQuery(`
    select user_id, array_agg(distinct loja_id order by loja_id) as lojas
      from public.notificacoes
     where tipo in ('validade_vencida','validade_proxima')
     group by user_id
  `)).rows;
  const stores = (userId) => byUser.find(row => row.user_id === userId)?.lojas || [];
  assert.deepEqual(stores(MANAGER_A), [A, B]);
  assert.deepEqual(stores(MANAGER_B), [B]);
  assert.deepEqual(stores(MANAGER_NONE), []);
  assert.deepEqual(stores(ANALYST), []);
  assert.deepEqual(stores(UNATTACHED), [A, B, C]);

  await actor(MANAGER_A);
  assert.deepEqual(await notificationStoreIds(MANAGER_A), [A, B]);
  await actor(UNATTACHED);
  assert.deepEqual(await notificationStoreIds(UNATTACHED), [A, B, C]);
});

test('PGlite real: preparar/reivindicar pessoal e interno bloqueiam C para Gerente A, marcam antigos como dead e preservam rows', async () => {
  await serviceActor();
  await ownerExec(`
    insert into public.lotes(id,loja_id,ean,lote,val,deleted_at,recolhido_em,setor,created_by)
    values ('lot-push-a',$1,'EAN-A','PA',current_date+1,null,null,'FLV',$2),
           ('lot-push-c',$3,'EAN-C','PC',current_date+1,null,null,'FLV',$4)
  `, [A, TARGET_A, C, TARGET_C]);
  await ownerExec(`insert into public.alertas_regras(id,user_id,dias,hora_local,fuso,ativo)
    values ($1,$2,1,'00:00','UTC',true)`, [RULE_A, MANAGER_A]);
  await ownerExec(`insert into public.alertas_push_outbox(
      id,regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload,status
    ) values ($1,$2,$3,$4,'lot-c','lote',current_date,current_date,'antigo','antigo','{}','pending')`,
    [OUTBOX_FOREIGN, RULE_A, MANAGER_A, C]);

  await serviceActor();
  await db.query('select public.preparar_alertas_push()');
  let old = (await ownerQuery('select id,status,last_error from public.alertas_push_outbox where id=$1', [OUTBOX_FOREIGN])).rows[0];
  assert.equal(old.status, 'dead');
  assert.match(old.last_error, /sem vínculo/i);
  assert.equal((await ownerQuery('select count(*)::int as n from public.alertas_push_outbox where id=$1', [OUTBOX_FOREIGN])).rows[0].n, 1);

  const claimed = (await db.query('select * from public.reivindicar_alertas_push(100)')).rows;
  assert.ok(claimed.some(row => row.user_id === MANAGER_A && row.loja_id === A));
  assert.equal(claimed.some(row => row.user_id === MANAGER_A && row.loja_id === C), false);

  await ownerExec(`insert into public.alertas_push_outbox(
      id,regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload,status
    ) values ($1,$2,$3,$4,'lot-push-c','lote',current_date+1,current_date,'direto','direto','{}','pending')`,
    [OUTBOX_DIRECT_FOREIGN, RULE_A, MANAGER_A, C]);
  await serviceActor();
  assert.deepEqual((await db.query('select * from public.reivindicar_alertas_push(100)')).rows, []);
  assert.equal((await ownerQuery('select status from public.alertas_push_outbox where id=$1', [OUTBOX_DIRECT_FOREIGN])).rows[0].status, 'pending');

  await ownerExec(`
    insert into public.notificacoes(id,user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
    values ($1,$2,$3,'internal-foreign','validade_proxima','C','C','{}'),
           ($4,$5,$6,'internal-member','validade_proxima','A','A','{}')
  `, [NOTIF_FOREIGN, MANAGER_A, C, NOTIF_MEMBER, MANAGER_A, A]);
  await ownerExec("update public.ajustes set push_interno=true,push_interno_desde=now()-interval '1 day' where loja_id in ($1,$2)", [A, C]);
  await ownerExec(`insert into public.alertas_push_internos_outbox(
      id,notificacao_id,user_id,loja_id,titulo,mensagem,payload,status
    ) values ($1,$2,$3,$4,'antigo C','antigo C','{}','pending')`,
    [INTERNAL_FOREIGN, NOTIF_FOREIGN, MANAGER_A, C]);

  await serviceActor();
  await db.query('select public.preparar_alertas_push_internos()');
  const oldInternal = (await ownerQuery('select id,status from public.alertas_push_internos_outbox where id=$1', [INTERNAL_FOREIGN])).rows[0];
  assert.equal(oldInternal.status, 'dead');
  assert.equal((await ownerQuery('select count(*)::int as n from public.alertas_push_internos_outbox where id=$1', [INTERNAL_FOREIGN])).rows[0].n, 1);
  const internalClaimed = (await db.query('select * from public.reivindicar_alertas_push_internos(100)')).rows;
  assert.ok(internalClaimed.some(row => row.user_id === MANAGER_A && row.loja_id === A));
  assert.equal(internalClaimed.some(row => row.user_id === MANAGER_A && row.loja_id === C), false);
});

test('PGlite real: alerta personalizado recusa loja estrangeira e deduplica recipients com permissão global', async () => {
  await actor(MANAGER_A);
  const before = (await ownerQuery("select count(*)::int as n from public.notificacoes where tipo='sistema_personalizado'", [])).rows[0].n;
  await assert.rejects(
    db.query('select public.enviar_alerta_personalizado($1,$2,$3,$4)', ['Foreign', 'Foreign body', C, null]),
    /Sem acesso à loja|42501|row-level security/i
  );
  const after = (await ownerQuery("select count(*)::int as n from public.notificacoes where tipo='sistema_personalizado'", [])).rows[0].n;
  assert.equal(after, before);

  await actor(ADMIN);
  const allRow = (await db.query('select public.enviar_alerta_personalizado($1,$2,$3,$4)', ['All', 'All body', null, null])).rows[0];
  const all = jsonResult(allRow, 'enviar_alerta_personalizado');
  assert.equal(all.destinatarios, 7);
  const grouped = (await ownerQuery(`
    select user_id,count(*)::int as n
      from public.notificacoes
     where tipo='sistema_personalizado' and payload->>'envio_id'=$1
     group by user_id order by user_id
  `, [all.envio_id])).rows;
  assert.equal(grouped.length, 7);
  assert.ok(grouped.every(row => row.n === 1));
  assert.equal(grouped.some(row => row.user_id === MANAGER_NONE), false);

  const operatorRow = (await db.query('select public.enviar_alerta_personalizado($1,$2,$3,$4)', ['Ops', 'Ops body', A, 'operador'])).rows[0];
  const operator = jsonResult(operatorRow, 'enviar_alerta_personalizado');
  assert.equal(operator.destinatarios, 4);
  const operatorUsers = (await ownerQuery(`
    select distinct user_id from public.notificacoes
     where tipo='sistema_personalizado' and payload->>'envio_id'=$1 order by user_id
  `, [operator.envio_id])).rows.map(row => row.user_id);
  assert.deepEqual(operatorUsers, [TARGET_A, TARGET_C, TARGET_EXTRA, UNATTACHED].sort());
  assert.equal(operatorUsers.includes(ADMIN), false);
});

test('PGlite: policies preservam bypasses não-Gerente e limitam CRUD direto de loja/membership e edição de papel', async () => {
  await actor(MANAGER_A);
  await assert.rejects(
    db.query("insert into public.lojas(id,nome) values($1,'Fora')", ['90000000-0000-4000-8000-000000000001']),
    /row-level security|policy/i
  );
  assert.equal((await db.query('update public.lojas set nome=$1 where id=$2', ['não deve', C])).affectedRows, 0);
  assert.equal((await db.query('delete from public.lojas where id=$1', [C])).affectedRows, 0);

  await db.query('insert into public.loja_membros(user_id,loja_id) values($1,$2)', [TARGET_EXTRA, A]);
  assert.deepEqual(await ids('select user_id from public.loja_membros where loja_id=$1 order by user_id', [A]), [MANAGER_A, TARGET_A, TARGET_EXTRA]);
  await db.query('delete from public.loja_membros where user_id=$1 and loja_id=$2', [TARGET_EXTRA, A]);
  await assert.rejects(
    db.query('insert into public.loja_membros(user_id,loja_id) values($1,$2)', [MANAGER_B, A]),
    /row-level security|policy/i
  );
  await assert.rejects(
    db.query('insert into public.loja_membros(user_id,loja_id) values($1,$2)', [ADMIN, A]),
    /row-level security|policy/i
  );
  await db.query('update public.lojas set nome=$1 where id=$2', ['Loja A editada', A]);

  await actor(ANALYST);
  assert.deepEqual(await ids('select id from public.perfis order by id'), [ANALYST]);
  await actor(MANAGER_A);
  await db.query('update public.perfis set nome=$1 where id=$2', ['Alvo A editado', TARGET_A]);
  await assert.rejects(
    db.query('update public.perfis set papel=$1 where id=$2', ['gerente', TARGET_A]),
    /row-level security|policy/i
  );
  assert.equal((await db.query('update public.perfis set nome=$1 where id=$2', ['não deve', MANAGER_B])).affectedRows, 0);
});

test('helper/API e contrato: escopo global pertence a papel mais permissões não reabrem global de Gerente', () => {
  assert.match(migration, /private\.meu_papel\(\) = any\(array\['analista','admin'\]\)/);
  assert.match(migration, /public\.papel_tem_permissao\(p\.papel,'avisos_todas_lojas'\)/);
  assert.match(migration, /p\.papel <> 'gerente'/);
  assert.match(migration, /private\.usuario_tem_papel/);
  assert.match(migration, /grant usage on schema private to authenticated, service_role/);
  assert.match(migration, /Destinatário sem vínculo ativo na loja/);
  assert.match(migration, /loja_id is null/);
  assert.match(migration, /private\.tem_permissao\('usuarios_gerenciar'\)[\s\S]*public\.loja_membros/);
  assert.doesNotMatch(migration, /p\.papel in \('analista','gerente','admin'\)/);
  assert.doesNotMatch(migration, /pf\.papel in \('analista','gerente','admin'\)/);
  assert.match(usersEdge, /const escopoTotal = ehAdmin \|\| ehAnalista/);
  assert.match(usersEdge, /const podeCriar = !ehOperador && \(ehAdmin \|\| gerenciaUsuarios/);
  assert.match(usersEdge, /if \(error\) throw error/);
  assert.match(alertsEdge, /papelTemEscopoGlobal/);
  assert.match(alertsEdge, /escopo\.ids/);
  assert.match(alertsEdge, /global !== true/);
});
