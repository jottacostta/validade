-- Edição de cadastro e vínculos em uma única transação SQL.
-- A senha permanece no Auth Admin API e é aplicada pela Edge Function somente após
-- esta RPC confirmar o commit; falha do Auth não desfaz a transação do Postgres.
begin;

create or replace function public.editar_usuario_atomico(
  p_actor_id uuid,
  p_target_id uuid,
  p_nome text default null,
  p_papel text default null,
  p_lojas uuid[] default null,
  p_senha_solicitada boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_papel text;
  v_actor_nome text;
  v_target_nome text;
  v_target_papel text;
  v_nome_novo text;
  v_lojas_antes uuid[] := '{}'::uuid[];
  v_lojas_depois uuid[] := '{}'::uuid[];
  v_lojas_distintas bigint;
  v_admins bigint;
begin
  -- Esta função nunca é uma superfície de cliente. O actor_id é aceito somente
  -- porque a Edge Function o deriva do JWT já validado pelo Auth Admin API.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente service_role pode editar usuários' using errcode = '42501';
  end if;
  if p_actor_id is null or p_target_id is null then
    raise exception 'Ator e usuário alvo são obrigatórios' using errcode = '22023';
  end if;
  if p_nome is null and p_papel is null and p_lojas is null then
    raise exception 'Nenhuma alteração de cadastro foi informada' using errcode = '22023';
  end if;
  if p_senha_solicitada is null then
    raise exception 'Indicador de senha inválido' using errcode = '22023';
  end if;

  -- O papel e o nome do ator vêm do banco, nunca do payload da Edge Function.
  select pf.papel,
         coalesce(nullif(btrim(pf.nome), ''), au.email, p_actor_id::text)
    into v_actor_papel, v_actor_nome
    from public.perfis pf
    left join auth.users au on au.id = pf.id
   where pf.id = p_actor_id;
  if not found or v_actor_papel is null then
    raise exception 'Perfil do ator não encontrado' using errcode = '42501';
  end if;
  if v_actor_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Papel do ator inválido' using errcode = '42501';
  end if;
  if v_actor_papel <> 'admin'
     and not coalesce(public.papel_tem_permissao(v_actor_papel, 'usuarios_gerenciar'), false) then
    raise exception 'Ator sem permissão para gerenciar usuários' using errcode = '42501';
  end if;

  -- Validação duplicada no limite transacional: a Edge valida a forma antes da
  -- chamada, mas a RPC não confia em cliente nem em uma futura outra integração.
  if p_nome is not null then
    v_nome_novo := btrim(regexp_replace(p_nome, '\s+', ' ', 'g'));
    if v_nome_novo = '' or length(v_nome_novo) > 120 or v_nome_novo ~ '[[:cntrl:]]' then
      raise exception 'O nome deve ter entre 1 e 120 caracteres válidos' using errcode = '22023';
    end if;
  end if;
  if p_papel is not null
     and p_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Papel inválido' using errcode = '22023';
  end if;
  if p_lojas is not null then
    if cardinality(p_lojas) < 1 then
      raise exception 'O usuário precisa ter ao menos uma loja' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_lojas) as x(loja_id) where x.loja_id is null) then
      raise exception 'A lista de lojas contém ID nulo' using errcode = '22023';
    end if;
    select count(distinct x.loja_id) into v_lojas_distintas
      from unnest(p_lojas) as x(loja_id);
    if v_lojas_distintas <> cardinality(p_lojas) then
      raise exception 'A lista de lojas não pode conter repetições' using errcode = '22023';
    end if;
    if exists (
      select 1
        from unnest(p_lojas) as x(loja_id)
        left join public.lojas l on l.id = x.loja_id
       where l.id is null
    ) then
      raise exception 'Loja inexistente' using errcode = '22023';
    end if;
  end if;

  -- Lock do alvo antes de avaliar papel, último admin e memberships.
  select pf.nome, pf.papel
    into v_target_nome, v_target_papel
    from public.perfis pf
   where pf.id = p_target_id
   for update;
  if not found or v_target_papel is null then
    raise exception 'Usuário alvo não encontrado' using errcode = 'P0002';
  end if;
  if v_target_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Papel atual do usuário alvo é inválido' using errcode = '22023';
  end if;

  -- Não-admin só administra operadores/assistentes e só pode atribuir esses papéis.
  if v_actor_papel <> 'admin' and v_target_papel in ('analista','gerente','admin') then
    raise exception 'Ator não pode administrar este papel' using errcode = '42501';
  end if;
  if v_actor_papel <> 'admin'
     and p_papel is not null
     and p_papel not in ('operador','assistente') then
    raise exception 'Ator só pode atribuir Operador ou Assistente' using errcode = '42501';
  end if;

  if v_target_papel = 'admin' and p_papel is not null and p_papel <> 'admin' then
    -- Serializa a contagem para não permitir dois rebaixamentos concorrentes do último admin.
    perform 1 from public.perfis where papel = 'admin' for update;
    select count(*) into v_admins from public.perfis where papel = 'admin';
    if v_admins <= 1 then
      raise exception 'Não é possível rebaixar o último admin' using errcode = '22023';
    end if;
  end if;

  -- O alvo também precisa estar no recorte do ator; não basta esconder lojas
  -- no payload. Analista mantém o alcance global legado e Admin é global.
  if v_actor_papel not in ('admin','analista') then
    if v_actor_papel = 'assistente'
       and (select count(*) from public.loja_membros where user_id = p_actor_id) <> 1 then
      raise exception 'Assistente precisa ter exatamente uma loja vinculada' using errcode = '42501';
    end if;
    if not exists (
      select 1
        from public.loja_membros alvo_lm
       where alvo_lm.user_id = p_target_id
         and exists (
           select 1 from public.loja_membros actor_lm
            where actor_lm.user_id = p_actor_id
              and actor_lm.loja_id = alvo_lm.loja_id
         )
    ) then
      raise exception 'Usuário alvo fora do escopo do ator' using errcode = '42501';
    end if;
  end if;

  -- Admin e Analista mantêm o alcance global legado. Gerente e Assistente (e
  -- qualquer papel explicitamente autorizado) só escrevem lojas em que o ator
  -- é membro; vínculos fora desse escopo nunca são apagados pelo gerente.
  if p_lojas is not null and v_actor_papel not in ('admin','analista') then
    if exists (
      select 1
        from unnest(p_lojas) as x(loja_id)
       where not exists (
         select 1 from public.loja_membros lm
          where lm.user_id = p_actor_id and lm.loja_id = x.loja_id
       )
    ) then
      raise exception 'Loja fora do escopo do ator' using errcode = '42501';
    end if;
    if v_actor_papel = 'assistente' and cardinality(p_lojas) <> 1 then
      raise exception 'Assistente só pode manter uma loja vinculada' using errcode = '42501';
    end if;
  end if;

  -- Lock e snapshot dos vínculos entram na mesma transação do cadastro.
  perform 1 from public.loja_membros where user_id = p_target_id for update;
  select coalesce(array_agg(lm.loja_id order by lm.loja_id), '{}'::uuid[])
    into v_lojas_antes
    from public.loja_membros lm
   where lm.user_id = p_target_id;

  -- A conta de Assistente precisa terminar com exatamente uma loja, inclusive
  -- quando o gerente preserva vínculos externos que não aparecem no seu recorte.
  if coalesce(p_papel,v_target_papel) = 'assistente' then
    if p_lojas is null then
      v_lojas_depois := v_lojas_antes;
    elsif v_actor_papel in ('admin','analista') then
      v_lojas_depois := p_lojas;
    else
      select coalesce(array_agg(distinct x.loja_id),'{}'::uuid[]) into v_lojas_depois
      from (
        select unnest(p_lojas) as loja_id
        union
        select lm.loja_id from public.loja_membros lm
        where lm.user_id=p_target_id and not exists (
          select 1 from public.loja_membros actor_lm
          where actor_lm.user_id=p_actor_id and actor_lm.loja_id=lm.loja_id)
      ) x;
    end if;
    if cardinality(v_lojas_depois) <> 1 then
      raise exception 'O perfil Assistente exige exatamente uma loja; solicite ajuste ao Administrador' using errcode='22023';
    end if;
  end if;

  update public.perfis
     set nome = coalesce(v_nome_novo, nome),
         papel = coalesce(p_papel, papel)
   where id = p_target_id;

  if p_lojas is not null then
    if v_actor_papel in ('admin','analista') then
      delete from public.loja_membros lm
       where lm.user_id = p_target_id
         and not (lm.loja_id = any(p_lojas));
    else
      -- O gerente altera somente o recorte de memberships que consegue ver.
      delete from public.loja_membros lm
       where lm.user_id = p_target_id
         and exists (
           select 1 from public.loja_membros actor_lm
            where actor_lm.user_id = p_actor_id
              and actor_lm.loja_id = lm.loja_id
         )
         and not (lm.loja_id = any(p_lojas));
    end if;
    insert into public.loja_membros(user_id, loja_id)
      select p_target_id, x.loja_id
        from unnest(p_lojas) as x(loja_id)
       on conflict (loja_id, user_id) do nothing;
  end if;

  select coalesce(array_agg(lm.loja_id order by lm.loja_id), '{}'::uuid[])
    into v_lojas_depois
    from public.loja_membros lm
   where lm.user_id = p_target_id;

  -- A identidade da auditoria é derivada do perfil do ator acima e inserida
  -- antes do commit desta mesma função. Nenhum nome/papel do payload é usado.
  insert into public.auditoria(user_id, usuario, papel, acao, detalhe)
  values (
    p_actor_id,
    v_actor_nome,
    v_actor_papel,
    'editou_usuario',
    jsonb_build_object(
      'alvo_id', p_target_id,
      'nome_anterior', v_target_nome,
      'nome_novo', coalesce(v_nome_novo, v_target_nome),
      'papel_anterior', v_target_papel,
      'papel_novo', coalesce(p_papel, v_target_papel),
      'lojas_anteriores', to_jsonb(v_lojas_antes),
      'lojas_novas', to_jsonb(v_lojas_depois),
      'senha_solicitada', p_senha_solicitada
    )
  );

  return jsonb_build_object(
    'ok', true,
    'cadastro_atualizado', true,
    'nome_atualizado', p_nome is not null,
    'papel_atualizado', p_papel is not null,
    'lojas_atualizadas', p_lojas is not null,
    'auditoria_registrada', true,
    'senha_atualizada', false,
    'parcial', false,
    'lojas', to_jsonb(v_lojas_depois)
  );
end;
$fn$;

revoke all on function public.editar_usuario_atomico(uuid, uuid, text, text, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.editar_usuario_atomico(uuid, uuid, text, text, uuid[], boolean)
  to service_role;

notify pgrst, 'reload schema';
commit;
