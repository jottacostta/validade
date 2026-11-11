-- Alertas personalizados: aviso de sistema escrito por quem tem a permissão `alertas_enviar`
-- (por padrão só o Administrador; ele pode conceder a outros perfis em Perfis de acesso).
-- O aviso entra em public.notificacoes (aba Sistema) de cada destinatário; o push é disparado
-- pela Edge Function `alertas` (action custom-push), só pelo próprio remetente.
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

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('public.definir_permissao_papel(text,text,boolean)'::regprocedure);
  v_novo := replace(v_def, $a$'dados_manutencao','usuarios_excluir')$a$, $b$'dados_manutencao','usuarios_excluir','alertas_enviar')$b$);
  if v_novo = v_def then raise exception 'definir_permissao_papel: lista de permissões não encontrada'; end if;
  execute v_novo;
end $$;

create index if not exists notificacoes_envio_idx on public.notificacoes ((payload->>'envio_id'))
  where tipo = 'sistema_personalizado';

-- p_loja_id nulo = todas as lojas (exige alcance global). p_papel nulo = todos os perfis.
create or replace function public.enviar_alerta_personalizado(p_titulo text, p_mensagem text, p_loja_id uuid default null, p_papel text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_titulo text; v_msg text; v_envio uuid := gen_random_uuid(); v_usuario text; v_papel text; v_loja_nome text; v_n integer; v_loja_padrao uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not coalesce(private.tem_permissao('alertas_enviar'), false) then
    raise exception 'Perfil sem permissão para enviar alertas' using errcode = '42501';
  end if;
  v_titulo := trim(regexp_replace(coalesce(p_titulo,''), '\s+', ' ', 'g'));
  v_msg := trim(coalesce(p_mensagem,''));
  if length(v_titulo) < 3 or length(v_titulo) > 80 then raise exception 'Informe um título entre 3 e 80 caracteres'; end if;
  if length(v_msg) < 3 or length(v_msg) > 500 then raise exception 'Informe uma mensagem entre 3 e 500 caracteres'; end if;
  if p_papel is not null and p_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Perfil de destino inválido';
  end if;
  if p_loja_id is null then
    if not coalesce(private.tem_escopo_global(), false) then
      raise exception 'Seu perfil só pode enviar para as lojas vinculadas' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.lojas l where l.id = p_loja_id) then raise exception 'Loja não encontrada'; end if;
    if not coalesce(private.tem_escopo_global(), false) and not private.membro_da(p_loja_id) then
      raise exception 'Sem acesso à loja' using errcode = '42501';
    end if;
  end if;

  v_papel := private.meu_papel();
  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id = p_loja_id;
  select l.id into v_loja_padrao from public.lojas l order by l.nome, l.id limit 1;

  with destinatarios as (
    -- loja escolhida: vinculados a ela + perfis que recebem avisos de todas as lojas
    select pf.id as user_id, p_loja_id as loja_id
      from public.perfis pf
     where p_loja_id is not null
       and (exists (select 1 from public.loja_membros lm where lm.user_id = pf.id and lm.loja_id = p_loja_id)
            or public.papel_tem_permissao(pf.papel, 'avisos_todas_lojas'))
    union
    -- todas as lojas: todo usuário, com uma loja de referência (a primeira vinculada, ou a primeira da rede)
    select pf.id, coalesce((select lm.loja_id from public.loja_membros lm where lm.user_id = pf.id order by lm.loja_id limit 1), v_loja_padrao)
      from public.perfis pf
     where p_loja_id is null
  )
  insert into public.notificacoes(user_id, loja_id, dedupe_key, tipo, titulo, mensagem, payload)
  select d.user_id, d.loja_id, 'personalizado:' || v_envio::text, 'sistema_personalizado', v_titulo, v_msg,
         jsonb_build_object('envio_id', v_envio, 'remetente_id', auth.uid(), 'remetente_nome', v_usuario,
                            'loja_destino', p_loja_id, 'papel_destino', p_papel)
    from destinatarios d join public.perfis pf on pf.id = d.user_id
   where d.loja_id is not null
     and d.user_id <> auth.uid()
     and (p_papel is null or pf.papel = p_papel)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;

  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values (auth.uid(), v_usuario, v_papel, p_loja_id, v_loja_nome, 'alerta_personalizado_enviado',
    jsonb_build_object('envio_id', v_envio, 'titulo', v_titulo, 'papel_destino', p_papel, 'destinatarios', v_n));
  return jsonb_build_object('envio_id', v_envio, 'destinatarios', v_n);
end;
$$;
revoke all on function public.enviar_alerta_personalizado(text,text,uuid,text) from public, anon;
grant execute on function public.enviar_alerta_personalizado(text,text,uuid,text) to authenticated;

commit;
