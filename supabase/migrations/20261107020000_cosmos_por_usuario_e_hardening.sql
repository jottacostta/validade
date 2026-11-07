-- ============================================================================
-- Validade — token do Cosmos por usuário + endurecimento de segurança
-- Aplique após 20261106200000_init.sql. Idempotente: pode rodar de novo.
-- ============================================================================

-- 1) Preferências pessoais por usuário: cada um guarda o seu próprio token do Cosmos.
--    RLS deixa cada usuário ver/editar só a própria linha. A tabela só tem o token,
--    então não há risco de escalonamento (ao contrário de guardar isso em perfis).
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

-- 2) Funções auxiliares de RLS num schema NÃO exposto pela API (private), para que
--    não possam ser chamadas via /rest/v1/rpc. O authenticated ainda as executa dentro
--    das políticas; o anon não tem acesso.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.meu_papel()
returns text language sql stable security definer set search_path to '' as $$
  select papel from public.perfis where id = auth.uid();
$$;
create or replace function private.membro_da(loja uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.loja_membros m where m.loja_id = loja and m.user_id = auth.uid());
$$;
revoke all on function private.meu_papel() from public;      grant execute on function private.meu_papel() to authenticated;
revoke all on function private.membro_da(uuid) from public;  grant execute on function private.membro_da(uuid) to authenticated;

-- 3) Repontar todas as políticas para private.* (as cópias em public seguem válidas até o passo 5)
alter policy ajustes_del on public.ajustes using (private.meu_papel() = 'admin');
alter policy ajustes_ins on public.ajustes with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));
alter policy ajustes_sel on public.ajustes using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(loja_id));
alter policy ajustes_upd on public.ajustes using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id))) with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));

alter policy auditoria_sel on public.auditoria using (private.meu_papel() = 'admin');

alter policy loja_membros_del on public.loja_membros using (private.meu_papel() = 'admin');
alter policy loja_membros_ins on public.loja_membros with check (private.meu_papel() = 'admin');
alter policy loja_membros_sel on public.loja_membros using ((user_id = (select auth.uid())) or (private.meu_papel() = 'admin'));
alter policy loja_membros_upd on public.loja_membros using (private.meu_papel() = 'admin') with check (private.meu_papel() = 'admin');

alter policy lojas_del on public.lojas using (private.meu_papel() = 'admin');
alter policy lojas_ins on public.lojas with check (private.meu_papel() = 'admin');
alter policy lojas_sel on public.lojas using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(id));
alter policy lojas_upd on public.lojas using (private.meu_papel() = 'admin') with check (private.meu_papel() = 'admin');

alter policy lotes_del on public.lotes using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));
alter policy lotes_ins on public.lotes with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = any (array['operador','assistente'])) and private.membro_da(loja_id)));
alter policy lotes_sel on public.lotes using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(loja_id));
alter policy lotes_upd on public.lotes using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id))) with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));

alter policy pere_itens_del on public.pere_itens using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));
alter policy pere_itens_ins on public.pere_itens with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = any (array['operador','assistente'])) and private.membro_da(loja_id)));
alter policy pere_itens_sel on public.pere_itens using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(loja_id));
alter policy pere_itens_upd on public.pere_itens using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id))) with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));

alter policy pere_regs_del on public.pere_regs using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));
alter policy pere_regs_ins on public.pere_regs with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = any (array['operador','assistente'])) and private.membro_da(loja_id)));
alter policy pere_regs_sel on public.pere_regs using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(loja_id));
alter policy pere_regs_upd on public.pere_regs using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id))) with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));

alter policy perfis_del on public.perfis using (private.meu_papel() = 'admin');
alter policy perfis_ins on public.perfis with check (private.meu_papel() = 'admin');
alter policy perfis_sel on public.perfis using ((id = (select auth.uid())) or (private.meu_papel() = any (array['assistente','analista','admin'])));
alter policy perfis_upd on public.perfis using (private.meu_papel() = any (array['analista','admin'])) with check (private.meu_papel() = any (array['analista','admin']));

alter policy produtos_del on public.produtos using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));
alter policy produtos_ins on public.produtos with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = any (array['operador','assistente'])) and private.membro_da(loja_id)));
alter policy produtos_sel on public.produtos using ((private.meu_papel() = any (array['analista','admin'])) or private.membro_da(loja_id));
alter policy produtos_upd on public.produtos using ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id))) with check ((private.meu_papel() = 'admin') or ((private.meu_papel() = 'assistente') and private.membro_da(loja_id)));

-- 4) Trigger que protege o papel passa a usar a função privada
create or replace function public.protege_papel()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.papel is distinct from old.papel and private.meu_papel() <> 'admin' then
    raise exception 'Somente admin pode alterar o papel do usuario';
  end if;
  return new;
end; $$;
revoke all on function public.protege_papel() from anon, authenticated, public;

-- 5) Cópias em public das auxiliares deixam de ser chamáveis pela API
revoke all on function public.meu_papel() from anon, authenticated, public;
revoke all on function public.membro_da(uuid) from anon, authenticated, public;
