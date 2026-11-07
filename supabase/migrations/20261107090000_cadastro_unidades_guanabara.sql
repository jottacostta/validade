-- Cadastro inicial das unidades atualmente existentes no Guanabara.
-- Idempotente: não duplica lojas já cadastradas pelo nome.
-- Filiais FL21, FL22 e FL24 ficam de fora até eventual inauguração.
insert into public.lojas (nome)
select unidades.nome
from (values
  ('FL01'),
  ('FL02'),
  ('FL03'),
  ('FL04'),
  ('FL05'),
  ('FL06'),
  ('FL07'),
  ('FL08'),
  ('FL09'),
  ('FL10'),
  ('FL11'),
  ('FL12'),
  ('FL13'),
  ('FL14'),
  ('FL15'),
  ('FL16'),
  ('FL17'),
  ('FL18'),
  ('FL19'),
  ('FL20'),
  ('FL23'),
  ('FL25'),
  ('FL26'),
  ('FL27'),
  ('FL28'),
  ('FL29'),
  ('FL30'),
  ('FL31'),
  ('DEP99'),
  ('DEP999'),
  ('DEP96')
) as unidades(nome)
where not exists (
  select 1 from public.lojas l where upper(trim(l.nome)) = unidades.nome
);
