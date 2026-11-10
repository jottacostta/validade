-- Decisão do proprietário (10/11/2026): analista, gerente e administrador recebem os
-- avisos de validade de TODAS as lojas; operador e assistente continuam recebendo só
-- das lojas em que estão vinculados.
--
-- 1) gerar_alertas_validade(): destinatários = vinculados à loja + perfis de escopo global.
--    O restante da função é idêntico ao da migration 20261109000000.
-- 2) Políticas de notificacoes: o destinatário de escopo global precisa conseguir ler e
--    marcar as próprias notificações de lojas em que não tem vínculo. Continua valendo
--    user_id = auth.uid(): ninguém lê notificação de outra pessoa.

create or replace function public.gerar_alertas_validade()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_rows jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role pode gerar alertas'; end if;
  with fontes as (
    select l.id as registro_id,l.loja_id,l.val,l.ean as codigo,coalesce(c.nome,l.ean) as nome,l.lote as referencia,l.setor,
      'lote'::text as fonte from public.lotes l left join public.catalogo c on c.ean=l.ean
    where l.deleted_at is null and l.val is not null
    union all
    select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel'
    from public.pere_regs r left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod
    where r.deleted_at is null and r.val is not null
  ), candidatos as (
    select f.*,lo.nome as loja_nome,
      case when f.val < current_date then 'validade_vencida' else 'validade_proxima' end as tipo,
      case when f.val < current_date then 'Produto vencido' else 'Validade próxima' end as titulo,
      case when f.val < current_date then 'Registro vencido em '||f.val::text else 'Registro vence em '||f.val::text end as mensagem
    from fontes f join public.lojas lo on lo.id=f.loja_id
    where f.val < current_date or f.val between current_date and current_date + coalesce((select a.dias from public.ajustes a where a.loja_id=f.loja_id),30)
  ), ins as (
    insert into public.notificacoes(user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
    select m.user_id,c.loja_id,
      c.fonte||':'||c.registro_id||':'||c.val::text||':'||c.tipo,
      c.tipo,c.titulo,c.mensagem,
      jsonb_build_object('fonte',c.fonte,'registro_id',c.registro_id,'nome',c.nome,'codigo',c.codigo,
        'lote_ou_sif',c.referencia,'setor',c.setor,'validade',c.val,'loja_id',c.loja_id,'loja',c.loja_nome)
    from candidatos c join (
        -- vinculados à loja (operador, assistente e quem mais tiver vínculo)
        select lm.user_id, lm.loja_id from public.loja_membros lm
        union
        -- perfis de escopo global recebem avisos de todas as lojas
        select p.id, lo.id from public.perfis p cross join public.lojas lo
        where p.papel in ('analista','gerente','admin')
      ) m on m.loja_id=c.loja_id
    on conflict(user_id,dedupe_key) do nothing
    returning id,user_id,loja_id,tipo,titulo,mensagem,payload,criado
  ) select coalesce(jsonb_agg(to_jsonb(ins)),'[]'::jsonb) into v_rows from ins;
  return v_rows;
end;
$$;
revoke all on function public.gerar_alertas_validade() from public,anon,authenticated;
grant execute on function public.gerar_alertas_validade() to service_role;

alter policy notificacoes_sel_own_store on public.notificacoes
  using (user_id=(select auth.uid()) and (private.membro_da(loja_id) or private.tem_escopo_global()));
alter policy notificacoes_upd_own_store on public.notificacoes
  using (user_id=(select auth.uid()) and (private.membro_da(loja_id) or private.tem_escopo_global()))
  with check (user_id=(select auth.uid()) and (private.membro_da(loja_id) or private.tem_escopo_global()));
