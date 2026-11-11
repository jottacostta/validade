-- Integração OAuth Google Calendar separada do Supabase Auth. Segredos e tokens nunca residem em claro no banco.
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from public, anon, authenticated;
grant all on public.google_calendar_connections to service_role;

create table public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_oauth_states from public, anon, authenticated;
grant all on public.google_calendar_oauth_states to service_role;

-- Mapping independente de regras/linhas, sem FK para preservar tombstones até o cancelamento remoto.
create table public.google_calendar_event_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  event_id text not null,
  payload_hash text not null,
  start_at timestamptz not null,
  status text not null default 'active' check (status in ('active','cancelled','failed')),
  updated_at timestamptz not null default now(),
  primary key (user_id,dedupe_key),
  unique(user_id,event_id)
);
alter table public.google_calendar_event_map enable row level security;
revoke all on public.google_calendar_event_map from public, anon, authenticated;
grant all on public.google_calendar_event_map to service_role;

create or replace function public.consumir_google_calendar_state(p_hash text)
returns uuid language plpgsql security definer set search_path=''
as $$ declare v_user uuid; begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 update public.google_calendar_oauth_states set consumed_at=now()
 where state_hash=p_hash and consumed_at is null and expires_at>now()
 returning user_id into v_user;
 return v_user;
end; $$;
revoke all on function public.consumir_google_calendar_state(text) from public,anon,authenticated;
grant execute on function public.consumir_google_calendar_state(text) to service_role;

-- Retorna a projeção desejada do próprio usuário, abrangendo vínculos e perfis globais.
-- Alerta ocorre em validade-dias; só ocorrências futuras (hoje..365d) são retornadas.
create or replace function public.projetar_google_calendar(p_user uuid)
returns table(dedupe_key text,event_id text,start_at timestamptz,end_at timestamptz,time_zone text,title text,description text,loja_id uuid,regra_id uuid)
language plpgsql security definer set search_path=''
as $$ begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
 return query
 with fontes as (
  select l.id registro_id,l.loja_id,l.val validade,'lote'::text fonte,l.lote referencia,l.setor,
   coalesce(c.nome,l.ean) nome,l.ean codigo,coalesce(lo.nome,'Loja') loja
  from public.lotes l left join public.catalogo c on c.ean=l.ean join public.lojas lo on lo.id=l.loja_id
  where l.deleted_at is null and l.val is not null
  union all
  select r.id,r.loja_id,r.val,'perecivel'::text,r.sif,r.setor,coalesce(i.descricao,r.cod),r.cod,coalesce(lo.nome,'Loja')
  from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod and i.deleted_at is null
  join public.lojas lo on lo.id=r.loja_id where r.deleted_at is null and r.val is not null
 ), elegiveis as (
  select distinct f.* from fontes f where
   exists(select 1 from public.loja_membros lm where lm.user_id=p_user and lm.loja_id=f.loja_id)
   or exists(select 1 from public.perfis p where p.id=p_user and p.papel in ('analista','gerente','admin'))
 ), desejados as (
  select ar.id regra_id,ar.fuso,e.*,(e.validade-ar.dias)::date data_alerta,
   ( ((e.validade-ar.dias)::date + ar.hora_local) at time zone ar.fuso ) inicio
  from public.alertas_regras ar cross join elegiveis e
  where ar.user_id=p_user and ar.ativo
   and (e.validade-ar.dias) between (now() at time zone ar.fuso)::date and ((now() at time zone ar.fuso)::date+365)
 )
 select encode(public.digest(concat_ws('|',d.regra_id::text,d.loja_id::text,d.fonte,d.registro_id,d.validade::text,d.data_alerta::text),'sha256'),'hex'),
  substr(encode(public.digest(concat_ws('|',p_user::text,d.regra_id::text,d.loja_id::text,d.fonte,d.registro_id,d.validade::text,d.data_alerta::text),'sha256'),'hex'),1,32),
  d.inicio,d.inicio+interval '15 minutes',d.fuso,left(d.nome||' — validade '||d.validade::text,180),
  left('Loja: '||d.loja||E'\nProduto: '||d.nome||E'\nValidade: '||d.validade::text||E'\nLote/SIF: '||coalesce(d.referencia,'')||E'\nSetor: '||coalesce(d.setor,''),1500),d.loja_id,d.regra_id
 from desejados d where d.inicio>now();
end; $$;
revoke all on function public.projetar_google_calendar(uuid) from public,anon,authenticated;
grant execute on function public.projetar_google_calendar(uuid) to service_role;
