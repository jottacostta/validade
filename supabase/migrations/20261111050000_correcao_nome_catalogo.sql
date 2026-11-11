-- Correção do nome de produtos do catálogo compartilhado.
-- Regra do proprietário (11/11/2026): só Gerente e Administrador alteram o nome diretamente;
-- os demais perfis enviam a descrição sugerida para avaliação e autorização.
begin;

create table if not exists public.solicitacoes_nome (
  id              uuid primary key default gen_random_uuid(),
  ean             text not null,
  loja_id         uuid references public.lojas(id) on delete set null,
  solicitante_id  uuid references auth.users(id) on delete set null,
  solicitante_nome text,
  nome_atual      text not null default '',
  nome_sugerido   text not null check (length(trim(nome_sugerido)) between 2 and 120),
  status          text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  revisor_id      uuid references auth.users(id) on delete set null,
  resposta        text,
  criado_em       timestamptz not null default now(),
  revisado_em     timestamptz
);
comment on table public.solicitacoes_nome is
  'Sugestões de correção do nome de produtos do catálogo; aprovadas ou rejeitadas por Gerente/Administrador.';

create index if not exists solicitacoes_nome_status_idx on public.solicitacoes_nome (status, criado_em desc);
create index if not exists solicitacoes_nome_solicitante_fk_idx on public.solicitacoes_nome (solicitante_id);
create index if not exists solicitacoes_nome_revisor_fk_idx on public.solicitacoes_nome (revisor_id);
create index if not exists solicitacoes_nome_loja_fk_idx on public.solicitacoes_nome (loja_id);
create unique index if not exists solicitacoes_nome_pendente_uq
  on public.solicitacoes_nome (ean, solicitante_id) where status = 'pendente';

alter table public.solicitacoes_nome enable row level security;
revoke all on public.solicitacoes_nome from public, anon, authenticated;
grant select on public.solicitacoes_nome to authenticated;

drop policy if exists solicitacoes_nome_sel on public.solicitacoes_nome;
create policy solicitacoes_nome_sel on public.solicitacoes_nome for select to authenticated
  using (solicitante_id = (select auth.uid()) or (select private.meu_papel()) in ('gerente','admin'));

-- Qualquer perfil ativo pode sugerir; a gravação só acontece por esta função.
create or replace function public.solicitar_correcao_nome(p_ean text, p_nome text, p_loja_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_nome text; v_atual text; v_usuario text; v_papel text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if coalesce(v_papel,'') not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Perfil sem permissão para sugerir correção' using errcode = '42501';
  end if;
  if p_loja_id is not null and not coalesce(private.tem_escopo_global(),false) and not private.membro_da(p_loja_id) then
    raise exception 'Sem acesso à loja' using errcode = '42501';
  end if;
  if coalesce(p_ean,'') !~ '^[0-9]{6,14}$' then raise exception 'Código do produto inválido'; end if;
  v_nome := trim(regexp_replace(coalesce(p_nome,''), '\s+', ' ', 'g'));
  if length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres';
  end if;
  select nome into v_atual from public.catalogo where ean = p_ean;
  v_atual := coalesce(v_atual,'');
  if v_atual = v_nome then raise exception 'O nome sugerido é igual ao atual'; end if;

  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id = p_loja_id;

  insert into public.solicitacoes_nome(ean,loja_id,solicitante_id,solicitante_nome,nome_atual,nome_sugerido)
  values (p_ean,p_loja_id,auth.uid(),v_usuario,v_atual,v_nome)
  on conflict (ean, solicitante_id) where status = 'pendente'
  do update set nome_sugerido = excluded.nome_sugerido, nome_atual = excluded.nome_atual,
                loja_id = excluded.loja_id, criado_em = now()
  returning id into v_id;

  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values (auth.uid(),v_usuario,v_papel,p_loja_id,v_loja_nome,'correcao_nome_solicitada',
    jsonb_build_object('solicitacao_id',v_id,'ean',p_ean,'nome_atual',v_atual,'nome_sugerido',v_nome));
  return v_id;
end;
$$;
revoke all on function public.solicitar_correcao_nome(text,text,uuid) from public, anon;
grant execute on function public.solicitar_correcao_nome(text,text,uuid) to authenticated;

-- Avaliação: somente Gerente e Administrador. Aprovar grava o nome no catálogo.
create or replace function public.revisar_correcao_nome(p_id uuid, p_aprovar boolean, p_resposta text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.solicitacoes_nome%rowtype; v_papel text; v_usuario text; v_loja_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  v_papel := private.meu_papel();
  if coalesce(v_papel,'') not in ('gerente','admin') then
    raise exception 'Somente Gerente ou Administrador avaliam correções de nome' using errcode = '42501';
  end if;
  select * into r from public.solicitacoes_nome where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if r.status <> 'pendente' then raise exception 'Solicitação já avaliada'; end if;
  if not p_aprovar and (p_resposta is null or length(trim(p_resposta)) < 3) then
    raise exception 'Informe o motivo da rejeição';
  end if;
  if p_aprovar then
    insert into public.catalogo(ean,nome) values (r.ean,r.nome_sugerido)
    on conflict (ean) do update set nome = excluded.nome;
  end if;
  update public.solicitacoes_nome
     set status = case when p_aprovar then 'aprovada' else 'rejeitada' end,
         revisor_id = auth.uid(), resposta = nullif(trim(p_resposta),''), revisado_em = now()
   where id = p_id;
  select coalesce(p.nome,u.email,auth.uid()::text) into v_usuario
    from auth.users u left join public.perfis p on p.id = u.id where u.id = auth.uid();
  select l.nome into v_loja_nome from public.lojas l where l.id = r.loja_id;
  insert into public.auditoria(user_id,usuario,papel,loja_id,loja_nome,acao,detalhe)
  values (auth.uid(),v_usuario,v_papel,r.loja_id,v_loja_nome,
    case when p_aprovar then 'correcao_nome_aprovada' else 'correcao_nome_rejeitada' end,
    jsonb_build_object('solicitacao_id',r.id,'ean',r.ean,'nome_atual',r.nome_atual,
      'nome_sugerido',r.nome_sugerido,'solicitante_id',r.solicitante_id,'resposta',p_resposta));
end;
$$;
revoke all on function public.revisar_correcao_nome(uuid,boolean,text) from public, anon;
grant execute on function public.revisar_correcao_nome(uuid,boolean,text) to authenticated;

-- Trava no banco: quem não é Gerente/Administrador não troca um nome já preenchido.
-- O nome antigo é preservado (em vez de erro) para não quebrar os envios em lote do app,
-- que reenviam o catálogo junto com os registros. Nome vazio ainda pode ser preenchido.
create or replace function private.proteger_nome_catalogo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.nome is distinct from old.nome
     and coalesce(trim(old.nome),'') <> ''
     and auth.uid() is not null
     and coalesce(private.meu_papel(),'') not in ('gerente','admin') then
    new.nome := old.nome;
  end if;
  return new;
end;
$fn$;
revoke all on function private.proteger_nome_catalogo() from public, anon, authenticated;

drop trigger if exists catalogo_nome_guard on public.catalogo;
create trigger catalogo_nome_guard
  before update on public.catalogo
  for each row execute function private.proteger_nome_catalogo();

commit;
