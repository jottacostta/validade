-- Separa o Promotor do Operador em `papel_permissoes`: o Administrador pode
-- marcar permissões específicas para Promotor. Padrão inicial segue o Operador
-- (como estava desde a introdução do Promotor em 2026-11-14) para não mudar
-- comportamento sem autorização. Decisão do proprietário em 14/11/2026.
begin;

alter table public.papel_permissoes drop constraint if exists papel_permissoes_papel_check;
alter table public.papel_permissoes
  add constraint papel_permissoes_papel_check
  check (papel in ('operador','promotor','assistente','analista','gerente'));

-- Agora a linha com papel='promotor' prevalece sobre os padrões do Operador.
-- Quando não houver linha para Promotor, usa os padrões do Operador (compatível).
create or replace function public.papel_tem_permissao(p_papel text, p_permissao text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_papel is null then false
    when p_papel = 'admin' then true
    when p_papel = 'promotor' then coalesce(
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = 'promotor' and pp.permissao = p_permissao),
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = 'operador' and pp.permissao = p_permissao),
      private.permissao_padrao('operador', p_permissao))
    else coalesce(
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = p_papel and pp.permissao = p_permissao),
      private.permissao_padrao(p_papel, p_permissao))
  end;
$$;

-- O Administrador pode salvar permissões para 'promotor'.
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.definir_permissao_papel(text,text,boolean)'::regprocedure);
  v_novo := replace(v_def,
    $a$('operador','assistente','analista','gerente')$a$,
    $b$('operador','promotor','assistente','analista','gerente')$b$);
  if v_novo = v_def then raise exception 'definir_permissao_papel: lista de perfis não encontrada'; end if;
  execute v_novo;
end $$;

notify pgrst, 'reload schema';
commit;
