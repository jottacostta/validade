-- Fotos de perecíveis, no mesmo padrão das fotos do catálogo de industrializados.
-- Decisão do Jonatas (16/11): a foto vale para todas as lojas pelo código PLU;
-- só gerente e administrador trocam uma foto existente.
begin;

create table public.fotos_pereciveis (
  cod text primary key,
  jpeg bytea not null,
  revisao uuid not null default gen_random_uuid(),
  constraint foto_perecivel_cod check (cod ~ '^[0-9]{1,14}$'),
  constraint foto_perecivel_conteudo check (
    octet_length(jpeg) between 4 and 102400
    and substring(jpeg from 1 for 3) = decode('ffd8ff','hex')
    and substring(jpeg from octet_length(jpeg) - 1) = decode('ffd9','hex')
  )
);

alter table public.fotos_pereciveis enable row level security;
revoke all on public.fotos_pereciveis from public, anon, authenticated;
grant select on public.fotos_pereciveis to authenticated;
-- Global por PLU: qualquer usuário autenticado vê a foto; gravação só pela RPC.
create policy fotos_pereciveis_leitura on public.fotos_pereciveis for select to authenticated
  using (true);

create function public.buscar_foto_perecivel(p_cod text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('img', 'data:image/jpeg;base64,' || replace(encode(f.jpeg,'base64'), chr(10), ''), 'revisao', f.revisao)
  from public.fotos_pereciveis f
  where f.cod = p_cod;
$$;

create function public.salvar_foto_perecivel(
  p_cod text, p_loja_id uuid, p_img text, p_revisao uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text := private.meu_papel();
  v_atual uuid;
  v_nova uuid;
begin
  if auth.uid() is null or v_papel is null or v_papel not in ('operador','promotor','assistente','analista','gerente','admin') then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if p_cod is null or p_cod !~ '^[0-9]{1,14}$' or p_loja_id is null or p_img is null
     or left(p_img, 23) <> 'data:image/jpeg;base64,' or length(p_img) > 136560 then
    raise exception 'Foto inválida.' using errcode = '22023';
  end if;
  if not coalesce(private.tem_escopo_global() or private.membro_da(p_loja_id), false)
     or not exists (
       select 1 from public.pere_regs r
       where r.cod = p_cod and r.loja_id = p_loja_id and r.deleted_at is null
     ) then
    raise exception 'O perecível precisa ter um registro sincronizado em uma filial autorizada.' using errcode = '42501';
  end if;

  -- Serializa a primeira foto e as trocas do mesmo PLU.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('foto_perecivel|' || p_cod, 0));
  select f.revisao into v_atual from public.fotos_pereciveis f where f.cod = p_cod;
  if v_atual is distinct from p_revisao then
    raise exception 'A foto mudou. Abra o detalhe novamente.' using errcode = '40001';
  end if;
  if v_atual is not null and v_papel not in ('gerente','admin') then
    raise exception 'Somente gerente ou administrador pode trocar uma foto existente.' using errcode = '42501';
  end if;

  insert into public.fotos_pereciveis as f (cod, jpeg)
  values (p_cod, decode(substr(p_img, 24), 'base64'))
  on conflict (cod) do update set jpeg = excluded.jpeg, revisao = excluded.revisao
  returning f.revisao into v_nova;
  return v_nova;
end;
$$;

revoke all on function public.buscar_foto_perecivel(text) from public, anon;
revoke all on function public.salvar_foto_perecivel(text, uuid, text, uuid) from public, anon;
grant execute on function public.buscar_foto_perecivel(text) to authenticated;
grant execute on function public.salvar_foto_perecivel(text, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
