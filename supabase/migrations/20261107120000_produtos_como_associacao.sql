-- O catálogo é a única fonte compartilhada dos atributos do produto.
-- `produtos` passa a representar somente a presença do EAN em cada loja.
-- Execute depois de publicar uma versão do app que não selecione/grave nome,
-- marca ou img em `produtos`.

-- Preserva produtos legados no catálogo sem sobrescrever registros canônicos
-- que já existam. Se houver mais de um nome legado para o mesmo EAN, escolhe
-- deterministicamente o primeiro não vazio em ordem lexical.
insert into public.catalogo (ean, nome, marca, img)
select distinct on (p.ean)
  p.ean,
  btrim(p.nome),
  coalesce(p.marca, ''),
  coalesce(p.img, '')
from public.produtos p
where p.ean is not null and btrim(p.ean) <> '' and nullif(btrim(p.nome), '') is not null
order by p.ean, (nullif(btrim(p.nome), '') is null), p.nome, p.loja_id
on conflict (ean) do nothing;

alter table public.produtos drop column if exists nome;
alter table public.produtos drop column if exists marca;
alter table public.produtos drop column if exists img;

comment on table public.catalogo is 'Catálogo global: uma linha por EAN com nome, marca e imagem.';
comment on table public.produtos is 'Associação loja–EAN: uma linha por produto encontrado em cada loja.';
