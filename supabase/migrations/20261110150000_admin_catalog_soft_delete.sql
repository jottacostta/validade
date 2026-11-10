-- Inativação lógica de itens do catálogo global pelo Administrador.
-- Preserva lotes/produtos das lojas e permite restauração auditada; não concede DELETE físico.
begin;

alter table public.catalogo
  add column if not exists deleted_at timestamptz;

comment on column public.catalogo.deleted_at is
  'Tombstone global do catálogo; somente Administrador pode inativar ou restaurar. Registros operacionais por loja são preservados.';

-- O catálogo continua globalmente legível e editável conforme a regra de contribuição,
-- mas a alteração do tombstone é validada no banco, não pela UI.
create or replace function private.proteger_tombstone_catalogo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null and private.meu_papel() is distinct from 'admin' then
      raise exception 'Somente Administrador pode inativar itens do catálogo'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at
     and private.meu_papel() is distinct from 'admin' then
    raise exception 'Somente Administrador pode inativar ou restaurar itens do catálogo'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;
revoke all on function private.proteger_tombstone_catalogo() from public, anon, authenticated;

drop trigger if exists catalogo_tombstone_guard on public.catalogo;
create trigger catalogo_tombstone_guard
  before insert or update on public.catalogo
  for each row execute function private.proteger_tombstone_catalogo();

-- A exclusão da UI é tombstone via UPDATE. Não permitir exclusão física que burle
-- o sync incremental ou apague a trilha de auditoria do catálogo.
drop policy if exists catalogo_del_admin on public.catalogo;
revoke delete on public.catalogo from public, anon, authenticated;

commit;
