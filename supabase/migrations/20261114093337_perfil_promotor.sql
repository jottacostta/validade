-- Promotor tem identidade própria no cadastro e usa as permissões do Operador.
begin;

alter table public.perfis
  add column empresa text,
  drop constraint perfis_papel_check,
  add constraint perfis_papel_check
    check (papel in ('operador','promotor','assistente','analista','gerente','admin')),
  add constraint perfis_empresa_promotor_check check (
    (papel = 'promotor' and empresa is not null and char_length(empresa) between 1 and 120
      and empresa = btrim(empresa) and empresa ~ '[^[:space:]]' and empresa !~ '[[:cntrl:]]')
    or (papel <> 'promotor' and empresa is null)
  );

create or replace function public.papel_tem_permissao(p_papel text, p_permissao text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_papel is null then false
    when p_papel = 'admin' then true
    else coalesce(
      (select pp.permitido from public.papel_permissoes pp
        where pp.papel = (case when p_papel = 'promotor' then 'operador' else p_papel end)
          and pp.permissao = p_permissao),
      private.permissao_padrao(case when p_papel = 'promotor' then 'operador' else p_papel end, p_permissao))
  end;
$$;

create or replace function private.tem_permissao(p_permissao text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.papel_tem_permissao(private.meu_papel(), p_permissao);
$$;

-- Os testes por papel de alvo em RLS tratam Promotor no nível de Operador.
create or replace function private.usuario_tem_papel(p_usuario uuid, p_papel text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = p_usuario and (papel = p_papel or (p_papel = 'operador' and papel = 'promotor'))
  );
$$;

-- Preserva a proteção de papel para acesso direto à tabela e protege Empresa
-- no mesmo gatilho. A Edge Function usa service_role e revalida ator e escopo na RPC.
create or replace function public.protege_papel()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and private.meu_papel() is distinct from 'admin'
      and (new.papel is distinct from old.papel or new.empresa is distinct from old.empresa) then
    raise exception 'Alteração de perfil ou empresa exige gestão autorizada' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Mantém as regras de escopo, hierarquia e concorrência da RPC existente.
-- A nova assinatura recebe Empresa junto com o restante do cadastro na mesma transação.
do $$
declare v_def text; v_original text;
begin
  v_original := pg_get_functiondef('public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean)'::regprocedure);
  v_def := replace(v_original,
    'p_nome text DEFAULT NULL::text, p_papel text DEFAULT NULL::text, p_lojas uuid[] DEFAULT NULL::uuid[], p_senha_solicitada boolean DEFAULT false)',
    'p_nome text, p_papel text, p_lojas uuid[], p_senha_solicitada boolean, p_empresa text)');
  if v_def = v_original then raise exception 'editar_usuario_atomico: assinatura esperada não encontrada'; end if;

  v_def := replace(v_def, '(''operador'',''assistente'',''analista'',''gerente'',''admin'')',
                          '(''operador'',''promotor'',''assistente'',''analista'',''gerente'',''admin'')');
  v_def := replace(v_def, 'when ''operador'' then 1', 'when ''operador'' then 1 when ''promotor'' then 1');
  v_def := replace(v_def, 'p_nome is null and p_papel is null and p_lojas is null then',
                          'p_nome is null and p_papel is null and p_lojas is null and p_empresa is null then');
  v_def := replace(v_def, $old$  update public.perfis
     set nome = coalesce(v_nome_novo, nome),
         papel = coalesce(p_papel, papel)
   where id = p_target_id;$old$, $new$  if p_empresa is not null and coalesce(p_papel, v_target_papel) <> 'promotor' then
    raise exception 'Empresa é um campo do perfil Promotor' using errcode = '22023';
  end if;

  update public.perfis
     set nome = coalesce(v_nome_novo, nome),
         papel = coalesce(p_papel, papel),
         empresa = case when coalesce(p_papel, papel) = 'promotor' then coalesce(btrim(p_empresa), empresa) end
   where id = p_target_id;$new$);
  if strpos(v_def, 'empresa = case') = 0 then
    raise exception 'editar_usuario_atomico: atualização do perfil não encontrada';
  end if;
  execute v_def;
end $$;

revoke all on function public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean,text) from public, anon, authenticated;
grant execute on function public.editar_usuario_atomico(uuid,uuid,text,text,uuid[],boolean,text) to service_role;

-- Mantém a assinatura usada pela versão anterior da Edge Function durante a publicação.
create or replace function public.editar_usuario_atomico(
  p_actor_id uuid, p_target_id uuid, p_nome text default null, p_papel text default null,
  p_lojas uuid[] default null, p_senha_solicitada boolean default false
) returns jsonb
language sql security invoker set search_path = ''
as $$
  select public.editar_usuario_atomico(p_actor_id, p_target_id, p_nome, p_papel, p_lojas, p_senha_solicitada, null::text);
$$;

alter policy perfis_upd on public.perfis
  with check (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('usuarios_gerenciar')
      and private.usuario_no_escopo(id)
      and papel in ('operador','promotor','assistente')
    )
  );

-- RPCs que validam explicitamente perfis precisam reconhecer o papel cadastrado.
do $$
declare v_rpc regprocedure; v_def text; v_novo text;
begin
  foreach v_rpc in array array[
    'public.enviar_alerta_personalizado(text,text,uuid,text)'::regprocedure,
    'public.salvar_foto_catalogo(text,uuid,text,uuid,text)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_rpc);
    v_novo := replace(v_def, '(''operador'',''assistente'',''analista'',''gerente'',''admin'')',
                            '(''operador'',''promotor'',''assistente'',''analista'',''gerente'',''admin'')');
    if v_novo = v_def then raise exception '%: lista de perfis não encontrada', v_rpc; end if;
    execute v_novo;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
