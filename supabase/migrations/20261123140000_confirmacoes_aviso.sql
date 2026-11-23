begin;

create table private.confirmacoes_aviso (
  notificacao_id uuid primary key references public.notificacoes(id) on delete cascade,
  confirmado_em timestamptz not null default now()
);
revoke all on private.confirmacoes_aviso from public, anon, authenticated;

create function public.confirmar_aviso_ok(p_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  instante timestamptz;
begin
  perform 1 from public.notificacoes
    where id=p_id and user_id=auth.uid() and tipo='sistema_personalizado' and removida_em is null
    for update;
  if not found then raise exception 'Aviso indisponível' using errcode='42501'; end if;
  insert into private.confirmacoes_aviso(notificacao_id) values(p_id)
    on conflict(notificacao_id) do nothing;
  select confirmado_em into instante from private.confirmacoes_aviso where notificacao_id=p_id;
  update public.notificacoes set lida_em=coalesce(lida_em,instante) where id=p_id;
  return instante;
end;
$$;

create function public.relatorio_confirmacoes_aviso(p_loja uuid, p_pagina integer default 0)
returns table(envio text,titulo text,enviado_em timestamptz,destinatario text,confirmado_em timestamptz,lida_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.meu_papel() is distinct from 'admin' then
    raise exception 'Relatório exclusivo do administrador' using errcode='42501';
  end if;
  return query
    select n.payload->>'envio_id',n.titulo,n.criado,coalesce(nullif(p.nome,''),n.user_id::text),c.confirmado_em,n.lida_em
      from public.notificacoes n left join public.perfis p on p.id=n.user_id
      left join private.confirmacoes_aviso c on c.notificacao_id=n.id
      where n.tipo='sistema_personalizado' and n.loja_id=p_loja
      order by n.criado desc,n.payload->>'envio_id',p.nome,n.id
      limit 51 offset greatest(coalesce(p_pagina,0),0)::bigint*50;
end;
$$;
revoke all on function public.confirmar_aviso_ok(uuid), public.relatorio_confirmacoes_aviso(uuid,integer) from public,anon;
grant execute on function public.confirmar_aviso_ok(uuid), public.relatorio_confirmacoes_aviso(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
