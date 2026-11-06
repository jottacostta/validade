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
