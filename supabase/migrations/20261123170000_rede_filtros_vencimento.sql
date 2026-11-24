-- Painel "Todas as lojas": contagem de registros a vencer e vencidos por filial.
-- Amplia a visão geral (p_loja is null) de public.rede_consultar para devolver,
-- por filial, quantos registros ativos (não recolhidos) estão vencidos ou próximos
-- do vencimento. "Próximo do vencimento" usa o prazo configurado de cada loja
-- (public.ajustes.dias, padrão 30), mesma regra de public.gerar_alertas_validade():
--   vencido  : val < current_date
--   a_vencer : val entre current_date e current_date + dias_da_loja
-- A visão por filial (p_loja informado) permanece inalterada.
begin;
create or replace function public.rede_consultar(p_loja uuid default null,p_pagina integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.exigir_admin_rede();
 if p_loja is null then
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome),'[]') from (
 select l.id,l.nome,coalesce(r.total,0) registros,coalesce(r.recolhidos,0) recolhidos,
 coalesce(r.a_vencer,0) a_vencer,coalesce(r.vencidos,0) vencidos,coalesce(u.total,0) usuarios from public.lojas l
 left join (select loja_id,count(*) total,count(recolhido_em) recolhidos,
 count(*) filter (where recolhido_em is null and val is not null and val < current_date) vencidos,
 count(*) filter (where recolhido_em is null and val is not null and val >= current_date
 and val <= current_date + coalesce((select a.dias from public.ajustes a where a.loja_id=rede_registros.loja_id),30)) a_vencer
 from private.rede_registros group by loja_id) r on r.loja_id=l.id
 left join (select loja_id,count(distinct user_id) total from public.loja_membros group by loja_id) u on u.loja_id=l.id) x);
 end if;
 return jsonb_build_object('usuarios',(select coalesce(jsonb_agg(jsonb_build_object('nome',coalesce(p.nome,p.id::text),'perfil',p.papel) order by p.nome),'[]') from public.loja_membros m join public.perfis p on p.id=m.user_id where m.loja_id=p_loja),
 'registros',(select coalesce(jsonb_agg(to_jsonb(x) order by x.criado desc nulls last,x.tipo,x.id),'[]') from (
 select r.*,o.registro is not null oculto from private.rede_registros r left join private.rede_ocultos o on (o.loja_id,o.tipo,o.registro)=(r.loja_id,r.tipo,r.id)
 where r.loja_id=p_loja order by r.criado desc nulls last,r.tipo,r.id limit 51 offset greatest(0,p_pagina)::bigint*50) x));
end; $$;
notify pgrst,'reload schema';
commit;
