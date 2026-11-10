-- "Limpar notificações" na Área do Operador.
-- Remoção LÓGICA: a linha continua existindo para que a chave de deduplicação
-- (user_id, dedupe_key) impeça a função `alertas` de recriar um aviso que o
-- usuário já limpou. Nenhuma política é ampliada: as políticas de SELECT/UPDATE
-- existentes já restringem ao próprio destinatário enquanto membro da loja.
alter table public.notificacoes add column if not exists removida_em timestamptz;
comment on column public.notificacoes.removida_em is 'Preenchido quando o destinatário limpa a notificação; a linha permanece para deduplicação.';

-- O usuário continua sem INSERT/DELETE; passa a poder marcar a própria notificação como removida.
revoke update on public.notificacoes from authenticated;
grant select,update(lida_em,removida_em) on public.notificacoes to authenticated;

create index if not exists notificacoes_user_ativas_idx on public.notificacoes(user_id,criado desc) where removida_em is null;
