const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const SQL = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112121000_acoes_registros_ids_texto_auditadas.sql'), 'utf8');
const ADMIN='00000000-0000-4000-8000-000000000001', OP='00000000-0000-4000-8000-000000000002';
const S05='10000000-0000-4000-8000-000000000005', S15='10000000-0000-4000-8000-000000000015';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key,email text);
    create table public.perfis(id uuid primary key references auth.users(id),nome text,papel text);
    create table public.lojas(id uuid primary key,nome text);
    create table public.loja_membros(loja_id uuid,user_id uuid,primary key(loja_id,user_id));
    create table public.lotes(id text primary key,loja_id uuid,ean text,lote text,qtd integer,val date,deleted_at timestamptz,recolhido_em timestamptz,recolhido_por uuid);
    create table public.pere_regs(id text primary key,loja_id uuid,cod text,peso numeric,val date,deleted_at timestamptz,recolhido_em timestamptz,recolhido_por uuid);
    create table public.auditoria(id bigint generated always as identity,user_id uuid,usuario text,papel text,loja_id uuid,loja_nome text,acao text,detalhe jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
    create function public.papel_tem_permissao(p_papel text,p_permissao text) returns boolean language sql stable as $$select p_papel in ('admin','analista','gerente')$$;
    create function private.meu_papel() returns text language sql stable security definer set search_path='' as $$select papel from public.perfis where id=auth.uid()$$;
    create function private.membro_da(loja uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.loja_membros where user_id=auth.uid() and loja_id=loja)$$;
    create function private.tem_escopo_global() returns boolean language sql stable security definer set search_path='' as $$select coalesce(private.meu_papel() in ('admin','gerente','analista'),false)$$;
    create function private.tem_permissao(p_permissao text) returns boolean language sql stable security definer set search_path='' as $$select private.meu_papel()='admin' or coalesce(nullif(current_setting('test.recolher',true),''),'true')::boolean$$;
    create function public.marcar_registro_recolhido(text,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.restaurar_registro_recolhido(text,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function private.audit_failure_test() returns trigger language plpgsql as $$begin if current_setting('test.fail_audit',true)='true' then raise exception 'falha de auditoria simulada'; end if;return new;end$$;
    create trigger audit_failure before insert on public.auditoria for each row execute function private.audit_failure_test();
    insert into auth.users values('${ADMIN}','admin-ficticio@example.invalid'),('${OP}','operador-ficticio@example.invalid');
    insert into public.perfis values('${ADMIN}','Admin Banco','admin'),('${OP}','Operador Banco','operador');
    insert into public.lojas values('${S05}','Filial 05'),('${S15}','Filial 15');
    insert into public.loja_membros values('${S05}','${OP}');
    grant usage on schema public,private,auth to anon,authenticated,service_role;
  `);
  await db.exec(SQL);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261113121825_recolhimento_sem_janela.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261112120000_edicao_usuarios_atomica.sql'),'utf8'));
  await db.exec("insert into auth.users values ('00000000-0000-4000-8000-000000000003','gerente@example.invalid'),('00000000-0000-4000-8000-000000000004','alvo@example.invalid');insert into public.perfis values ('00000000-0000-4000-8000-000000000003','Gerente Banco','gerente'),('00000000-0000-4000-8000-000000000004','Nome Anterior','operador');insert into public.loja_membros values ('"+S05+"','00000000-0000-4000-8000-000000000003'),('"+S05+"','00000000-0000-4000-8000-000000000004'),('"+S15+"','00000000-0000-4000-8000-000000000004');");
});
after(async () => { if(db)await db.close(); });
async function actor(id,permission=true) {
  await db.query("select set_config('test.uid',$1,false),set_config('test.recolher',$2,false),set_config('test.fail_audit','false',false)",[id,String(permission)]);
}
async function lot(id,days=2,store=S05) {
  await db.query("insert into public.lotes(id,loja_id,ean,lote,qtd,val) values($1,$2,'7890000000001','L',3,(now() at time zone 'America/Sao_Paulo')::date+$3::integer)",[id,store,days]);
}
async function recall(id,store=S05) {return (await db.query('select public.marcar_registro_recolhido($1,$2,$3) as data',['lote',id,store])).rows[0].data;}

test('PostgreSQL: migration elimina sobrecargas UUID ambíguas e usa uma assinatura textual por RPC', async () => {
  const rows=(await db.query("select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('marcar_registro_recolhido','restaurar_registro_recolhido') order by p.proname limit 10")).rows;
  assert.equal(rows.length,2);
  for(const r of rows)assert.equal(r.args,'p_tipo text, p_id text, p_loja_id uuid');
});

test('PostgreSQL: operador recolhe ID base36 da própria loja e Administrador o reativa', async () => {
  await actor(OP);await lot('mwdj665uqtd0');
  assert.equal((await recall('mwdj665uqtd0')).ja_recolhido,false);
  assert.equal((await recall('mwdj665uqtd0')).ja_recolhido,true);
  await assert.rejects(db.query('select public.restaurar_registro_recolhido($1,$2,$3)',['lote','mwdj665uqtd0',S05]),/Somente assistente/);
  await actor(ADMIN);
  assert.equal((await db.query('select public.restaurar_registro_recolhido($1,$2,$3) as data',['lote','mwdj665uqtd0',S05])).rows[0].data.reativado,true);
});

test('PostgreSQL: UUID legado armazenado como texto continua aceito no mesmo payload', async () => {
  const id='30000000-0000-4000-8000-000000000001';await actor(OP);await lot(id);
  assert.equal((await recall(id)).id,id);
});

test('PostgreSQL: ID textual de perecível também funciona e preserva o registro', async () => {
  await actor(OP);
  await db.query("insert into public.pere_regs(id,loja_id,cod,peso,val) values('pere-base36',$1,'P001',1.5,(now() at time zone 'America/Sao_Paulo')::date+2)",[S05]);
  assert.equal((await db.query('select public.marcar_registro_recolhido($1,$2,$3) as data',['perecivel','pere-base36',S05])).rows[0].data.id,'pere-base36');
  assert.equal((await db.query("select deleted_at from public.pere_regs where id='pere-base36'")).rows[0].deleted_at,null);
});

test('PostgreSQL: permissão desligada e loja não atribuída são recusadas antes de alterar o registro', async () => {
  await lot('perm-negada');await actor(OP,false);
  await assert.rejects(recall('perm-negada'),/não tem permissão/);
  await lot('outra-filial',2,S15);await actor(OP);
  await assert.rejects(recall('outra-filial',S15),/Sem acesso à loja/);
  assert.equal((await db.query("select count(*)::integer n from public.lotes where id in ('perm-negada','outra-filial') and recolhido_em is not null")).rows[0].n,0);
});

test('PostgreSQL: recolhe registros ativos independentemente da validade e preserva a retenção', async () => {
  await actor(OP);
  for (const [id, dias] of [['vencido', -5], ['longe', 30], ['vence-hoje', 0], ['fora-da-retencao', -6]]) await lot(id, dias);
  await assert.rejects(recall('fora-da-retencao'), /retenção operacional/);
  for (const id of ['vencido', 'longe', 'vence-hoje']) assert.equal((await recall(id)).ja_recolhido, false);
  await lot('sem-data');
  await db.exec("update public.lotes set val=null where id='sem-data'");
  assert.equal((await recall('sem-data')).ja_recolhido, false);
  await actor(ADMIN);
  const resultado = await db.query('select public.restaurar_registro_recolhido($1,$2,$3) as data', ['lote', 'sem-data', S05]);
  assert.equal(resultado.rows[0].data.reativado, true);
});

test('PostgreSQL: exclusão é exclusiva do Administrador e audita nome do banco na filial real', async () => {
  await lot('deletar-base36',2,S15);await actor(OP);
  await assert.rejects(db.query('select public.admin_excluir_registro_auditado($1,$2,$3)',['lote','deletar-base36',S15]),/Somente o Administrador/);
  await actor(ADMIN);
  const result=(await db.query('select public.admin_excluir_registro_auditado($1,$2,$3) data',['lote','deletar-base36',S15])).rows[0].data;
  assert.equal(result.excluido,true);assert.equal(result.auditado,true);
  const audit=(await db.query("select user_id,usuario,papel,loja_id,loja_nome from public.auditoria where detalhe->>'registro_id'='deletar-base36' and acao='admin_exclusao_tombstone' limit 2")).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].usuario,'Admin Banco');assert.equal(audit[0].user_id,ADMIN);assert.equal(audit[0].loja_id,S15);assert.equal(audit[0].loja_nome,'Filial 15');
});

test('PostgreSQL: falha de auditoria faz rollback do tombstone na mesma transação', async () => {
  await actor(ADMIN);await lot('rollback-audit');
  await db.query("select set_config('test.fail_audit','true',false)");
  await assert.rejects(db.query('select public.admin_excluir_registro_auditado($1,$2,$3)',['lote','rollback-audit',S05]),/falha de auditoria simulada/);
  await db.query("select set_config('test.fail_audit','false',false)");
  assert.equal((await db.query("select deleted_at from public.lotes where id='rollback-audit'")).rows[0].deleted_at,null);
  assert.equal((await db.query("select count(*)::integer n from public.auditoria where detalhe->>'registro_id'='rollback-audit'")).rows[0].n,0);
});

test('PostgreSQL: anon não pode executar o RPC de exclusão nem as RPCs de recolhimento', async () => {
  await actor(ADMIN);await db.exec('set role anon');
  try {
    await assert.rejects(db.query('select public.admin_excluir_registro_auditado($1,$2,$3)',['lote','rollback-audit',S05]),/permission denied/);
    await assert.rejects(recall('vence-hoje'),/permission denied/);
  } finally { await db.exec('reset role'); }
});

const TARGET='00000000-0000-4000-8000-000000000004', MANAGER='00000000-0000-4000-8000-000000000003';
async function serviceRole() {
  await db.query("select set_config('test.role','service_role',false),set_config('test.uid','',false),set_config('test.fail_audit','false',false)");
}
async function editUser(actorId,name,stores,role='operador') {
  return (await db.query('select public.editar_usuario_atomico($1,$2,$3,$4,$5,$6) data',[actorId,TARGET,name,role,stores,false])).rows[0].data;
}

test('PostgreSQL: cadastro, vínculos e auditoria de usuário são confirmados juntos', async () => {
  await serviceRole();const result=await editUser(ADMIN,'Nome Atualizado',[S05]);
  assert.equal(result.cadastro_atualizado,true);assert.equal(result.auditoria_registrada,true);
  assert.deepEqual(result.lojas,[S05]);
  assert.equal((await db.query('select nome from public.perfis where id=$1',[TARGET])).rows[0].nome,'Nome Atualizado');
  assert.equal((await db.query("select usuario from public.auditoria where detalhe->>'alvo_id'=$1 and acao='editou_usuario' order by id desc limit 1",[TARGET])).rows[0].usuario,'Admin Banco');
});

test('PostgreSQL: gerente mantém vínculo externo do alvo e não cria Assistente com duas lojas', async () => {
  await serviceRole();await db.query('insert into public.loja_membros(loja_id,user_id) values($1,$2)',[S15,TARGET]);
  const result=await editUser(MANAGER,'Nome no Grupo',[S05]);
  assert.deepEqual(result.lojas,[S05,S15]);
  await assert.rejects(editUser(MANAGER,'Não deve mudar',[S05],'assistente'),/Assistente exige exatamente uma loja/);
  const row=(await db.query('select nome,papel from public.perfis where id=$1',[TARGET])).rows[0];
  assert.equal(row.nome,'Nome no Grupo');assert.equal(row.papel,'operador');
});

test('PostgreSQL: loja inválida e falha de auditoria não deixam perfil ou vínculos parcialmente alterados', async () => {
  await serviceRole();
  await assert.rejects(editUser(ADMIN,'Nome Inválido',['10000000-0000-4000-8000-000000000099']),/Loja inexistente/);
  await db.query("select set_config('test.fail_audit','true',false)");
  await assert.rejects(editUser(ADMIN,'Nome Rollback',[S05]),/falha de auditoria simulada/);
  await db.query("select set_config('test.fail_audit','false',false)");
  assert.equal((await db.query('select nome from public.perfis where id=$1',[TARGET])).rows[0].nome,'Nome no Grupo');
  assert.equal((await db.query('select count(*)::integer n from public.loja_membros where user_id=$1',[TARGET])).rows[0].n,2);
});

test('PostgreSQL: não rebaixa o último Administrador', async () => {
  await serviceRole();
  await assert.rejects(db.query('select public.editar_usuario_atomico($1,$2,null,$3,null,false)',[ADMIN,ADMIN,'gerente']),/último admin/);
  assert.equal((await db.query('select papel from public.perfis where id=$1',[ADMIN])).rows[0].papel,'admin');
});

test('PostgreSQL: authenticated não pode chamar RPC de edição de usuário passando um ator Admin forjado', async () => {
  await serviceRole();await db.exec('set role authenticated');
  try { await assert.rejects(editUser(ADMIN,'Nome Forjado',[S05]),/permission denied/); }
  finally { await db.exec('reset role'); }
});

test('PostgreSQL: setor é salvo, preservado em edições legadas e pode ser removido', async () => {
  await serviceRole();
  await db.exec(`
    alter table public.perfis add constraint perfis_papel_check check (papel in ('operador','assistente','analista','gerente','admin'));
    create policy perfis_upd on public.perfis for update to authenticated using (false);
    create table public.papel_permissoes(papel text, permissao text, permitido boolean);
    create function private.permissao_padrao(text,text) returns boolean language sql as $$select false$$;
    create function private.usuario_no_escopo(uuid) returns boolean language sql as $$select false$$;
    create function public.enviar_alerta_personalizado(text,text,uuid,text) returns boolean language sql as
      $$select $4 in ('operador','assistente','analista','gerente','admin')$$;
    create function public.salvar_foto_catalogo(text,uuid,text,uuid,text) returns boolean language sql as
      $$select $5 in ('operador','assistente','analista','gerente','admin')$$;
  `);
  for (const migration of [
    '20261112150000_hierarquia_promocao_usuarios',
    '20261112160000_hierarquia_assistente_operador',
    '20261114093337_perfil_promotor',
    '20261114103700_setor_perfil',
  ]) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', migration + '.sql'), 'utf8'));
  }
  const editarSetor = (setor) => db.query('select public.editar_usuario_atomico($1,$2,null,null,null,false,null,$3)', [ADMIN, TARGET, setor]);
  const setorAtual = async () => (await db.query('select setor from public.perfis where id=$1', [TARGET])).rows[0].setor;
  await editarSetor('  Mercearia  ');
  assert.equal(await setorAtual(), 'Mercearia');
  await editUser(ADMIN, 'Nome Atualizado', null);
  assert.equal(await setorAtual(), 'Mercearia');
  await assert.rejects(editarSetor('a'.repeat(121)), /perfis_setor_check/);
  assert.equal(await setorAtual(), 'Mercearia');
  await editarSetor('');
  assert.equal(await setorAtual(), null);
});
