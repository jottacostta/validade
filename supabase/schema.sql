-- ============================================================================
-- Validade — banco de dados no Supabase (sincronização entre aparelhos e lojas)
-- Aplique este SQL no projeto: Supabase → SQL Editor → cole tudo → Run.
--
-- Modelo:
--   • Cada LOJA é uma conta (login por e-mail/senha), compartilhada pelos operadores.
--     loja_id = auth.uid() (o id da conta logada).
--   • Tabelas por loja: produtos, lotes, pere_itens, pere_regs, ajustes.
--     Isoladas por loja via RLS (uma loja não vê a outra).
--   • catalogo (EAN → nome): COMPARTILHADO entre todas as lojas (o nome é o mesmo
--     em qualquer lugar). Qualquer loja logada lê e contribui.
--   • Sincronização: cada linha tem updated_at (para "puxar o que mudou depois de X")
--     e deleted_at (exclusão suave, para a exclusão também sincronizar).
-- ============================================================================

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ───────────────────────── catálogo (compartilhado) ─────────────────────────
create table if not exists public.catalogo (
  ean        text primary key,
  nome       text not null,
  marca      text default '',
  img        text default '',
  updated_at timestamptz not null default now()
);
create index if not exists catalogo_updated_idx on public.catalogo (updated_at);

-- ───────────────────────── produtos (por loja) ──────────────────────────────
create table if not exists public.produtos (
  loja_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ean        text not null,
  nome       text not null default '',
  marca      text default '',
  img        text default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (loja_id, ean)
);
create index if not exists produtos_sync_idx on public.produtos (loja_id, updated_at);

-- ───────────────────────── lotes (por loja) ─────────────────────────────────
create table if not exists public.lotes (
  id         text primary key,            -- id gerado pelo app (uid)
  loja_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ean        text not null,
  lote       text default '',
  qtd        numeric default 0,
  val        date,
  criado     bigint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists lotes_sync_idx on public.lotes (loja_id, updated_at);

-- ───────────────────────── perecíveis: códigos de balança (por loja) ────────
create table if not exists public.pere_itens (
  loja_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cod        text not null,
  descricao  text not null default '',
  sif        text default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (loja_id, cod)
);
create index if not exists pere_itens_sync_idx on public.pere_itens (loja_id, updated_at);

-- ───────────────────────── perecíveis: registros (por loja) ─────────────────
create table if not exists public.pere_regs (
  id         text primary key,            -- id gerado pelo app (uid)
  loja_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cod        text not null,
  sif        text default '',
  peso       numeric default 0,
  val        date,
  criado     bigint,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists pere_regs_sync_idx on public.pere_regs (loja_id, updated_at);

-- ───────────────────────── ajustes (por loja) ───────────────────────────────
create table if not exists public.ajustes (
  loja_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
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
-- RLS (Row Level Security) — isola cada loja; catálogo compartilhado
-- ============================================================================
alter table public.catalogo   enable row level security;
alter table public.produtos   enable row level security;
alter table public.lotes      enable row level security;
alter table public.pere_itens enable row level security;
alter table public.pere_regs  enable row level security;
alter table public.ajustes    enable row level security;

-- catálogo: toda loja logada lê e contribui (compartilhado, não sensível)
drop policy if exists catalogo_sel on public.catalogo;
create policy catalogo_sel on public.catalogo for select to authenticated using (true);
drop policy if exists catalogo_ins on public.catalogo;
create policy catalogo_ins on public.catalogo for insert to authenticated with check (true);
drop policy if exists catalogo_upd on public.catalogo;
create policy catalogo_upd on public.catalogo for update to authenticated using (true) with check (true);

-- tabelas por loja: cada loja só enxerga e altera as próprias linhas
do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs','ajustes'] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format($p$create policy %I_sel on public.%I for select to authenticated using (loja_id = (select auth.uid()))$p$, t, t);
    execute format('drop policy if exists %I_ins on public.%I', t, t);
    execute format($p$create policy %I_ins on public.%I for insert to authenticated with check (loja_id = (select auth.uid()))$p$, t, t);
    execute format('drop policy if exists %I_upd on public.%I', t, t);
    execute format($p$create policy %I_upd on public.%I for update to authenticated using (loja_id = (select auth.uid())) with check (loja_id = (select auth.uid()))$p$, t, t);
    execute format('drop policy if exists %I_del on public.%I', t, t);
    execute format($p$create policy %I_del on public.%I for delete to authenticated using (loja_id = (select auth.uid()))$p$, t, t);
  end loop;
end $$;

-- acesso das roles ao Data API (REST). RLS acima controla QUAIS linhas.
grant select, insert, update, delete on
  public.catalogo, public.produtos, public.lotes,
  public.pere_itens, public.pere_regs, public.ajustes
to authenticated;
grant select, insert, update on public.catalogo to authenticated;
