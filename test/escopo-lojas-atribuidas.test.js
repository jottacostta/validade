/* Escopo por loja atribuída (16/11/2026): só o Administrador é global.
   Assistente, Analista e Gerente enxergam somente as lojas atribuídas. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const migration = ler('supabase/migrations/20261116180000_escopo_lojas_atribuidas.sql');

test('Edge Functions e app tratam só o Administrador como global', () => {
  const usuarios = ler('supabase/functions/gerir-usuarios/index.ts');
  const alertas = ler('supabase/functions/alertas/index.ts');
  const app = ler('src/app.html');
  assert.match(usuarios, /const escopoTotal = ehAdmin;/);
  assert.doesNotMatch(usuarios, /papelCaller === "analista"\) \{/);
  assert.doesNotMatch(usuarios, /ehAnalista/);
  assert.match(alertas, /function papelTemEscopoGlobal\(papel: string\): boolean \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*return papel === "admin";/);
  assert.match(app, /var global=papelAtual\(\)==='admin';\s*\$\('apLoja'\)/);
  assert.doesNotMatch(app, /id:'avisos_todas_lojas'/);
});

test('Escopo por loja atribuída no banco (PGlite)', async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); } catch (e) { return; }
  const db = new PGlite();
  const L1 = '00000000-0000-0000-0000-000000000001', L2 = '00000000-0000-0000-0000-000000000002';
  const U = n => '00000000-0000-0000-0000-0000000000' + String(n).padStart(2, '0');
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create table public.perfis(id uuid primary key, papel text, nome text);
      create table public.lojas(id uuid primary key, nome text);
      create table public.loja_membros(user_id uuid, loja_id uuid, primary key(user_id, loja_id));
      create table public.papel_permissoes(papel text, permissao text, permitido boolean, atualizado_em timestamptz, atualizado_por uuid, primary key(papel, permissao));
      create table public.auditoria(user_id uuid, usuario text, papel text, loja_id uuid, loja_nome text, acao text, detalhe jsonb);
      create table public.solicitacoes_nome(id uuid primary key, loja_id uuid, solicitante_id uuid, status text, ean text, nome_atual text, nome_sugerido text, revisor_id uuid, resposta text, revisado_em timestamptz);
      create function private.meu_papel() returns text language sql stable security definer set search_path='' as $$ select papel from public.perfis where id=auth.uid() $$;
      create function private.membro_da(loja uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
      declare v_papel text; v_total integer;
      begin
        v_papel := private.meu_papel();
        if v_papel='assistente' then
          select count(*) into v_total from public.loja_membros where user_id=auth.uid();
          if v_total <> 1 then return false; end if;
        end if;
        return exists(select 1 from public.loja_membros m where m.loja_id=loja and m.user_id=auth.uid());
      end $$;
      create function private.usuario_tem_papel(u uuid, p text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.perfis where id=u and papel=p) $$;
      create function private.tem_escopo_global() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(private.meu_papel() = any(array['analista','admin']), false) $$;
      create function private.permissao_padrao(p_papel text, p_permissao text) returns boolean language sql immutable as $$ select p_permissao in ('usuarios_gerenciar','avisos_todas_lojas','nome_editar') and p_papel in ('analista','gerente','assistente') $$;
      create function public.papel_tem_permissao(p_papel text, p_permissao text) returns boolean language sql stable security definer set search_path='' as $$
        select case when p_papel='admin' then true else coalesce((select permitido from public.papel_permissoes where papel=p_papel and permissao=p_permissao), private.permissao_padrao(p_papel,p_permissao)) end $$;
      create function private.tem_permissao(p text) returns boolean language sql stable security definer set search_path='' as $$ select public.papel_tem_permissao(private.meu_papel(), p) $$;
      create function public.definir_permissao_papel(p_papel text, p_permissao text, p_permitido boolean) returns void language plpgsql security definer set search_path='' as $$
      begin
        if p_permissao is null or p_permissao not in (
          'registrar','alertas_loja_configurar','avisos_todas_lojas','lojas_gerenciar') then
          raise exception 'Permissão inválida';
        end if;
        insert into public.papel_permissoes(papel,permissao,permitido) values (p_papel,p_permissao,p_permitido)
        on conflict (papel,permissao) do update set permitido=excluded.permitido;
      end $$;
      create function public.editar_usuario_atomico(p_actor_id uuid, p_target_id uuid) returns text language plpgsql security definer set search_path='' as $$
      declare v_actor_papel text;
      begin
        select papel into v_actor_papel from public.perfis where id=p_actor_id;
        if v_actor_papel in ('admin','analista') then return 'global'; end if;
        return 'membership';
      end $$;
      create function public.revisar_correcao_nome(p_id uuid, p_aprovar boolean, p_resposta text default null) returns void language plpgsql security definer set search_path='' as $$
      declare r public.solicitacoes_nome%rowtype;
      begin
        select * into r from public.solicitacoes_nome where id = p_id for update;
        if not found then raise exception 'Solicitação não encontrada'; end if;
        if r.status <> 'pendente' then raise exception 'Solicitação já avaliada'; end if;
        update public.solicitacoes_nome set status = 'aprovada' where id = p_id;
      end $$;
      alter table public.lojas enable row level security;
      alter table public.loja_membros enable row level security;
      alter table public.solicitacoes_nome enable row level security;
      grant usage on schema auth, private to authenticated;
      grant select, insert, update, delete on public.lojas, public.loja_membros, public.solicitacoes_nome to authenticated;
      grant select on public.perfis, public.papel_permissoes to authenticated;
      insert into public.lojas values ('${L1}','Loja 1'),('${L2}','Loja 2');
      insert into public.perfis values ('${U(1)}','admin','Admin'),('${U(2)}','analista','Analista'),('${U(3)}','gerente','Gerente'),('${U(4)}','assistente','Assistente'),('${U(5)}','operador','Op L1'),('${U(6)}','operador','Op L2');
      insert into public.loja_membros values ('${U(2)}','${L1}'),('${U(3)}','${L1}'),('${U(4)}','${L1}'),('${U(5)}','${L1}'),('${U(6)}','${L2}');
      insert into public.papel_permissoes values ('gerente','avisos_todas_lojas',true,null,null),('analista','lojas_gerenciar',true,null,null),('assistente','usuarios_gerenciar',true,null,null);
      insert into public.solicitacoes_nome values ('10000000-0000-4000-8000-000000000001','${L1}','${U(5)}','pendente','789','A','B',null,null,null),
        ('10000000-0000-4000-8000-000000000002','${L2}','${U(6)}','pendente','790','C','D',null,null,null);
    `);
    await db.exec(migration);

    const como = async uid => db.exec(`reset role; set test.uid='${uid}'; set role authenticated`);
    const um = async q => (await db.query(q)).rows[0];
    const lojas = async () => (await db.query('select nome from public.lojas order by nome')).rows.map(r => r.nome);
    const membros = async () => Number((await um('select count(*)::int n from public.loja_membros')).n);
    const pedidos = async () => (await db.query('select ean from public.solicitacoes_nome order by ean')).rows.map(r => r.ean);

    await como(U(1));
    assert.equal((await um('select private.tem_escopo_global() g')).g, true);
    assert.deepEqual(await lojas(), ['Loja 1', 'Loja 2']);
    assert.equal(await membros(), 5);

    for (const uid of [U(2), U(3), U(4)]) {
      await como(uid);
      assert.equal((await um('select private.tem_escopo_global() g')).g, false, 'só o Administrador é global');
      assert.deepEqual(await lojas(), ['Loja 1'], 'só a loja atribuída');
    }

    await como(U(2));
    assert.equal(await membros(), 4, 'Analista com lojas_gerenciar vê só os vínculos da Loja 1');
    assert.equal((await db.query(`update public.lojas set nome='X' where id='${L2}' returning id`)).rows.length, 0);
    await assert.rejects(db.query(`insert into public.lojas values ('${'00000000-0000-0000-0000-000000000003'}','Nova')`), /row-level security/);

    await como(U(4));
    assert.equal(await membros(), 4, 'Assistente com usuarios_gerenciar vê só os vínculos da Loja 1');
    await assert.rejects(db.query(`insert into public.loja_membros values ('${U(6)}','${L1}')`), /row-level security/);

    await db.exec(`reset role; insert into public.papel_permissoes values ('gerente','nome_editar',true,null,null) on conflict (papel,permissao) do update set permitido=true`);
    await como(U(3));
    assert.deepEqual(await pedidos(), ['789'], 'Gerente só vê pedidos de correção da própria loja');
    await assert.rejects(db.query(`select public.revisar_correcao_nome('10000000-0000-4000-8000-000000000002', true)`), /outra loja/);
    await db.query(`select public.revisar_correcao_nome('10000000-0000-4000-8000-000000000001', true)`);

    await db.exec('reset role');
    for (const papel of ['gerente', 'analista', 'assistente']) {
      assert.equal((await um(`select public.papel_tem_permissao('${papel}','avisos_todas_lojas') p`)).p, false);
    }
    assert.equal((await um(`select public.papel_tem_permissao('admin','avisos_todas_lojas') p`)).p, true);
    assert.equal(Number((await um(`select count(*)::int n from public.papel_permissoes where permissao='avisos_todas_lojas'`)).n), 0);
    await assert.rejects(db.query(`select public.definir_permissao_papel('gerente','avisos_todas_lojas',true)`), /Permissão inválida/);
    await db.query(`select public.definir_permissao_papel('gerente','lojas_gerenciar',true)`);
    assert.equal((await um(`select public.editar_usuario_atomico('${U(2)}','${U(5)}') e`)).e, 'membership');
    assert.equal((await um(`select public.editar_usuario_atomico('${U(1)}','${U(5)}') e`)).e, 'global');
  } finally { await db.close(); }
});
