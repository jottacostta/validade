-- ============================================================================
-- Validade — banco no Supabase (sincronização entre aparelhos e lojas)
-- Aplique em: Supabase → SQL Editor → cole tudo → Run. (idempotente: pode rodar de novo)
--
-- Modelo de acesso:
--   • USUÁRIO (operador): login por usuário + senha (o app usa <usuario>@loja.validade).
--   • LOJA: cadastro em `lojas`. Um operador escolhe a loja ao entrar.
--   • VÍNCULO: `loja_membros` diz quais lojas cada operador pode acessar.
--   • Dados por loja (produtos, lotes, pere_itens, pere_regs, ajustes): o RLS libera
--     a linha se o operador logado for membro da loja daquela linha.
--   • `catalogo` (EAN → nome): COMPARTILHADO entre todas as lojas.
--   • Sincronização: updated_at (puxar o que mudou) + deleted_at (exclusão suave).
--
-- Gestão de lojas/usuários/vínculos é feita por você no painel (SQL/Table Editor),
-- com a role de serviço — por isso não há policies de escrita em `lojas`/`loja_membros`.
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
alter function public.set_updated_at() set search_path = '';

-- ───────────────────────── lojas e vínculos ─────────────────────────────────
create table if not exists public.lojas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  criado     timestamptz not null default now()
);

create table if not exists public.loja_membros (
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  criado     timestamptz not null default now(),
  primary key (loja_id, user_id)
);
create index if not exists loja_membros_user_idx on public.loja_membros (user_id);

-- ───────────────────────── catálogo (compartilhado) ─────────────────────────
create table if not exists public.catalogo (
  ean        text primary key,
  nome       text not null,
  marca      text default '',
  img        text default '',
  updated_at timestamptz not null default now()
);
create index if not exists catalogo_updated_idx on public.catalogo (updated_at);

-- ───────────────────────── dados por loja ───────────────────────────────────
create table if not exists public.produtos (
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  ean        text not null,
  nome       text not null default '',
  marca      text default '',
  img        text default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (loja_id, ean)
);
create index if not exists produtos_sync_idx on public.produtos (loja_id, updated_at);

create table if not exists public.lotes (
  id         text primary key,
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  ean        text not null,
  lote       text default '',
  qtd        numeric default 0,
  val        date,
  criado     bigint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists lotes_sync_idx on public.lotes (loja_id, updated_at);

create table if not exists public.pere_itens (
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  cod        text not null,
  descricao  text not null default '',
  sif        text default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (loja_id, cod)
);
create index if not exists pere_itens_sync_idx on public.pere_itens (loja_id, updated_at);

create table if not exists public.pere_regs (
  id         text primary key,
  loja_id    uuid not null references public.lojas(id) on delete cascade,
  cod        text not null,
  sif        text default '',
  peso       numeric default 0,
  val        date,
  criado     bigint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists pere_regs_sync_idx on public.pere_regs (loja_id, updated_at);

create table if not exists public.ajustes (
  loja_id    uuid primary key references public.lojas(id) on delete cascade,
  dig        smallint default 5,
  valor      text default 'preco',
  dias       smallint default 30,
  notif      boolean default true,
  ocr        boolean default true,
  cosmos     text default '',
  updated_at timestamptz not null default now()
);

-- triggers de updated_at
do $$
declare t text;
begin
  foreach t in array array['catalogo','produtos','lotes','pere_itens','pere_regs','ajustes'] loop
    execute format('drop trigger if exists %I_upd on public.%I', t, t);
    execute format('create trigger %I_upd before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.lojas        enable row level security;
alter table public.loja_membros enable row level security;
alter table public.catalogo     enable row level security;
alter table public.produtos     enable row level security;
alter table public.lotes        enable row level security;
alter table public.pere_itens   enable row level security;
alter table public.pere_regs    enable row level security;
alter table public.ajustes      enable row level security;

-- o operador vê as lojas em que é membro (para a tela "escolha a loja")
drop policy if exists lojas_sel on public.lojas;
create policy lojas_sel on public.lojas for select to authenticated
  using (id in (select m.loja_id from public.loja_membros m where m.user_id = (select auth.uid())));

-- o operador vê os próprios vínculos
drop policy if exists loja_membros_sel on public.loja_membros;
create policy loja_membros_sel on public.loja_membros for select to authenticated
  using (user_id = (select auth.uid()));

-- catálogo: toda loja logada lê e contribui
drop policy if exists catalogo_sel on public.catalogo;
create policy catalogo_sel on public.catalogo for select to authenticated using (true);
drop policy if exists catalogo_ins on public.catalogo;
create policy catalogo_ins on public.catalogo for insert to authenticated with check (true);
drop policy if exists catalogo_upd on public.catalogo;
create policy catalogo_upd on public.catalogo for update to authenticated using (true) with check (true);

-- dados por loja: libera a linha se o operador é membro daquela loja
do $$
declare t text;
declare cond text := 'loja_id in (select m.loja_id from public.loja_membros m where m.user_id = (select auth.uid()))';
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs','ajustes'] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (%s)', t, t, cond);
    execute format('drop policy if exists %I_ins on public.%I', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (%s)', t, t, cond);
    execute format('drop policy if exists %I_upd on public.%I', t, t);
    execute format('create policy %I_upd on public.%I for update to authenticated using (%s) with check (%s)', t, t, cond, cond);
    execute format('drop policy if exists %I_del on public.%I', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (%s)', t, t, cond);
  end loop;
end $$;

-- acesso das roles ao Data API (REST); o RLS acima controla QUAIS linhas
grant select on public.lojas, public.loja_membros to authenticated;
grant select, insert, update, delete on
  public.produtos, public.lotes, public.pere_itens, public.pere_regs, public.ajustes to authenticated;
grant select, insert, update on public.catalogo to authenticated;

-- ============================================================================
-- Exemplo de cadastro (rode depois de criar os usuários em Authentication):
--   -- 1) crie a loja
--   insert into public.lojas (nome) values ('Bangu') returning id;
--   -- 2) veja o id do usuário em Authentication → Users (coluna UID)
--   -- 3) vincule o operador à loja
--   insert into public.loja_membros (loja_id, user_id)
--     values ('<id-da-loja>', '<uid-do-usuario>');
-- ============================================================================

-- ============================================================================
-- PAPÉIS (hierarquia): operador < assistente < analista < admin
-- Aplicado ao vivo via MCP; aqui para reproduzir do zero (rode após o bloco acima).
-- ============================================================================
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  papel text not null default 'operador' check (papel in ('operador','assistente','analista','admin')),
  criado timestamptz not null default now()
);
alter table public.perfis enable row level security;

-- Funções auxiliares de RLS ficam num schema NÃO exposto pela API (private), para que
-- não possam ser chamadas via /rest/v1/rpc. O authenticated ainda as executa dentro das
-- políticas (precisa de usage no schema + execute na função); o anon não tem acesso.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.meu_papel()
returns text language sql security definer set search_path = '' stable as $$
  select papel from public.perfis where id = auth.uid();
$$;
create or replace function private.membro_da(loja uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists(select 1 from public.loja_membros m where m.loja_id = loja and m.user_id = auth.uid());
$$;
revoke all on function private.meu_papel() from public;      grant execute on function private.meu_papel() to authenticated;
revoke all on function private.membro_da(uuid) from public;  grant execute on function private.membro_da(uuid) to authenticated;

create or replace function public.ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
    on conflict (id) do nothing;
  return new;
end; $$;
revoke all on function public.ao_criar_usuario() from anon, authenticated, public;
drop trigger if exists ao_criar_usuario_trg on auth.users;
create trigger ao_criar_usuario_trg after insert on auth.users for each row execute function public.ao_criar_usuario();
insert into public.perfis (id, nome) select u.id, split_part(u.email,'@',1) from auth.users u on conflict (id) do nothing;

-- Só admin pode alterar o papel de um usuário (defesa no servidor, além do RLS)
create or replace function public.protege_papel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.papel is distinct from old.papel and private.meu_papel() <> 'admin' then
    raise exception 'Somente admin pode alterar o papel do usuario';
  end if;
  return new;
end; $$;
revoke all on function public.protege_papel() from anon, authenticated, public;
drop trigger if exists protege_papel_trg on public.perfis;
create trigger protege_papel_trg before update on public.perfis for each row execute function public.protege_papel();

drop policy if exists perfis_sel on public.perfis;
create policy perfis_sel on public.perfis for select to authenticated using (id = (select auth.uid()) or private.meu_papel() = any (array['assistente','analista','admin']));
drop policy if exists perfis_upd on public.perfis;
create policy perfis_upd on public.perfis for update to authenticated using (private.meu_papel() = any (array['analista','admin'])) with check (private.meu_papel() = any (array['analista','admin']));
drop policy if exists perfis_ins on public.perfis;
create policy perfis_ins on public.perfis for insert to authenticated with check (private.meu_papel()='admin');
drop policy if exists perfis_del on public.perfis;
create policy perfis_del on public.perfis for delete to authenticated using (private.meu_papel()='admin');
grant select, insert, update, delete on public.perfis to authenticated;

-- regras por papel (recriadas por tabela): registrar=operador+; editar/apagar=assistente+; analista/admin leem tudo
do $$
declare t text;
declare cm text := 'private.membro_da(loja_id)';
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs'] loop
    execute format('alter policy %I_sel on public.%I using (private.meu_papel() in (''analista'',''admin'') or %s)', t, t, cm);
    execute format('alter policy %I_ins on public.%I with check (private.meu_papel()=''admin'' or (private.meu_papel() in (''operador'',''assistente'') and %s))', t, t, cm);
    execute format('alter policy %I_upd on public.%I using (private.meu_papel()=''admin'' or (private.meu_papel()=''assistente'' and %s)) with check (private.meu_papel()=''admin'' or (private.meu_papel()=''assistente'' and %s))', t, t, cm, cm);
    execute format('alter policy %I_del on public.%I using (private.meu_papel()=''admin'' or (private.meu_papel()=''assistente'' and %s))', t, t, cm);
  end loop;
end $$;
alter policy ajustes_sel on public.ajustes using (private.meu_papel() in ('analista','admin') or private.membro_da(loja_id));
alter policy ajustes_ins on public.ajustes with check (private.meu_papel()='admin' or (private.meu_papel()='assistente' and private.membro_da(loja_id)));
alter policy ajustes_upd on public.ajustes using (private.meu_papel()='admin' or (private.meu_papel()='assistente' and private.membro_da(loja_id))) with check (private.meu_papel()='admin' or (private.meu_papel()='assistente' and private.membro_da(loja_id)));
alter policy ajustes_del on public.ajustes using (private.meu_papel()='admin');

alter policy lojas_sel on public.lojas using (private.meu_papel() in ('analista','admin') or private.membro_da(id));
drop policy if exists lojas_ins on public.lojas; create policy lojas_ins on public.lojas for insert to authenticated with check (private.meu_papel()='admin');
drop policy if exists lojas_upd on public.lojas; create policy lojas_upd on public.lojas for update to authenticated using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
drop policy if exists lojas_del on public.lojas; create policy lojas_del on public.lojas for delete to authenticated using (private.meu_papel()='admin');
alter policy loja_membros_sel on public.loja_membros using (user_id = (select auth.uid()) or private.meu_papel()='admin');
drop policy if exists loja_membros_ins on public.loja_membros; create policy loja_membros_ins on public.loja_membros for insert to authenticated with check (private.meu_papel()='admin');
drop policy if exists loja_membros_upd on public.loja_membros; create policy loja_membros_upd on public.loja_membros for update to authenticated using (private.meu_papel()='admin') with check (private.meu_papel()='admin');
drop policy if exists loja_membros_del on public.loja_membros; create policy loja_membros_del on public.loja_membros for delete to authenticated using (private.meu_papel()='admin');
grant insert, update, delete on public.lojas, public.loja_membros to authenticated;

-- preferências pessoais por usuário: cada um guarda o seu próprio token do Cosmos.
-- RLS deixa cada usuário ver/editar só a própria linha (a tabela só tem o token, então
-- não há risco de escalonamento — ao contrário de guardar isso em perfis, que tem o papel).
create table if not exists public.preferencias (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cosmos_token text not null default '',
  atualizado timestamptz not null default now()
);
alter table public.preferencias enable row level security;
drop policy if exists prefs_sel on public.preferencias;
create policy prefs_sel on public.preferencias for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists prefs_ins on public.preferencias;
create policy prefs_ins on public.preferencias for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists prefs_upd on public.preferencias;
create policy prefs_upd on public.preferencias for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.preferencias to authenticated;


-- Cadastro inicial das unidades atualmente existentes no Guanabara.
-- Filiais FL21, FL22 e FL24 ficam de fora até eventual inauguração.
insert into public.lojas (nome)
select unidades.nome
from (values
  ('FL01'),
  ('FL02'),
  ('FL03'),
  ('FL04'),
  ('FL05'),
  ('FL06'),
  ('FL07'),
  ('FL08'),
  ('FL09'),
  ('FL10'),
  ('FL11'),
  ('FL12'),
  ('FL13'),
  ('FL14'),
  ('FL15'),
  ('FL16'),
  ('FL17'),
  ('FL18'),
  ('FL19'),
  ('FL20'),
  ('FL23'),
  ('FL25'),
  ('FL26'),
  ('FL27'),
  ('FL28'),
  ('FL29'),
  ('FL30'),
  ('FL31'),
  ('DEP99'),
  ('DEP999'),
  ('DEP96')
) as unidades(nome)
where not exists (
  select 1 from public.lojas l where upper(trim(l.nome)) = unidades.nome
);
