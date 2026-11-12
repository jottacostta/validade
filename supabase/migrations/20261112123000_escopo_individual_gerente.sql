-- Escopo individual do Gerente por loja_membros.
-- Administrador e Analista conservam escopo global; Gerente só alcança os IDs
-- existentes em seus próprios vínculos. Não há flag de acesso futuro automático.
-- NÃO aplicar manualmente em produção antes de review/merge.
begin;

grant usage on schema private to authenticated, service_role;

-- O alcance global é uma propriedade do papel legado, não da permissão de
-- gerência de usuários ou de avisos. Gerentes passam pelas memberships abaixo.
create or replace function private.tem_escopo_global()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.meu_papel() = any(array['analista','admin']), false);
$$;
revoke all on function private.tem_escopo_global() from public, anon;
grant execute on function private.tem_escopo_global() to authenticated;

-- A policy de perfis não pode consultar loja_membros diretamente: o RLS dessa
-- tabela ocultaria os memberships do alvo antes de a policy decidir. Este
-- helper retorna somente um booleano e roda com privilégio do definidor.
create or replace function private.usuario_no_escopo(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.tem_escopo_global()
     or exists (
       select 1
         from public.loja_membros alvo
         join public.loja_membros ator on ator.loja_id = alvo.loja_id
        where alvo.user_id = p_usuario
          and ator.user_id = auth.uid()
     );
$$;
revoke all on function private.usuario_no_escopo(uuid) from public, anon;
grant execute on function private.usuario_no_escopo(uuid) to authenticated, service_role;

-- Policies de memberships não podem descobrir o papel do alvo por uma leitura
-- sujeita ao próprio RLS de perfis. Este booleano é a única informação exposta
-- pelo helper e é avaliado com o privilégio do definidor.
create or replace function private.usuario_tem_papel(p_usuario uuid, p_papel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
     where id = p_usuario and papel = p_papel
  );
$$;
revoke all on function private.usuario_tem_papel(uuid, text) from public, anon;
grant execute on function private.usuario_tem_papel(uuid, text) to authenticated, service_role;

-- O escopo dos quatro registros permanece: leitura/escrita exige a loja global
-- ou vínculo explícito, e as permissões de ação continuam independentes do
-- conjunto de lojas. `created_by` existe nos quatro alvos e continua sendo
-- usado para a alternativa de editar próprios registros.
do $$
declare t text;
begin
  foreach t in array array['produtos','lotes','pere_itens','pere_regs'] loop
    execute format($f$alter policy %I on public.%I
      with check ((private.tem_escopo_global() or private.membro_da(loja_id))
                  and (select private.tem_permissao('registrar')))$f$, t||'_ins', t);
    execute format($f$alter policy %I on public.%I
      using ((private.tem_escopo_global() or private.membro_da(loja_id))
             and ((select private.tem_permissao('registros_editar_outros'))
                  or (created_by = (select auth.uid()) and (select private.tem_permissao('editar_proprios')))))
      with check ((private.tem_escopo_global() or private.membro_da(loja_id))
                  and ((select private.tem_permissao('registros_editar_outros'))
                       or (select private.tem_permissao('editar_proprios'))))$f$, t||'_upd', t);
  end loop;
end $$;

-- Ajustes são legíveis e mutáveis somente na loja global ou atribuída. O
-- trigger de alertas continua a limitar os campos gerenciais ao papel adequado.
alter policy ajustes_sel on public.ajustes
  using (private.tem_escopo_global() or private.membro_da(loja_id));
alter policy ajustes_ins on public.ajustes
  with check (private.tem_escopo_global() or private.membro_da(loja_id));
alter policy ajustes_upd on public.ajustes
  using (private.tem_escopo_global() or private.membro_da(loja_id))
  with check (private.tem_escopo_global() or private.membro_da(loja_id));

-- Gerente vê somente lojas globais/atribuídas; os demais preservam os bypasses
-- de metadados da etapa administrativa anterior. Criar loja continua sendo uma
-- operação exclusiva de não-Gerente com `lojas_gerenciar` (Admin sempre passa).
alter policy lojas_sel on public.lojas
  using (
    private.tem_escopo_global()
    or private.membro_da(id)
    or (
      private.meu_papel() <> 'gerente'
      and (
        private.tem_permissao('lojas_gerenciar')
        or private.tem_permissao('usuarios_gerenciar')
        or private.tem_permissao('avisos_todas_lojas')
      )
    )
  );
alter policy lojas_ins on public.lojas
  with check (
    private.meu_papel() <> 'gerente'
    and private.tem_permissao('lojas_gerenciar')
  );
alter policy lojas_upd on public.lojas
  using (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('lojas_gerenciar')
      and (
        private.meu_papel() <> 'gerente'
        or private.membro_da(id)
      )
    )
  )
  with check (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('lojas_gerenciar')
      and (
        private.meu_papel() <> 'gerente'
        or private.membro_da(id)
      )
    )
  );
alter policy lojas_del on public.lojas
  using (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('lojas_gerenciar')
      and (
        private.meu_papel() <> 'gerente'
        or private.membro_da(id)
      )
    )
  );

-- O próprio mapa é visível ao usuário. Admin/Analista mantêm leitura global;
-- Gerente com `lojas_gerenciar` vê e altera apenas vínculos de Operador/Assistente
-- em lojas próprias. Outros perfis conservam os bypasses administrativos antigos,
-- mas não podem atribuir lojas a Gerente/Admin diretamente.
alter policy loja_membros_sel on public.loja_membros
  using (
    user_id = (select auth.uid())
    or private.tem_escopo_global()
    or (
      private.meu_papel() = 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and private.membro_da(loja_id)
      and (
        private.usuario_tem_papel(user_id, 'operador')
        or private.usuario_tem_papel(user_id, 'assistente')
      )
    )
    or (
      private.meu_papel() <> 'gerente'
      and (
        private.tem_permissao('lojas_gerenciar')
        or private.tem_permissao('usuarios_gerenciar')
      )
    )
  );
alter policy loja_membros_ins on public.loja_membros
  with check (
    private.meu_papel() = 'admin'
    or (
      private.meu_papel() = 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and private.membro_da(loja_id)
      and (
        private.usuario_tem_papel(user_id, 'operador')
        or private.usuario_tem_papel(user_id, 'assistente')
      )
    )
    or (
      private.meu_papel() <> 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and not private.usuario_tem_papel(user_id, 'gerente')
      and not private.usuario_tem_papel(user_id, 'admin')
    )
  );
alter policy loja_membros_upd on public.loja_membros
  using (
    private.meu_papel() = 'admin'
    or (
      private.meu_papel() = 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and private.membro_da(loja_id)
      and (
        private.usuario_tem_papel(user_id, 'operador')
        or private.usuario_tem_papel(user_id, 'assistente')
      )
    )
    or (
      private.meu_papel() <> 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and not private.usuario_tem_papel(user_id, 'gerente')
      and not private.usuario_tem_papel(user_id, 'admin')
    )
  )
  with check (
    private.meu_papel() = 'admin'
    or (
      private.meu_papel() = 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and private.membro_da(loja_id)
      and (
        private.usuario_tem_papel(user_id, 'operador')
        or private.usuario_tem_papel(user_id, 'assistente')
      )
    )
    or (
      private.meu_papel() <> 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and not private.usuario_tem_papel(user_id, 'gerente')
      and not private.usuario_tem_papel(user_id, 'admin')
    )
  );
alter policy loja_membros_del on public.loja_membros
  using (
    private.meu_papel() = 'admin'
    or (
      private.meu_papel() = 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and private.membro_da(loja_id)
      and (
        private.usuario_tem_papel(user_id, 'operador')
        or private.usuario_tem_papel(user_id, 'assistente')
      )
    )
    or (
      private.meu_papel() <> 'gerente'
      and private.tem_permissao('lojas_gerenciar')
      and not private.usuario_tem_papel(user_id, 'gerente')
      and not private.usuario_tem_papel(user_id, 'admin')
    )
  );

-- Policies não concedem privilégios de tabela. Lojas e vínculos precisam de
-- DML para as operações diretas acima; os quatro conjuntos de dados por loja
-- conservam exatamente os grants anteriores.
grant select, insert, update, delete on public.lojas, public.loja_membros to authenticated;

-- Gestão de usuários: só a permissão efetiva e o escopo permitem listar/editar.
-- O bypass global é encapsulado em usuario_no_escopo; não basta ser Analista.
alter policy perfis_sel on public.perfis
  using (
    id = (select auth.uid())
    or (private.meu_papel() = 'assistente')
    or (private.tem_permissao('usuarios_gerenciar') and private.usuario_no_escopo(id))
  );
alter policy perfis_upd on public.perfis
  using (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('usuarios_gerenciar')
      and private.usuario_no_escopo(id)
      and (
        private.usuario_tem_papel(id, 'operador')
        or private.usuario_tem_papel(id, 'assistente')
      )
    )
  )
  with check (
    private.meu_papel() = 'admin'
    or (
      private.tem_permissao('usuarios_gerenciar')
      and private.usuario_no_escopo(id)
      and papel = any (array['operador','assistente'])
    )
  );

-- O direito de consultar auditoria não elimina o recorte da loja. Para
-- Gerentes, evento global sem loja é negado: não se deve carregar no detalhe
-- uma lista de lojas estrangeiras. Admin/Analista continuam globais.
alter policy auditoria_sel on public.auditoria
  using (
    private.tem_permissao('auditoria_ver')
    and (
      private.tem_escopo_global()
      or (loja_id is not null and private.membro_da(loja_id))
    )
  );

-- Notificações antigas podem permanecer como histórico, mas a leitura/baixa é
-- sempre própria e só global para Admin/Analista. `loja_id is null` fica seguro
-- para futuros avisos de sistema: somente o próprio destinatário os enxerga.
alter policy notificacoes_sel_own_store on public.notificacoes
  using (
    user_id = (select auth.uid())
    and (
      loja_id is null
      or private.tem_escopo_global()
      or private.membro_da(loja_id)
      or (
        private.meu_papel() <> 'gerente'
        and private.tem_permissao('avisos_todas_lojas')
      )
    )
  );
alter policy notificacoes_upd_own_store on public.notificacoes
  using (
    user_id = (select auth.uid())
    and (
      loja_id is null
      or private.tem_escopo_global()
      or private.membro_da(loja_id)
      or (
        private.meu_papel() <> 'gerente'
        and private.tem_permissao('avisos_todas_lojas')
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      loja_id is null
      or private.tem_escopo_global()
      or private.membro_da(loja_id)
      or (
        private.meu_papel() <> 'gerente'
        and private.tem_permissao('avisos_todas_lojas')
      )
    )
  );

-- Alertas internos: memberships explícitas para Gerente; o cross join global
-- legado continua obedecendo à permissão configurável para não-Gerentes.
create or replace function public.gerar_alertas_validade()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente service_role pode gerar alertas';
  end if;
  with fontes as (
    select l.id as registro_id,l.loja_id,l.val,l.ean as codigo,
      coalesce(c.nome,l.ean) as nome,l.lote as referencia,l.setor,
      'lote'::text as fonte
      from public.lotes l
      left join public.catalogo c on c.ean=l.ean
     where l.deleted_at is null and l.recolhido_em is null and l.val is not null
    union all
    select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,
      'perecivel'
      from public.pere_regs r
      left join public.pere_itens i on i.loja_id=r.loja_id and i.cod=r.cod
     where r.deleted_at is null and r.recolhido_em is null and r.val is not null
  ), candidatos as (
    select f.*,lo.nome as loja_nome,
      case when f.val < v_hoje then 'validade_vencida' else 'validade_proxima' end as tipo,
      case when f.val < v_hoje then 'Produto vencido' else 'Validade próxima' end as titulo,
      case when f.val < v_hoje then 'Registro vencido em '||f.val::text
           else 'Registro vence em '||f.val::text end as mensagem
      from fontes f join public.lojas lo on lo.id=f.loja_id
     where f.val between v_hoje-5 and v_hoje+
       coalesce((select a.dias from public.ajustes a where a.loja_id=f.loja_id),30)
  ), destinatarios as (
    select lm.user_id,lm.loja_id from public.loja_membros lm
    union
    select p.id,lo.id
      from public.perfis p cross join public.lojas lo
     where public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
       and p.papel <> 'gerente'
  ), ins as (
    insert into public.notificacoes(user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
    select d.user_id,c.loja_id,
      c.fonte||':'||c.registro_id||':'||c.val::text||':'||c.tipo,
      c.tipo,c.titulo,c.mensagem,
      jsonb_build_object('fonte',c.fonte,'registro_id',c.registro_id,
        'nome',c.nome,'codigo',c.codigo,'lote_ou_sif',c.referencia,
        'setor',c.setor,'validade',c.val,'loja_id',c.loja_id,'loja',c.loja_nome)
      from candidatos c join destinatarios d on d.loja_id=c.loja_id
     on conflict(user_id,dedupe_key) do nothing
     returning id,user_id,loja_id,tipo,titulo,mensagem,payload,criado
  )
  select coalesce(jsonb_agg(to_jsonb(ins)),'[]'::jsonb) into v_rows from ins;
  return v_rows;
end;
$$;
revoke all on function public.gerar_alertas_validade() from public,anon,authenticated;
grant execute on function public.gerar_alertas_validade() to service_role;

-- Push pessoal: invalida itens pendentes antigos de Gerente fora dos vínculos,
-- sem remover histórico já enviado. A mesma condição reaparece no claim.
create or replace function public.preparar_alertas_push()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;

  update public.alertas_push_outbox o
     set status='dead',lease_until=null,
         last_error='Destinatário sem vínculo ativo na loja'
   where o.status in ('pending','processing')
     and not exists (
       select 1 from public.perfis p
        where p.id=o.user_id
          and (
            (public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
             and p.papel <> 'gerente')
            or exists (
              select 1 from public.loja_membros lm
               where lm.user_id=o.user_id and lm.loja_id=o.loja_id
            )
          )
     );
  update public.alertas_push_outbox o set status='dead',lease_until=null,
    last_error='Regra desativada ou data local expirada'
    from public.alertas_regras ar
   where ar.id=o.regra_id
     and (o.status='pending' or (o.status='processing' and o.lease_until<now()))
     and (not ar.ativo or o.data_local<>(now() at time zone ar.fuso)::date);
  update public.alertas_push_outbox set status='dead',lease_until=null,
    last_error='Limite de tentativas excedido'
   where status='processing' and lease_until<now() and attempts>=8;
  update public.alertas_push_outbox o set status='dead',lease_until=null,
    last_error='Registro recolhido, removido ou fora da retenção de cinco dias'
    from public.alertas_regras ar
   where ar.id=o.regra_id and o.status in ('pending','processing')
     and not (
       (o.fonte='lote' and exists(select 1 from public.lotes l
          where l.id::text=o.registro_id and l.loja_id=o.loja_id
            and l.deleted_at is null and l.recolhido_em is null and l.val=o.validade
            and l.val >= (now() at time zone ar.fuso)::date-5))
       or (o.fonte='perecivel' and exists(select 1 from public.pere_regs r
          where r.id::text=o.registro_id and r.loja_id=o.loja_id
            and r.deleted_at is null and r.recolhido_em is null and r.val=o.validade
            and r.val >= (now() at time zone ar.fuso)::date-5))
     );
  with fontes as (
    select l.id registro_id,l.loja_id,l.val validade,l.ean codigo,
      coalesce(c.nome,l.ean) nome,l.lote referencia,l.setor,'lote'::text fonte
      from public.lotes l left join public.catalogo c on c.ean=l.ean
     where l.deleted_at is null and l.recolhido_em is null and l.val is not null
    union all
    select r.id,r.loja_id,r.val,r.cod,coalesce(i.descricao,r.cod),r.sif,r.setor,'perecivel'
      from public.pere_regs r left join public.pere_itens i
        on i.loja_id=r.loja_id and i.cod=r.cod
     where r.deleted_at is null and r.recolhido_em is null and r.val is not null
  ), destinatarios as (
    select lm.user_id,lm.loja_id from public.loja_membros lm
    union
    select p.id,lo.id from public.perfis p cross join public.lojas lo
     where public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
       and p.papel <> 'gerente'
  ), candidatas as (
    select ar.id regra_id,ar.user_id,f.loja_id,f.registro_id,f.fonte,f.validade,
      (now() at time zone ar.fuso)::date data_local,
      case when f.validade<(now() at time zone ar.fuso)::date
           then 'Produto vencido' else 'Validade próxima' end titulo,
      case when f.validade<(now() at time zone ar.fuso)::date
           then 'Registro vencido em '||f.validade::text
           else 'Registro vence em '||f.validade::text end mensagem,
      jsonb_build_object('fonte',f.fonte,'registro_id',f.registro_id,
        'nome',f.nome,'codigo',f.codigo,'lote_ou_sif',f.referencia,
        'setor',f.setor,'validade',f.validade,'loja_id',f.loja_id) payload
      from public.alertas_regras ar join fontes f
        on (f.validade-ar.dias)=(now() at time zone ar.fuso)::date
      join destinatarios d on d.user_id=ar.user_id and d.loja_id=f.loja_id
     where ar.ativo and (now() at time zone ar.fuso)::time>=ar.hora_local
       and f.validade >= (now() at time zone ar.fuso)::date-5
  )
  insert into public.alertas_push_outbox(regra_id,user_id,loja_id,registro_id,fonte,
    validade,data_local,titulo,mensagem,payload)
  select regra_id,user_id,loja_id,registro_id,fonte,validade,data_local,titulo,mensagem,payload
    from candidatas
   on conflict(regra_id,user_id,loja_id,registro_id,validade,data_local) do nothing;
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke all on function public.preparar_alertas_push() from public,anon,authenticated;
grant execute on function public.preparar_alertas_push() to service_role;

create or replace function public.reivindicar_alertas_push(p_limite integer default 100)
returns setof public.alertas_push_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  return query
  with picked as (
    select o.id
      from public.alertas_push_outbox o
     where ((o.status='pending' and o.available_at<=now())
        or (o.status='processing' and o.lease_until<now() and o.attempts<8))
       and exists (
         select 1 from public.perfis p
          where p.id=o.user_id
            and (
              (public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
               and p.papel <> 'gerente')
              or exists (
                select 1 from public.loja_membros lm
                 where lm.user_id=o.user_id and lm.loja_id=o.loja_id
              )
            )
       )
       and exists (
         select 1 from public.alertas_regras ar
          where ar.id=o.regra_id and ar.ativo
            and o.data_local=(now() at time zone ar.fuso)::date
            and ((o.fonte='lote' and exists(select 1 from public.lotes l
              where l.id::text=o.registro_id and l.loja_id=o.loja_id and l.val=o.validade
                and l.deleted_at is null and l.recolhido_em is null
                and l.val >= (now() at time zone ar.fuso)::date-5))
              or (o.fonte='perecivel' and exists(select 1 from public.pere_regs r
              where r.id::text=o.registro_id and r.loja_id=o.loja_id and r.val=o.validade
                and r.deleted_at is null and r.recolhido_em is null
                and r.val >= (now() at time zone ar.fuso)::date-5)))
       )
     order by o.available_at
     for update skip locked
     limit least(greatest(p_limite,1),500)
  )
  update public.alertas_push_outbox o
     set status='processing',attempts=o.attempts+1,
         lease_until=now()+interval '5 minutes'
    from picked where o.id=picked.id
  returning o.*;
end;
$$;
revoke all on function public.reivindicar_alertas_push(integer) from public,anon,authenticated;
grant execute on function public.reivindicar_alertas_push(integer) to service_role;

-- Push interno segue a autorização da loja e não apaga notificações antigas.
create or replace function public.preparar_alertas_push_internos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  update public.alertas_push_internos_outbox o
     set status='dead',lease_until=null,
         last_error='Destinatário sem vínculo ativo na loja'
   where o.status in ('pending','processing')
     and not exists (
       select 1 from public.perfis p
        where p.id=o.user_id
          and (
            (public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
             and p.papel <> 'gerente')
            or exists (
              select 1 from public.loja_membros lm
               where lm.user_id=o.user_id and lm.loja_id=o.loja_id
            )
          )
     );
  update public.alertas_push_internos_outbox o
     set status='dead',lease_until=null,
         last_error='Push interno desautorizado ou notificação removida'
    where (o.status='pending' or (o.status='processing' and o.lease_until<now()))
      and not exists(
        select 1 from public.ajustes a join public.notificacoes x on x.id=o.notificacao_id
         where a.loja_id=o.loja_id and a.push_interno and a.push_interno_desde is not null
           and x.criado>=a.push_interno_desde and x.removida_em is null
      );
  update public.alertas_push_internos_outbox set status='dead',lease_until=null,
    last_error='Limite de tentativas atingido'
   where status='processing' and lease_until<now() and attempts>=8;
  insert into public.alertas_push_internos_outbox(notificacao_id,user_id,loja_id,titulo,mensagem,payload)
    select n.id,n.user_id,n.loja_id,n.titulo,n.mensagem,n.payload
      from public.notificacoes n join public.ajustes a on a.loja_id=n.loja_id
     where a.push_interno and a.push_interno_desde is not null and n.criado>=a.push_interno_desde
       and n.removida_em is null
       and (exists(select 1 from public.perfis p
                    where p.id=n.user_id
                      and public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
                      and p.papel <> 'gerente')
            or exists(select 1 from public.loja_membros lm where lm.user_id=n.user_id and lm.loja_id=n.loja_id))
     on conflict(notificacao_id) do nothing;
  get diagnostics n=row_count;
  return n;
end;
$$;
revoke all on function public.preparar_alertas_push_internos() from public,anon,authenticated;
grant execute on function public.preparar_alertas_push_internos() to service_role;

create or replace function public.reivindicar_alertas_push_internos(p_limite integer default 100)
returns setof public.alertas_push_internos_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Somente service_role'; end if;
  return query
  with picked as (
    select o.id
      from public.alertas_push_internos_outbox o
      join public.notificacoes n on n.id=o.notificacao_id
      join public.ajustes a on a.loja_id=o.loja_id
     where ((o.status='pending' and o.available_at<=now())
        or (o.status='processing' and o.lease_until<now() and o.attempts<8))
       and (exists(select 1 from public.perfis p
                    where p.id=o.user_id
                      and public.papel_tem_permissao(p.papel,'avisos_todas_lojas')
                      and p.papel <> 'gerente')
            or exists(select 1 from public.loja_membros lm where lm.user_id=o.user_id and lm.loja_id=o.loja_id))
       and a.push_interno and a.push_interno_desde is not null
       and n.criado>=a.push_interno_desde and n.removida_em is null
     order by o.available_at
     for update of o skip locked
     limit least(greatest(p_limite,1),500)
  )
  update public.alertas_push_internos_outbox o
     set status='processing',attempts=o.attempts+1,
         lease_until=now()+interval '5 minutes'
    from picked where o.id=picked.id
  returning o.*;
end;
$$;
revoke all on function public.reivindicar_alertas_push_internos(integer) from public,anon,authenticated;
grant execute on function public.reivindicar_alertas_push_internos(integer) to service_role;

-- Alertas personalizados: p_loja_id nulo continua exigindo alcance global; para
-- um Gerente, isso nunca significa a rede toda. Destinatários usam a mesma
-- permissão de recebimento dos alertas de validade, mas Gerente só recebe por
-- membership. O remetente continua incluído pela alteração 20261111150000.
create or replace function public.enviar_alerta_personalizado(
  p_titulo text,
  p_mensagem text,
  p_loja_id uuid default null,
  p_papel text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulo text;
  v_msg text;
  v_envio uuid := gen_random_uuid();
  v_usuario text;
  v_papel text;
  v_loja_nome text;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if not coalesce(private.tem_permissao('alertas_enviar'),false) then
    raise exception 'Perfil sem permissão para enviar alertas' using errcode='42501';
  end if;
  v_titulo := trim(regexp_replace(coalesce(p_titulo,''),'\s+',' ','g'));
  v_msg := trim(coalesce(p_mensagem,''));
  if length(v_titulo)<3 or length(v_titulo)>80 then raise exception 'Informe um título entre 3 e 80 caracteres'; end if;
  if length(v_msg)<3 or length(v_msg)>500 then raise exception 'Informe uma mensagem entre 3 e 500 caracteres'; end if;
  if p_papel is not null and p_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Perfil de destino inválido';
  end if;
  if p_loja_id is null then
    if not coalesce(private.tem_escopo_global(),false) then
      raise exception 'Seu perfil só pode enviar para as lojas vinculadas' using errcode='42501';
    end if;
  else
    if not exists(select 1 from public.lojas l where l.id=p_loja_id) then raise exception 'Loja não encontrada'; end if;
    if not coalesce(private.tem_escopo_global(),false) and not private.membro_da(p_loja_id) then
      raise exception 'Sem acesso à loja' using errcode='42501';
    end if;
  end if;
  v_papel := private.meu_papel();
  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id=u.id where u.id=auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id=p_loja_id;
  with destinatarios as (
    select pf.id as user_id,p_loja_id as loja_id
      from public.perfis pf
     where p_loja_id is not null
       and (exists(select 1 from public.loja_membros lm
                   where lm.user_id=pf.id and lm.loja_id=p_loja_id)
            or (public.papel_tem_permissao(pf.papel,'avisos_todas_lojas')
                and pf.papel <> 'gerente'))
    union
    select lm.user_id,lm.loja_id
      from public.loja_membros lm
     where p_loja_id is null
    union
    select pf.id,lo.id
      from public.perfis pf cross join public.lojas lo
     where p_loja_id is null
       and public.papel_tem_permissao(pf.papel,'avisos_todas_lojas')
       and pf.papel <> 'gerente'
  )
  insert into public.notificacoes(user_id,loja_id,dedupe_key,tipo,titulo,mensagem,payload)
  select d.user_id,d.loja_id,'personalizado:'||v_envio::text,'sistema_personalizado',
    v_titulo,v_msg,
    jsonb_build_object('envio_id',v_envio,'remetente_id',auth.uid(),
      'remetente_nome',v_usuario,'loja_destino',p_loja_id,'papel_destino',p_papel)
    from destinatarios d join public.perfis pf on pf.id=d.user_id
   where d.loja_id is not null
     and (p_papel is null or pf.papel=p_papel)
   on conflict(user_id,dedupe_key) do nothing;
  get diagnostics v_n=row_count;
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values(auth.uid(),v_usuario,v_papel,p_loja_id,v_loja_nome,'alerta_personalizado_enviado',
    jsonb_build_object('envio_id',v_envio,'titulo',v_titulo,'papel_destino',p_papel,'destinatarios',v_n));
  return jsonb_build_object('envio_id',v_envio,'destinatarios',v_n);
end;
$$;
revoke all on function public.enviar_alerta_personalizado(text,text,uuid,text) from public,anon;
grant execute on function public.enviar_alerta_personalizado(text,text,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
