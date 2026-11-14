begin;

alter table public.perfis add column setor text
  constraint perfis_setor_check check (
    setor is null or (char_length(setor) between 1 and 120 and setor = btrim(setor)
      and setor ~ '[^[:space:]]' and setor !~ '[[:cntrl:]]')
  );

create or replace function public.protege_papel()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and private.meu_papel() is distinct from 'admin'
      and (new.papel is distinct from old.papel or new.empresa is distinct from old.empresa
        or new.setor is distinct from old.setor) then
    raise exception 'Alteração de perfil, empresa ou setor exige gestão autorizada' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A edição do setor usa o mesmo lock, escopo e transação do restante do cadastro.
-- NULL preserva o setor e uma string vazia solicita a remoção.
do $$
declare
  v_def text := pg_get_functiondef('public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean,text)'::regprocedure);
  v_novo text;
begin
  v_novo := replace(v_def, 'p_empresa text)', 'p_empresa text, p_setor text)');
  if v_novo = v_def then raise exception 'Assinatura de edição de usuário não encontrada'; end if;
  v_def := replace(v_novo, 'p_empresa is null then', 'p_empresa is null and p_setor is null then');
  v_novo := replace(v_def, 'empresa = case when', 'setor = case when p_setor is null then setor else nullif(btrim(p_setor), '''') end,
         empresa = case when');
  if v_novo = v_def then raise exception 'Atualização de perfil não encontrada'; end if;
  v_def := replace(v_novo, '''senha_solicitada'', p_senha_solicitada', '''setor_alterado'', p_setor is not null,
      ''senha_solicitada'', p_senha_solicitada');
  execute v_def;
end $$;

revoke all on function public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean,text,text) from public, anon, authenticated;
grant execute on function public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
