-- Matriz de papéis, ownership de registros e hardening RLS.
-- Versionado na PR; NÃO aplicar manualmente em produção antes de review/merge.
create schema if not exists private;
grant usage on schema private to authenticated;

-- Papel gerente é compatível com perfis existentes e com políticas anteriores.
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel in ('operador','assistente','analista','gerente','admin'));

-- Ownership: identifica quem criou cada linha. Registros antigos ficam NULL e
-- não podem ser editados por operadores por falta de autoria comprovável.
alter table public.produtos add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.lotes add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.pere_itens add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.pere_regs add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function private.set_created_by()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      -- Autoria é definida pelo servidor; não confiar no payload do cliente.
      new.created_by := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by then
      raise exception 'A autoria do registro não pode ser alterada';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.set_created_by() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs'] loop
    execute format('drop trigger if exists %I_creator on public.%I',t,t);
    execute format('create trigger %I_creator before insert or update on public.%I for each row execute function private.set_created_by()',t,t);
  end loop;
end $$;

-- Helper: analista/gerente/admin têm escopo global de lojas; assistente/operador
-- ficam limitados aos vínculos explícitos.
-- Fail closed: assistente só pode ter exatamente um vínculo de loja ativo.
create or replace function private.membro_da(loja uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $fn$
declare v_papel text; v_total integer;
begin
  v_papel := private.meu_papel();
  if v_papel='assistente' then
    select count(*) into v_total from public.loja_membros where user_id=auth.uid();
    if v_total <> 1 then return false; end if;
  end if;
  return exists(select 1 from public.loja_membros m where m.loja_id=loja and m.user_id=auth.uid());
end;
$fn$;
revoke all on function private.membro_da(uuid) from public,anon;
grant execute on function private.membro_da(uuid) to authenticated;

create or replace function private.tem_escopo_global()
returns boolean language sql stable security definer set search_path=''
as $$ select coalesce(private.meu_papel() = any(array['analista','gerente','admin']),false); $$;
revoke all on function private.tem_escopo_global() from public, anon;
grant execute on function private.tem_escopo_global() to authenticated;

-- SELECT: global para Analista/Gerente/Admin, loja vinculada para Operador/Assistente.
do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs'] loop
    execute format('drop policy if exists %I_sel on public.%I',t,t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (private.tem_escopo_global() or private.membro_da(loja_id))',t,t);
    execute format('drop policy if exists %I_ins on public.%I',t,t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check ((private.meu_papel() = ''admin'') or ((private.meu_papel() = any(array[''operador'',''assistente''])) and private.membro_da(loja_id)) or (private.tem_escopo_global() and private.meu_papel() <> ''admin''))',t,t);
    execute format('drop policy if exists %I_upd on public.%I',t,t);
    execute format('create policy %I_upd on public.%I for update to authenticated using ((private.meu_papel() = ''admin'') or (private.tem_escopo_global() and private.meu_papel() <> ''admin'') or (private.meu_papel() = ''assistente'' and private.membro_da(loja_id) and created_by = auth.uid()) or (private.meu_papel() = ''operador'' and private.membro_da(loja_id) and created_by = auth.uid())) with check ((private.meu_papel() = ''admin'') or (private.tem_escopo_global() and private.meu_papel() <> ''admin'') or (private.meu_papel() = ''assistente'' and private.membro_da(loja_id)) or (private.meu_papel() = ''operador'' and private.membro_da(loja_id) and created_by = auth.uid()))',t,t);
    -- O app sincroniza exclusões por deleted_at/tombstone. Bloquear DELETE físico,
    -- inclusive Admin, para não perder a informação no próximo pull.
    execute format('drop policy if exists %I_del on public.%I',t,t);
    execute format('revoke delete on public.%I from authenticated',t);
  end loop;
end $$;

-- Ajustes são por loja (sem created_by); mantêm isolamento por loja.
drop policy if exists ajustes_sel on public.ajustes;
create policy ajustes_sel on public.ajustes for select to authenticated
using (private.tem_escopo_global() or private.membro_da(loja_id));
drop policy if exists ajustes_ins on public.ajustes;
create policy ajustes_ins on public.ajustes for insert to authenticated
with check (private.tem_escopo_global() or private.membro_da(loja_id));
drop policy if exists ajustes_upd on public.ajustes;
create policy ajustes_upd on public.ajustes for update to authenticated
using (private.tem_escopo_global() or private.membro_da(loja_id))
with check (private.tem_escopo_global() or private.membro_da(loja_id));
drop policy if exists ajustes_del on public.ajustes;
create policy ajustes_del on public.ajustes for delete to authenticated
using (private.meu_papel()='admin');

-- Store/admin and audit controls.
drop policy if exists lojas_sel on public.lojas;
create policy lojas_sel on public.lojas for select to authenticated
using (private.tem_escopo_global() or private.membro_da(id));
drop policy if exists loja_membros_sel on public.loja_membros;
create policy loja_membros_sel on public.loja_membros for select to authenticated
using (user_id=auth.uid() or private.tem_escopo_global());

-- Manager/analyst may manage store memberships within user-admin workflows, but
-- no client-side direct write to membership rows (Edge Function service role).
drop policy if exists loja_membros_ins on public.loja_membros;
create policy loja_membros_ins on public.loja_membros for insert to authenticated with check (private.meu_papel()='admin');
drop policy if exists loja_membros_upd on public.loja_membros;
create policy loja_membros_upd on public.loja_membros for update to authenticated using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
drop policy if exists loja_membros_del on public.loja_membros;
create policy loja_membros_del on public.loja_membros for delete to authenticated using (private.meu_papel()='admin');

-- Revisão de exclusão: Assistente, Analista, Gerente, Administrador.
drop policy if exists solicitacao_sel on public.solicitacoes_exclusao;
create policy solicitacao_sel on public.solicitacoes_exclusao for select to authenticated
using (solicitante_id=auth.uid() or (private.meu_papel()=any(array['assistente','analista','gerente','admin']) and (private.tem_escopo_global() or private.membro_da(loja_id))));
grant select, insert on public.solicitacoes_exclusao to authenticated;

-- RLS de auditoria: apenas Admin lê. Escrita de cliente mantida conforme políticas
-- existentes; RPCs/Edge Functions fazem registro server-side para eventos críticos.
drop policy if exists auditoria_sel on public.auditoria;
create policy auditoria_sel on public.auditoria for select to authenticated using (private.meu_papel()='admin');

-- RPC revisão deve permitir gerente no conjunto de revisores e global scope.
create or replace function public.revisar_solicitacao_exclusao(
  p_id uuid, p_aprovar boolean, p_resposta text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare r public.solicitacoes_exclusao%rowtype; v_papel text; v_usuario text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if v_papel not in ('assistente','analista','gerente','admin') then raise exception 'Perfil sem permissão para revisar exclusões'; end if;
  select * into r from public.solicitacoes_exclusao where id=p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if not private.tem_escopo_global() and not private.membro_da(r.loja_id) then raise exception 'Sem acesso à loja'; end if;
  if r.status <> 'pendente' then raise exception 'Solicitação já revisada'; end if;
  if not p_aprovar and (p_resposta is null or length(trim(p_resposta)) < 3) then raise exception 'Informe o motivo da rejeição'; end if;
  if p_aprovar then
    if r.tipo='produto' then
      update public.produtos set deleted_at=now() where loja_id=r.loja_id and ean=r.registro_id and deleted_at is null;
      if not found then raise exception 'Produto já removido ou não encontrado'; end if;
      -- Tombstone em cascata para lotes evita que o pull recrie o produto local.
      update public.lotes set deleted_at=now() where loja_id=r.loja_id and ean=r.registro_id and deleted_at is null;
    elsif r.tipo='lote' then update public.lotes set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
    elsif r.tipo='pere_item' then
      update public.pere_itens set deleted_at=now() where loja_id=r.loja_id and cod=r.registro_id and deleted_at is null;
      if not found then raise exception 'Código perecível já removido ou não encontrado'; end if;
      update public.pere_regs set deleted_at=now() where loja_id=r.loja_id and cod=r.registro_id and deleted_at is null;
    elsif r.tipo='pere_reg' then
      update public.pere_regs set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
      if not found then raise exception 'Registro perecível já removido ou não encontrado'; end if;
    else
      raise exception 'Tipo de registro inválido para exclusão: %', r.tipo;
    end if;
  end if;
  update public.solicitacoes_exclusao set status=case when p_aprovar then 'aprovada' else 'rejeitada' end,
    revisor_id=auth.uid(),resposta=nullif(trim(p_resposta),''),revisado_em=now() where id=p_id;
  select coalesce(p.nome,u.email,auth.uid()::text),p.papel,l.nome into v_usuario,v_papel,v_loja_nome
    from auth.users u left join public.perfis p on p.id=u.id left join public.lojas l on l.id=r.loja_id where u.id=auth.uid();
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values(auth.uid(),v_usuario,v_papel,r.loja_id,v_loja_nome,
    case when p_aprovar then 'exclusao_aprovada' else 'exclusao_rejeitada' end,
    jsonb_build_object('solicitacao_id',r.id,'tipo',r.tipo,'registro_id',r.registro_id,'solicitante_id',r.solicitante_id,'motivo',r.motivo,'resposta',p_resposta));
end;
$$;
revoke all on function public.revisar_solicitacao_exclusao(uuid,boolean,text) from public,anon;
grant execute on function public.revisar_solicitacao_exclusao(uuid,boolean,text) to authenticated;

-- Administrador conserva acesso irrestrito ao catálogo compartilhado e preferências.
drop policy if exists catalogo_del_admin on public.catalogo;
create policy catalogo_del_admin on public.catalogo for delete to authenticated
using (private.meu_papel()='admin');

drop policy if exists preferencias_admin_all on public.preferencias;
create policy preferencias_admin_all on public.preferencias for all to authenticated
using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
grant select,insert,update,delete on public.preferencias to authenticated;

-- Server-side audit for meaningful mutations (avoids client-only forged identity).
create or replace function private.audit_mutation()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_user text; v_role text; v_store uuid; v_store_name text; v_old jsonb; v_new jsonb; v_key text;
begin
  if auth.uid() is null then
    -- Edge Functions using service_role record their own actor in their server audit.
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then v_old:=to_jsonb(old);v_new:=null;
  elsif tg_op='INSERT' then v_old:=null;v_new:=to_jsonb(new);
  else v_old:=to_jsonb(old);v_new:=to_jsonb(new);
    if (v_old - 'updated_at') = (v_new - 'updated_at') then return new; end if;
  end if;
  -- A tabela lojas usa id como chave de loja; as demais usam loja_id.
  if tg_table_name='lojas' then
    v_store := coalesce((v_new->>'id')::uuid,(v_old->>'id')::uuid);
  else
    v_store := coalesce((v_new->>'loja_id')::uuid,(v_old->>'loja_id')::uuid);
  end if;
  select coalesce(nullif(trim(p.nome),''),u.email,auth.uid()::text),p.papel
    into v_user,v_role from auth.users u left join public.perfis p on p.id=u.id where u.id=auth.uid();
  if v_store is not null then select nome into v_store_name from public.lojas where id=v_store; end if;
  v_key:=coalesce(v_new->>'id',v_new->>'ean',v_new->>'cod',v_old->>'id',v_old->>'ean',v_old->>'cod',v_store::text);
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values(auth.uid(),v_user,v_role,v_store,v_store_name,
    lower(tg_op)||'_'||tg_table_name,
    jsonb_build_object('table',tg_table_name,'operation',tg_op,'record_id',v_key,'old',v_old,'new',v_new));
  if tg_op='DELETE' then return old; else return new; end if;
end;
$fn$;
revoke all on function private.audit_mutation() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs','ajustes','catalogo','lojas'] loop
    execute format('drop trigger if exists %I_audit on public.%I',t,t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.audit_mutation()',t,t);
  end loop;
end $$;

-- Prevent client from forging creator or editing audit identity.
create or replace function private.proteger_auditoria()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.papel := private.meu_papel();
  end if;
  return new;
end;
$$;
revoke all on function private.proteger_auditoria() from public,anon,authenticated;
drop trigger if exists auditoria_identity on public.auditoria;
create trigger auditoria_identity before insert on public.auditoria for each row execute function private.proteger_auditoria();
