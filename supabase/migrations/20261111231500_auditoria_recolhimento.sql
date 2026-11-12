-- Auditoria explícita de recolhimento e reativação de lotes e perecíveis.
-- O evento é gravado na mesma transação que altera recolhido_em: falha no log
-- também cancela a mutação, preservando a trilha completa e a identidade real.
create or replace function private.audit_recolhimento_registro()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_usuario text;
  v_papel text;
  v_loja_nome text;
  v_nome_produto text;
  v_acao text;
  v_tipo text;
begin
  if old.recolhido_em is not distinct from new.recolhido_em then
    return new;
  end if;
  if (select auth.uid()) is null then
    raise exception 'Ação de recolhimento exige usuário autenticado' using errcode='42501';
  end if;

  v_acao := case when old.recolhido_em is null then 'registro_recolhido' else 'registro_reativado' end;
  v_tipo := case when tg_table_name='lotes' then 'lote' else 'perecivel' end;
  select coalesce(nullif(trim(p.nome),''),u.email,(select auth.uid())::text),p.papel
    into v_usuario,v_papel
    from auth.users u left join public.perfis p on p.id=u.id
    where u.id=(select auth.uid());
  select l.nome into v_loja_nome from public.lojas l where l.id=new.loja_id;

  if tg_table_name='lotes' then
    select c.nome into v_nome_produto from public.catalogo c where c.ean=new.ean;
    v_nome_produto := coalesce(v_nome_produto,new.ean);
  else
    select i.descricao into v_nome_produto
      from public.pere_itens i
      where i.loja_id=new.loja_id and i.cod=new.cod and i.deleted_at is null
      order by i.updated_at desc nulls last limit 1;
    v_nome_produto := coalesce(v_nome_produto,new.cod);
  end if;

  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values(
    (select auth.uid()),
    coalesce(v_usuario,(select auth.uid())::text),
    v_papel,
    new.loja_id,
    v_loja_nome,
    v_acao,
    jsonb_build_object(
      'tipo',v_tipo,
      'registro_id',new.id,
      'produto',v_nome_produto,
      'validade',new.val,
      'estado_anterior',case when old.recolhido_em is null then 'ativo' else 'recolhido' end,
      'estado_novo',case when new.recolhido_em is null then 'ativo' else 'recolhido' end,
      'recolhido_em',new.recolhido_em,
      'recolhido_por',new.recolhido_por
    )
  );
  return new;
end;
$$;
revoke all on function private.audit_recolhimento_registro() from public,anon,authenticated;

drop trigger if exists lotes_audit_recolhimento on public.lotes;
create trigger lotes_audit_recolhimento
after update of recolhido_em,recolhido_por on public.lotes
for each row execute function private.audit_recolhimento_registro();

drop trigger if exists pere_regs_audit_recolhimento on public.pere_regs;
create trigger pere_regs_audit_recolhimento
after update of recolhido_em,recolhido_por on public.pere_regs
for each row execute function private.audit_recolhimento_registro();

create index if not exists auditoria_recolhimento_loja_data_idx
  on public.auditoria(loja_id,criado desc)
  where acao in ('registro_recolhido','registro_reativado');

notify pgrst,'reload schema';
