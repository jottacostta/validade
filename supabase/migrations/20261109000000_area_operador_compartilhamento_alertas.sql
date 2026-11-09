-- Área do operador: registro server-validated, autoria visível e alertas por loja.
-- Pressupõe migrations anteriores aplicáveis (incluindo private.membro_da e created_by).

alter table public.lotes add column if not exists setor text;
alter table public.lotes add column if not exists created_by_nome text;
alter table public.pere_regs add column if not exists setor text;
alter table public.pere_regs add column if not exists created_by_nome text;

comment on column public.lotes.setor is 'Setor informado no registro; legado pode permanecer NULL; novos registros são validados pela RPC.';
comment on column public.lotes.created_by_nome is 'Snapshot do nome do autor definido pelo servidor, nunca pelo cliente.';
comment on column public.pere_regs.setor is 'Setor informado no registro; legado pode permanecer NULL; novos registros são validados pela RPC.';
comment on column public.pere_regs.created_by_nome is 'Snapshot do nome do autor definido pelo servidor, nunca pelo cliente.';

-- O trigger anterior já seta created_by. Substituí-lo para proteger também o snapshot.
create or replace function private.set_created_by()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_nome text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      if tg_table_name in ('lotes','pere_regs') then
        select coalesce(nullif(btrim(p.nome),''), nullif(u.email,''), auth.uid()::text)
          into v_nome from auth.users u left join public.perfis p on p.id=u.id where u.id=auth.uid();
        new.created_by_nome := coalesce(v_nome, auth.uid()::text);
      end if;
    end if;
  else
    if new.created_by is distinct from old.created_by then
      raise exception 'A autoria do registro não pode ser alterada';
    end if;
    if tg_table_name in ('lotes','pere_regs') then
      if new.created_by_nome is distinct from old.created_by_nome then
        raise exception 'O nome de autoria não pode ser alterado';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.set_created_by() from public, anon, authenticated;

-- Backfill do snapshot para registros que já têm UUID de autoria comprovado.
update public.lotes l set created_by_nome=coalesce(nullif(btrim(p.nome),''),nullif(u.email,''),l.created_by::text)
from auth.users u left join public.perfis p on p.id=u.id
where l.created_by=u.id and l.created_by_nome is null;
update public.pere_regs r set created_by_nome=coalesce(nullif(btrim(p.nome),''),nullif(u.email,''),r.created_by::text)
from auth.users u left join public.perfis p on p.id=u.id
where r.created_by=u.id and r.created_by_nome is null;

create or replace function private.validar_setor_registro()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.setor is null or new.setor not in ('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia') then
    raise exception 'Setor obrigatório ou inválido';
  end if;
  return new;
end;
$$;
revoke all on function private.validar_setor_registro() from public,anon,authenticated;
drop trigger if exists lotes_validar_setor on public.lotes;
create trigger lotes_validar_setor before insert on public.lotes
  for each row execute function private.validar_setor_registro();
drop trigger if exists pere_regs_validar_setor on public.pere_regs;
create trigger pere_regs_validar_setor before insert on public.pere_regs
  for each row execute function private.validar_setor_registro();

-- Não confiar em INSERT direto para criar os campos novos: somente as RPCs de registro.
-- As policies antigas de INSERT continuam necessárias a outros fluxos já existentes;
-- RLS não é ampliado e as RPCs impõem os campos e a membresia no servidor.

create or replace function public.registrar_lote(
  p_id text,p_loja_id uuid,p_ean text,p_nome text,p_lote text,p_qtd numeric,p_val date,p_setor text
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare v_nome text; v_criado bigint; v_lote_norm text;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_id is null or btrim(p_id)='' or p_loja_id is null or p_ean is null or p_ean !~ '^[0-9]{6,14}$' or
     p_nome is null or btrim(p_nome)='' or p_lote is null or btrim(p_lote)='' or p_val is null or p_qtd is null or p_qtd <= 0 then
    raise exception 'Informe identificador, loja, EAN válido, nome, lote, quantidade maior que zero e validade';
  end if;
  if p_setor is null or p_setor not in ('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia') then
    raise exception 'Setor inválido';
  end if;
  if not (private.tem_escopo_global() or private.membro_da(p_loja_id)) then raise exception 'Usuário não tem acesso ativo à loja'; end if;
  v_lote_norm := lower(btrim(coalesce(p_lote,'')));
  -- Serializa registros semanticamente iguais antes da checagem de duplicidade.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_loja_id::text||'|'||btrim(p_ean)||'|'||v_lote_norm||'|'||p_val::text,0));
  if exists(select 1 from public.lotes l where l.id=p_id) then raise exception 'Identificador de lote já utilizado'; end if;
  if exists(select 1 from public.lotes l where l.loja_id=p_loja_id and l.ean=btrim(p_ean)
      and lower(btrim(coalesce(l.lote,'')))=v_lote_norm and l.val=p_val and l.deleted_at is null) then
    raise exception 'Já existe lote desta loja com o mesmo EAN, lote e validade';
  end if;
  insert into public.produtos(loja_id,ean) values(p_loja_id,btrim(p_ean)) on conflict (loja_id,ean) do nothing;
  insert into public.catalogo(ean,nome) values(btrim(p_ean),btrim(p_nome))
    on conflict(ean) do update set nome=excluded.nome;
  insert into public.lotes(id,loja_id,ean,lote,qtd,val,setor,criado)
    values(btrim(p_id),p_loja_id,btrim(p_ean),btrim(p_lote),p_qtd,p_val,p_setor,(extract(epoch from clock_timestamp())*1000)::bigint)
    returning created_by_nome,criado into v_nome,v_criado;
  return jsonb_build_object('id',btrim(p_id),'loja_id',p_loja_id,'ean',btrim(p_ean),'setor',p_setor,
    'created_by',auth.uid(),'created_by_nome',v_nome,'criado',v_criado);
end;
$$;
revoke all on function public.registrar_lote(text,uuid,text,text,text,numeric,date,text) from public,anon;
grant execute on function public.registrar_lote(text,uuid,text,text,text,numeric,date,text) to authenticated;

create or replace function public.registrar_perecivel(
  p_id text,p_loja_id uuid,p_cod text,p_descricao text,p_sif text,p_peso numeric,p_val date,p_setor text
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare v_nome text; v_desc text; v_sif text; v_criado bigint;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_id is null or btrim(p_id)='' or p_loja_id is null or p_cod is null or btrim(p_cod)='' or
     p_descricao is null or btrim(p_descricao)='' or p_val is null or p_peso is null or p_peso <= 0 then
    raise exception 'Informe identificador, loja, código, descrição, peso maior que zero e validade';
  end if;
  if p_setor is null or p_setor not in ('Açougue','Laticínios','Padaria','Salgados','FLV','Mercearia') then
    raise exception 'Setor inválido';
  end if;
  if not (private.tem_escopo_global() or private.membro_da(p_loja_id)) then raise exception 'Usuário não tem acesso ativo à loja'; end if;
  if exists(select 1 from public.pere_regs r where r.id=p_id) then raise exception 'Identificador perecível já utilizado'; end if;
  insert into public.pere_itens(loja_id,cod,descricao,sif)
    values(p_loja_id,btrim(p_cod),btrim(p_descricao),btrim(coalesce(p_sif,'')))
    on conflict(loja_id,cod) do nothing;
  select i.descricao,i.sif into v_desc,v_sif from public.pere_itens i where i.loja_id=p_loja_id and i.cod=btrim(p_cod);
  insert into public.pere_regs(id,loja_id,cod,sif,peso,val,setor,criado)
    values(btrim(p_id),p_loja_id,btrim(p_cod),btrim(coalesce(p_sif,'')),p_peso,p_val,p_setor,(extract(epoch from clock_timestamp())*1000)::bigint)
    returning created_by_nome,criado into v_nome,v_criado;
  return jsonb_build_object('id',btrim(p_id),'loja_id',p_loja_id,'cod',btrim(p_cod),'setor',p_setor,
    'created_by',auth.uid(),'created_by_nome',v_nome,'descricao',v_desc,'sif',v_sif,'criado',v_criado);
end;
$$;
revoke all on function public.registrar_perecivel(text,uuid,text,text,text,numeric,date,text) from public,anon;
grant execute on function public.registrar_perecivel(text,uuid,text,text,text,numeric,date,text) to authenticated;

create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  loja_id uuid not null references public.lojas(id) on delete cascade, dedupe_key text not null,
  tipo text not null, titulo text not null, mensagem text not null, payload jsonb not null default '{}'::jsonb,
  criado timestamptz not null default now(), lida_em timestamptz,
  constraint notificacoes_user_dedupe_unique unique(user_id,dedupe_key)
);
create index if not exists notificacoes_user_criado_idx on public.notificacoes(user_id,criado desc);
alter table public.notificacoes enable row level security;
create policy notificacoes_sel_own_store on public.notificacoes for select to authenticated
  using(user_id=(select auth.uid()) and private.membro_da(loja_id));
create policy notificacoes_upd_own_store on public.notificacoes for update to authenticated
  using(user_id=(select auth.uid()) and private.membro_da(loja_id))
  with check(user_id=(select auth.uid()) and private.membro_da(loja_id));
revoke all on public.notificacoes from public,anon,authenticated;
grant select,update(lida_em) on public.notificacoes to authenticated;
grant select,insert,update,delete on public.notificacoes to service_role;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null, auth text not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_owner_idx on public.push_subscriptions(owner_id);
create or replace function private.push_subscription_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function private.push_subscription_updated_at() from public,anon,authenticated;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function private.push_subscription_updated_at();
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner_all on public.push_subscriptions for all to authenticated
  using(owner_id=(select auth.uid()))
  with check(owner_id=(select auth.uid()));
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,insert,update,delete on public.push_subscriptions to service_role;

-- Usa somente dados da própria loja. As chaves idempotentes são por registro/validade/tipo.
create or replace function public.gerar_alertas_validade()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_rows jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role pode gerar alertas'; end if;
  with fontes as (
    select l.id as registro_id,l.loja_id,l.val,l.ean as codigo,coalesce(c.nome,l.ean) as nome,l.lote as referencia,l.setor,
      'lote'::text as fonte from public.lotes l left join public.catalogo c on c.ean=l.ean
    where l.deleted_at is null and l.val is not null
    union all
    select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel'
    from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod
    where r.deleted_at is null and r.val is not null
  ), candidatos as (
    select f.*,lo.nome as loja_nome,
      case when f.val < current_date then 'validade_vencida' else 'validade_proxima' end as tipo,
      case when f.val < current_date then 'Produto vencido' else 'Validade próxima' end as titulo,
      case when f.val < current_date then 'Registro vencido em '||f.val::text else 'Registro vence em '||f.val::text end as mensagem
    from fontes f join public.lojas lo on lo.id=f.loja_id
    where f.val < current_date or f.val between current_date and current_date + coalesce((select a.dias from public.ajustes a where a.loja_id=f.loja_id),30)
  ), ins as (
    insert into public.notificacoes(user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
    select m.user_id,c.loja_id,
      c.fonte||':'||c.registro_id||':'||c.val::text||':'||c.tipo,
      c.tipo,c.titulo,c.mensagem,
      jsonb_build_object('fonte',c.fonte,'registro_id',c.registro_id,'nome',c.nome,'codigo',c.codigo,
        'lote_ou_sif',c.referencia,'setor',c.setor,'validade',c.val,'loja_id',c.loja_id,'loja',c.loja_nome)
    from candidatos c join public.loja_membros m on m.loja_id=c.loja_id
    on conflict(user_id,dedupe_key) do nothing
    returning id,user_id,loja_id,tipo,titulo,mensagem,payload,criado
  ) select coalesce(jsonb_agg(to_jsonb(ins)),'[]'::jsonb) into v_rows from ins;
  return v_rows;
end;
$$;
revoke all on function public.gerar_alertas_validade() from public,anon,authenticated;
grant execute on function public.gerar_alertas_validade() to service_role;
comment on function public.gerar_alertas_validade() is 'Cria alertas de validade idempotentes por usuário e loja; somente service_role pode executar.';
comment on table public.notificacoes is 'Alertas internos privados, visíveis somente ao destinatário enquanto membro da loja.';
comment on table public.push_subscriptions is 'Endpoints Web Push pertencentes ao usuário; membership é validada pela Edge Function no momento da inscrição e alertas são enviados somente às notificações do próprio usuário.';
