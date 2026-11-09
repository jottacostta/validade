-- Defesa fail-closed: usuários sem perfil/papel não podem revisar solicitações.
-- Aplicada ao Supabase sob a migration 20261109122158_harden_review_role_null.
create or replace function public.revisar_solicitacao_exclusao(
  p_id uuid, p_aprovar boolean, p_resposta text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare r public.solicitacoes_exclusao%rowtype; v_papel text; v_usuario text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if coalesce(v_papel,'') not in ('assistente','analista','gerente','admin') then
    raise exception 'Perfil sem permissão para revisar exclusões';
  end if;
  select * into r from public.solicitacoes_exclusao where id=p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if not coalesce(private.tem_escopo_global(),false) and not private.membro_da(r.loja_id) then
    raise exception 'Sem acesso à loja';
  end if;
  if r.status <> 'pendente' then raise exception 'Solicitação já revisada'; end if;
  if not p_aprovar and (p_resposta is null or length(trim(p_resposta)) < 3) then
    raise exception 'Informe o motivo da rejeição';
  end if;
  if p_aprovar then
    if r.tipo='produto' then
      update public.produtos set deleted_at=now() where loja_id=r.loja_id and ean=r.registro_id and deleted_at is null;
      if not found then raise exception 'Registro já removido ou não encontrado'; end if;
      update public.lotes set deleted_at=now() where loja_id=r.loja_id and ean=r.registro_id and deleted_at is null;
    elsif r.tipo='lote' then
      update public.lotes set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
      if not found then raise exception 'Registro já removido ou não encontrado'; end if;
    elsif r.tipo='pere_item' then
      update public.pere_itens set deleted_at=now() where loja_id=r.loja_id and cod=r.registro_id and deleted_at is null;
      if not found then raise exception 'Registro já removido ou não encontrado'; end if;
      update public.pere_regs set deleted_at=now() where loja_id=r.loja_id and cod=r.registro_id and deleted_at is null;
    elsif r.tipo='pere_reg' then
      update public.pere_regs set deleted_at=now() where loja_id=r.loja_id and id=r.registro_id and deleted_at is null;
      if not found then raise exception 'Registro já removido ou não encontrado'; end if;
    else
      raise exception 'Tipo de registro inválido para exclusão: %', r.tipo;
    end if;
  end if;
  update public.solicitacoes_exclusao
  set status=case when p_aprovar then 'aprovada' else 'rejeitada' end,
      revisor_id=auth.uid(),resposta=nullif(trim(p_resposta),''),revisado_em=now()
  where id=p_id;
  select coalesce(p.nome,u.email,auth.uid()::text),p.papel,l.nome
    into v_usuario,v_papel,v_loja_nome
    from auth.users u left join public.perfis p on p.id=u.id
    left join public.lojas l on l.id=r.loja_id where u.id=auth.uid();
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values(auth.uid(),v_usuario,v_papel,r.loja_id,v_loja_nome,
    case when p_aprovar then 'exclusao_aprovada' else 'exclusao_rejeitada' end,
    jsonb_build_object('solicitacao_id',r.id,'tipo',r.tipo,'registro_id',r.registro_id,
      'solicitante_id',r.solicitante_id,'motivo',r.motivo,'resposta',p_resposta));
end;
$$;
revoke all on function public.revisar_solicitacao_exclusao(uuid,boolean,text) from public,anon;
grant execute on function public.revisar_solicitacao_exclusao(uuid,boolean,text) to authenticated;
