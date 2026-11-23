begin;
create table private.rede_ocultos(
 loja_id uuid not null references public.lojas on delete cascade, tipo text not null, registro text not null,
 primary key(loja_id,tipo,registro)
);
revoke all on private.rede_ocultos from public,anon,authenticated;
create view private.rede_registros as
 select l.loja_id,'lote'::text tipo,l.id,coalesce(c.nome,l.ean) nome,l.lote referencia,l.qtd quantidade,l.val,l.criado,l.created_by_nome autor,l.recolhido_em
 from public.lotes l left join public.catalogo c on c.ean=l.ean where l.deleted_at is null
 union all
 select r.loja_id,'perecivel',r.id,coalesce(i.descricao,r.cod),r.sif,r.peso,r.val,r.criado,r.created_by_nome,r.recolhido_em
 from public.pere_regs r left join public.pere_itens i on i.cod=r.cod and i.loja_id=r.loja_id where r.deleted_at is null;
revoke all on private.rede_registros from public,anon,authenticated;
create function private.exigir_admin_rede() returns void language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.meu_papel() is distinct from 'admin' then raise exception 'Acesso exclusivo do administrador' using errcode='42501'; end if;
end; $$;
create function public.rede_consultar(p_loja uuid default null,p_pagina integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.exigir_admin_rede();
 if p_loja is null then
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]') from (
 select l.id,l.nome,coalesce(r.total,0) registros,coalesce(r.recolhidos,0) recolhidos,coalesce(u.total,0) usuarios from public.lojas l
 left join (select loja_id,count(*) total,count(recolhido_em) recolhidos from private.rede_registros group by loja_id) r on r.loja_id=l.id
 left join (select loja_id,count(distinct user_id) total from public.loja_membros group by loja_id) u on u.loja_id=l.id) x);
 end if;
 return jsonb_build_object('usuarios',(select coalesce(jsonb_agg(jsonb_build_object('nome',coalesce(p.nome,p.id::text),'perfil',p.papel) order by p.nome),'[]') from public.loja_membros m join public.perfis p on p.id=m.user_id where m.loja_id=p_loja),
 'registros',(select coalesce(jsonb_agg(to_jsonb(x) order by x.criado desc nulls last,x.tipo,x.id),'[]') from (
 select r.*,o.registro is not null oculto from private.rede_registros r left join private.rede_ocultos o on (o.loja_id,o.tipo,o.registro)=(r.loja_id,r.tipo,r.id)
 where r.loja_id=p_loja order by r.criado desc nulls last,r.tipo,r.id limit 51 offset greatest(0,p_pagina)::bigint*50) x));
end; $$;
create function public.rede_gerir_registro(p_loja uuid,p_tipo text,p_id text,p_acao text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.exigir_admin_rede();
 if not exists(select 1 from private.rede_registros where loja_id=p_loja and tipo=p_tipo and id=p_id) then raise exception 'Registro indisponível nesta filial'; end if;
 case p_acao
 when 'ocultar' then insert into private.rede_ocultos values(p_loja,p_tipo,p_id) on conflict do nothing;
 when 'mostrar' then delete from private.rede_ocultos where loja_id=p_loja and tipo=p_tipo and registro=p_id;
 when 'excluir' then
 if p_tipo='lote' then update public.lotes set deleted_at=now(),updated_at=now() where loja_id=p_loja and id=p_id and deleted_at is null;
 else update public.pere_regs set deleted_at=now(),updated_at=now() where loja_id=p_loja and id=p_id and deleted_at is null; end if;
 else raise exception 'Ação inválida';
 end case;
 insert into public.auditoria(user_id,papel,loja_id,acao,detalhe) values(auth.uid(),'admin',p_loja,'rede_'||p_acao,jsonb_build_object('tipo',p_tipo,'registro_id',p_id));
end; $$;
revoke all on function public.rede_consultar(uuid,integer), public.rede_gerir_registro(uuid,text,text,text) from public,anon;
grant execute on function public.rede_consultar(uuid,integer), public.rede_gerir_registro(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;