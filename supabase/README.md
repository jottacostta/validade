# Banco de dados no Supabase (sincronização entre aparelhos e lojas)

Hoje os dados ficam só no aparelho (`localStorage`) e o nome do produto vem do Cosmos.
Com o Supabase, tudo passa a **sincronizar** entre aparelhos e lojas, e vocês têm um
**catálogo próprio** de produtos — que complementa o Cosmos (não substitui).

## Arquitetura

- **Cada loja é uma conta** (login por e-mail/senha), compartilhada pelos operadores.
  Os dados da loja ficam isolados por `loja_id` (RLS garante que uma loja não vê a outra).
- **Tabelas por loja:** `produtos`, `lotes`, `pere_itens`, `pere_regs`, `ajustes`.
- **Catálogo compartilhado:** `catalogo` (EAN → nome, marca). O nome do produto é igual
  em qualquer loja, então ele é comum a todas — o que uma loja cadastra ajuda as outras.
- **Offline-first:** o `localStorage` continua sendo a cópia de trabalho; o app sincroniza
  com o Supabase quando há internet. Sem rede, tudo funciona igual.
- **Sincronização:** cada linha tem `updated_at` (puxa "o que mudou depois da última vez")
  e `deleted_at` (exclusão suave, para apagar também sincronizar). Conflito = quem salvou
  por último vence (`updated_at`).
- **Busca do nome:** passa a ser **catálogo Supabase → Cosmos → Open Food Facts → digitar**.

## Passo a passo (você faz uma vez)

1. Crie uma conta e um projeto em https://supabase.com (plano grátis serve para começar).
2. **Authentication → Providers → Email:** deixe o e-mail ligado. Para loja, é prático
   **desligar "Confirm email"** (Authentication → Providers → Email → Confirm email = off),
   assim a conta da loja já entra sem precisar confirmar e-mail.
3. **SQL Editor → New query:** cole o conteúdo de [`schema.sql`](./schema.sql) e clique **Run**.
   Isso cria as tabelas, os índices e as regras de segurança (RLS).
4. **Crie uma conta por loja:** Authentication → Users → Add user (e-mail + senha da loja).
5. Pegue as credenciais em **Project Settings → API**:
   - **Project URL** (ex.: `https://xxxx.supabase.co`)
   - **anon public key** (pode ficar no app; é pública — a segurança vem do RLS)

Me passe a **Project URL** e a **anon key** (a anon pode ser compartilhada; a `service_role`
**nunca** — essa é secreta). Com elas eu ligo a sincronização no app e testo.

## Segurança (resumo)

- Só a chave **anon** (pública) vai no app. A `service_role` fica só no painel do Supabase.
- **RLS ligado** em todas as tabelas: cada loja só acessa as próprias linhas; o catálogo é
  compartilhado entre lojas logadas. Sem login, não acessa nada.

## O que falta (próximo passo, depois do projeto criado)

A camada de sincronização dentro do app (login da loja, enviar/receber mudanças, resolver
conflitos por `updated_at`). Faço assim que vocês tiverem o projeto e me passarem URL + anon key.
