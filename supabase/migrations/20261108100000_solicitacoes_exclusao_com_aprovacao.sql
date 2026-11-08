-- Solicitação de exclusão com aprovação por perfil autorizado.
-- Esta migration prepara o fluxo backend; UI e sincronização por tombstones serão integradas em etapa seguinte.
create table if not exists public.solicitacoes_exclusao (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  solicitante_id uuid not null references auth.users(id) on delete restrict,
  tipo text not null check (tipo in ('produto','lote','pere_item','pere_reg')),
  registro_id text not null,
  motivo text not null check (length(trim(motivo)) between 3 and 1000),
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  revisor_id uuid references auth.users(id) on delete set null,
  resposta text,
  criado_em timestamptz not null default now(),
  revisado_em timestamptz,
  unique (loja_id, tipo, registro_id, solicitante_id, status)
);

create index if not exists solicitacoes_exclusao_loja_status_idx
  on public.solicitacoes_exclusao (loja_id, status, criado_em desc);
create index if not exists solicitacoes_exclusao_solicitante_idx
  on public.solicitacoes_exclusao (solicitante_id, criado_em desc);

alter table public.solicitacoes_exclusao enable row level security;
alter table public.solicitacoes_exclusao force row level security;

drop policy if exists solicitacao_sel on public.solicitacoes_exclusao;
create policy solicitacao_sel on public.solicitacoes_exclusao for select to authenticated
using (
  solicitante_id = (select auth.uid())
  or (
    private.meu_papel() = any (array['assistente','analista','admin'])
    and private.membro_da(loja_id)
  )
);

-- Solicitações só podem ser criadas pelo usuário autenticado, dentro de uma loja
-- da qual seja membro. Não se permite update/delete direto pelo cliente.
drop policy if exists solicitacao_ins on public.solicitacoes_exclusao;
create policy solicitacao_ins on public.solicitacoes_exclusao for insert to authenticated
with check (
  solicitante_id = (select auth.uid())
  and private.membro_da(loja_id)
  and status = 'pendente'
  and revisor_id is null
  and revisado_em is null
);
revoke update, delete on public.solicitacoes_exclusao from authenticated;
grant select, insert on public.solicitacoes_exclusao to authenticated;

create or replace function public.solicitar_exclusao(
  p_loja_id uuid, p_tipo text, p_registro_id text, p_motivo text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not private.membro_da(p_loja_id) then raise exception 'Sem acesso à loja'; end if;
  if p_tipo not in ('produto','lote','pere_item','pere_reg') then raise exception 'Tipo inválido'; end if;
  if p_registro_id is null or length(trim(p_registro_id)) = 0 then raise exception 'Registro inválido'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 or length(trim(p_motivo)) > 1000 then raise exception 'Informe um motivo entre 3 e 1000 caracteres'; end if;

  -- Confirma que o registro pertence à loja antes de aceitar a solicitação.
  if p_tipo = 'produto' and not exists(select 1 from public.produtos where loja_id=p_loja_id and ean=p_registro_id and deleted_at is null) then raise exception 'Produto não encontrado na loja'; end if;
  if p_tipo = 'lote' and not exists(select 1 from public.lotes where loja_id=p_loja_id and id=p_registro_id and deleted_at is null) then raise exception 'Lote não encontrado na loja'; end if;
  if p_tipo = 'pere_item' and not exists(select 1 from public.pere_itens where loja_id=p_loja_id and cod=p_registro_id and deleted_at is null) then raise exception 'Código perecível não encontrado na loja'; end if;
  if p_tipo = 'pere_reg' and not exists(select 1 from public.pere_regs where loja_id=p_loja_id and id=p_registro_id and deleted_at is null) then raise exception 'Registro perecível não encontrado na loja'; end if;

  insert into public.solicitacoes_exclusao(loja_id, solicitante_id, tipo, registro_id, motivo)
  values(p_loja_id, auth.uid(), p_tipo, p_registro_id, trim(p_motivo))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revisar_solicitacao_exclusao(
  p_id uuid, p_aprovar boolean, p_resposta text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.solicitacoes_exclusao%rowtype; v_papel text; v_usuario text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if v_papel not in ('assistente','analista','admin') then raise exception 'Perfil sem permissão para revisar exclusões'; end if;

  select * into r from public.solicitacoes_exclusao where id=p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if not private.membro_da(r.loja_id) and v_papel <> 'admin' then raise exception 'Sem acesso à loja'; end if;
  if r.status <> 'pendente' then raise exception 'Solicitação já revisada'; end if;
  if not p_aprovar and (p_resposta is null or length(trim(p_resposta)) < 3) then raise exception 'Informe o motivo da rejeição'; end if;

  if p_aprovar then
    if r.tipo='produto' then update public.produtos set deleted_at=now() where loja_id=r.loja_id and ean=r.registro_id and deleted_at is null;
    elsif r.tipo='lote' then update public.lotes set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
    elsif r.tipo='pere_item' then update public.pere_itens set deleted_at=now() where loja_id=r.loja_id and cod=r.registro_id and deleted_at is null;
    elsif r.tipo='pere_reg' then update public.pere_regs set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
    end if;
    if not found then raise exception 'Registro já removido ou não encontrado'; end if;
  end if;

  update public.solicitacoes_exclusao
  set status=case when p_aprovar then 'aprovada' else 'rejeitada' end,
      revisor_id=auth.uid(), resposta=nullif(trim(p_resposta),''), revisado_em=now()
  where id=p_id;

  select coalesce(p.nome, u.email, auth.uid()::text), p.papel, l.nome
    into v_usuario, v_papel, v_loja_nome
    from auth.users u
    left join public.perfis p on p.id=u.id
    left join public.lojas l on l.id=r.loja_id
    where u.id=auth.uid();

  insert into public.auditoria(user_id, usuario, papel, loja_id, loja_nome, acao, detalhe)
  values(auth.uid(), v_usuario, v_papel, r.loja_id, v_loja_nome,
    case when p_aprovar then 'exclusao_aprovada' else 'exclusao_rejeitada' end,
    jsonb_build_object('solicitacao_id',r.id,'tipo',r.tipo,'registro_id',r.registro_id,
      'solicitante_id',r.solicitante_id,'motivo',r.motivo,'resposta',p_resposta));
end;
$$;

revoke all on function public.solicitar_exclusao(uuid,text,text,text) from public, anon;
revoke all on function public.revisar_solicitacao_exclusao(uuid,boolean,text) from public, anon;
grant execute on function public.solicitar_exclusao(uuid,text,text,text) to authenticated;
grant execute on function public.revisar_solicitacao_exclusao(uuid,boolean,text) to authenticated;
