-- Os tokens do Cosmos são segredos pessoais, não dados administrativos compartilhados.
-- Remove a policy ampla criada pela matriz de papéis; mantém prefs_sel/ins/upd por user_id.
drop policy if exists preferencias_admin_all on public.preferencias;
comment on table public.preferencias is 'Preferências pessoais; cosmos_token é visível e editável somente pelo próprio usuário autenticado, conforme policies prefs_sel/prefs_ins/prefs_upd.';
