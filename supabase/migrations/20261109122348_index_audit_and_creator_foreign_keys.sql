-- Índices para as FKs de autoria/auditoria, evitando varreduras ao consultar ou remover usuários.
create index if not exists auditoria_user_id_fk_idx on public.auditoria(user_id);
create index if not exists produtos_created_by_fk_idx on public.produtos(created_by);
create index if not exists lotes_created_by_fk_idx on public.lotes(created_by);
create index if not exists pere_itens_created_by_fk_idx on public.pere_itens(created_by);
create index if not exists pere_regs_created_by_fk_idx on public.pere_regs(created_by);
create index if not exists solicitacoes_exclusao_revisor_id_fk_idx on public.solicitacoes_exclusao(revisor_id);
