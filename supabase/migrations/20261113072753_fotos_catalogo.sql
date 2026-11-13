begin;

create table public.fotos_catalogo (
  ean text primary key references public.catalogo(ean) on delete cascade,
  jpeg bytea,
  url text,
  revisao uuid not null default gen_random_uuid(),
  constraint foto_catalogo_conteudo check (
    (jpeg is not null and url is null and octet_length(jpeg) between 4 and 102400
      and substring(jpeg from 1 for 3) = decode('ffd8ff','hex')
      and substring(jpeg from octet_length(jpeg) - 1) = decode('ffd9','hex'))
    or
    (jpeg is null and url is not null and length(url) <= 2048
      and url ~ '^https://(cdn-cosmos\.bluesoft\.com\.br|images\.open(food|beauty|products)facts\.org)/')
  )
);

alter table public.fotos_catalogo enable row level security;
revoke all on public.fotos_catalogo from public, anon, authenticated;
grant select on public.fotos_catalogo to authenticated;
create policy fotos_catalogo_ativos on public.fotos_catalogo for select to authenticated
  using (exists (select 1 from public.catalogo c where c.ean = fotos_catalogo.ean and c.deleted_at is null));

-- Clientes anteriores continuam sincronizando o catálogo. Um valor antigo
-- enviado no mesmo upsert não troca uma imagem já cadastrada por outro perfil.
create function private.preservar_img_catalogo_legado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(old.img, '') <> ''
     and new.img is distinct from old.img
     and coalesce(private.meu_papel(), '') not in ('gerente','admin') then
    new.img := old.img;
  end if;
  return new;
end;
$$;
revoke all on function private.preservar_img_catalogo_legado() from public, anon, authenticated;
create trigger preservar_img_catalogo_legado
before update on public.catalogo
for each row execute function private.preservar_img_catalogo_legado();

create function public.buscar_foto_catalogo(p_ean text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('img', coalesce(f.url, 'data:image/jpeg;base64,' || replace(encode(f.jpeg,'base64'), chr(10), '')), 'revisao', f.revisao)
  from public.fotos_catalogo f
  where f.ean = p_ean;
$$;

create function public.salvar_foto_catalogo(
  p_ean text, p_loja_id uuid, p_img text, p_revisao uuid, p_img_anterior text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text := private.meu_papel();
  v_catalogo_img text;
  v_atual uuid;
  v_nova uuid;
  v_jpeg bytea;
  v_url text;
begin
  if auth.uid() is null or v_papel is null or v_papel not in ('operador','assistente','analista','gerente','admin') then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if p_ean is null or p_ean !~ '^[0-9]{6,14}$' or p_loja_id is null or p_img is null or length(p_img) > 136560 then
    raise exception 'Foto inválida.' using errcode = '22023';
  end if;
  if not coalesce(private.tem_escopo_global() or private.membro_da(p_loja_id), false)
     or not exists (
       select 1 from public.lotes l
       where l.ean = p_ean and l.loja_id = p_loja_id and l.deleted_at is null
     ) then
    raise exception 'O produto precisa ter um lote sincronizado em uma filial autorizada.' using errcode = '42501';
  end if;

  -- Serializa a primeira foto e as trocas com as escritas do catálogo legado.
  select coalesce(c.img, '') into v_catalogo_img
  from public.catalogo c where c.ean = p_ean and c.deleted_at is null for update;
  if not found then
    raise exception 'Produto ativo não encontrado no catálogo.' using errcode = '22023';
  end if;

  select f.revisao into v_atual from public.fotos_catalogo f where f.ean = p_ean;
  if v_atual is distinct from p_revisao or (v_atual is null and v_catalogo_img is distinct from coalesce(p_img_anterior, '')) then
    raise exception 'A foto mudou. Abra o detalhe novamente.' using errcode = '40001';
  end if;
  if (v_atual is not null or v_catalogo_img <> '') and v_papel not in ('gerente','admin') then
    raise exception 'Somente gerente ou administrador pode trocar uma foto existente.' using errcode = '42501';
  end if;

  if left(p_img, 23) = 'data:image/jpeg;base64,' then
    v_jpeg := decode(substr(p_img, 24), 'base64');
  else
    v_url := p_img;
  end if;
  insert into public.fotos_catalogo as f (ean, jpeg, url)
  values (p_ean, v_jpeg, v_url)
  on conflict (ean) do update set jpeg = excluded.jpeg, url = excluded.url, revisao = excluded.revisao
  returning f.revisao into v_nova;
  return v_nova;
end;
$$;

revoke all on function public.buscar_foto_catalogo(text) from public, anon;
revoke all on function public.salvar_foto_catalogo(text, uuid, text, uuid, text) from public, anon;
grant execute on function public.buscar_foto_catalogo(text) to authenticated;
grant execute on function public.salvar_foto_catalogo(text, uuid, text, uuid, text) to authenticated;

commit;
