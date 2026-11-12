-- Permissão Recolher é configurável por perfil no painel do Administrador.
-- Por padrão, todos os perfis de loja podem recolher registros; reativar continua restrito a assistente+.
begin;

create or replace function private.permissao_padrao(p_papel text, p_permissao text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select p_papel = any (d.papeis)
    from (values
      ('registrar',               array['operador','assistente','analista','gerente']),
      ('editar_proprios',         array['operador','assistente','analista','gerente']),
      ('solicitar_exclusao',      array['operador','assistente','analista','gerente']),
      ('nome_solicitar',          array['operador','assistente','analista','gerente']),
      ('registros_recolher',      array['operador','assistente','analista','gerente']),
      ('relatorios',              array['analista','gerente']),
      ('registros_editar_outros', array['analista','gerente']),
      ('exclusoes_aprovar',       array['assistente','analista','gerente']),
      ('nome_editar',             array['gerente']),
      ('usuarios_gerenciar',      array['analista','gerente']),
      ('usuarios_excluir',        array['gerente']),
      ('alertas_loja_configurar', array['gerente']),
      ('avisos_todas_lojas',      array['analista','gerente']),
      ('alertas_enviar',          array[]::text[]),
      ('lojas_gerenciar',         array[]::text[]),
      ('catalogo_gerenciar',      array[]::text[]),
      ('auditoria_ver',           array[]::text[]),
      ('dados_manutencao',        array[]::text[])
    ) as d(permissao, papeis)
    where d.permissao = p_permissao
  ), false);
$$;
revoke all on function private.permissao_padrao(text,text) from public, anon;
grant execute on function private.permissao_padrao(text,text) to authenticated, service_role;

-- O Administrador configura a permissão pelo painel existente de Perfis de acesso.
create or replace function public.definir_permissao_papel(p_papel text, p_permissao text, p_permitido boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_usuario text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if private.meu_papel() is distinct from 'admin' then
    raise exception 'Somente o Administrador define permissões' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('operador','assistente','analista','gerente') then
    raise exception 'Perfil inválido';
  end if;
  if p_permissao is null or p_permissao not in (
    'registrar','editar_proprios','solicitar_exclusao','nome_solicitar','relatorios',
    'registros_editar_outros','exclusoes_aprovar','nome_editar','usuarios_gerenciar',
    'alertas_loja_configurar','avisos_todas_lojas','lojas_gerenciar','catalogo_gerenciar',
    'auditoria_ver','dados_manutencao','usuarios_excluir','alertas_enviar','registros_recolher') then
    raise exception 'Permissão inválida';
  end if;
  if p_permitido is null then raise exception 'Valor inválido'; end if;

  insert into public.papel_permissoes(papel,permissao,permitido,atualizado_em,atualizado_por)
  values (p_papel,p_permissao,p_permitido,now(),auth.uid())
  on conflict (papel,permissao) do update
    set permitido = excluded.permitido, atualizado_em = now(), atualizado_por = auth.uid();

  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  insert into public.auditoria(user_id,usuario,papel,acao,detalhe)
  values (auth.uid(),v_usuario,'admin','permissao_alterada',
    jsonb_build_object('papel',p_papel,'permissao',p_permissao,'permitido',p_permitido));
end;
$$;
revoke all on function public.definir_permissao_papel(text,text,boolean) from public, anon;
grant execute on function public.definir_permissao_papel(text,text,boolean) to authenticated;

-- A função executa como definer para que membros com a permissão específica possam
-- recolher registros da própria loja mesmo quando não são seus autores. O escopo
-- da loja, a permissão configurada e a janela de validade são sempre verificados.
create or replace function public.marcar_registro_recolhido(p_tipo text, p_id uuid, p_loja_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_val date;
  v_recolhido_em timestamptz;
  v_recolhido_por uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É necessário estar autenticado' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('lote','perecivel') or p_id is null or p_loja_id is null then
    raise exception 'Identificação do registro inválida' using errcode='22023';
  end if;
  if not coalesce(private.tem_escopo_global(),false)
     and not coalesce(private.membro_da(p_loja_id),false) then
    raise exception 'Sem acesso à loja' using errcode='42501';
  end if;
  if not coalesce(private.tem_permissao('registros_recolher'),false) then
    raise exception 'Seu perfil não tem permissão para recolher registros' using errcode='42501';
  end if;

  if p_tipo='lote' then
    select l.val,l.recolhido_em,l.recolhido_por
      into v_val,v_recolhido_em,v_recolhido_por
      from public.lotes l where l.id=p_id and l.loja_id=p_loja_id and l.deleted_at is null
      for update;
  else
    select r.val,r.recolhido_em,r.recolhido_por
      into v_val,v_recolhido_em,v_recolhido_por
      from public.pere_regs r where r.id=p_id and r.loja_id=p_loja_id and r.deleted_at is null
      for update;
  end if;
  if not found then
    raise exception 'Registro não encontrado ou sem acesso' using errcode='42501';
  end if;
  if v_recolhido_em is not null then
    return jsonb_build_object('tipo',p_tipo,'id',p_id,'recolhido_em',v_recolhido_em,
      'recolhido_por',v_recolhido_por,'ja_recolhido',true);
  end if;
  if v_val is null or v_val<v_hoje or v_val>v_hoje+5 then
    raise exception 'O recolhimento está disponível somente para produtos que vencem hoje ou nos próximos 5 dias.' using errcode='22023';
  end if;

  perform set_config('validade.recolhimento_rpc','on',true);
  if p_tipo='lote' then
    update public.lotes set recolhido_em=now(),recolhido_por=(select auth.uid())
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is null;
  else
    update public.pere_regs set recolhido_em=now(),recolhido_por=(select auth.uid())
      where id=p_id and loja_id=p_loja_id and deleted_at is null and recolhido_em is null;
  end if;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'O registro mudou durante a operação; atualize e tente novamente' using errcode='40001'; end if;

  return jsonb_build_object('tipo',p_tipo,'id',p_id,'recolhido_em',now(),
    'recolhido_por',(select auth.uid()),'ja_recolhido',false);
end;
$$;
revoke all on function public.marcar_registro_recolhido(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.marcar_registro_recolhido(text,uuid,uuid) to authenticated;

commit;
