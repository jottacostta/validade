# Banco de dados no Supabase (sincronização entre aparelhos e lojas)

Hoje os dados ficam só no aparelho (`localStorage`) e o nome do produto vem do Cosmos.
Com o Supabase, tudo passa a **sincronizar** entre aparelhos e lojas, e vocês têm um
**catálogo próprio** de produtos — que complementa o Cosmos (não substitui).

## Como funciona o acesso

- **Operador** faz login com **usuário + senha** (o app usa `<usuario>@loja.validade` por baixo;
  o operador só vê usuário e senha).
- Depois, **escolhe a loja** onde está atuando. Aparecem só as lojas às quais ele tem acesso.
  Um operador pode ter acesso a mais de uma loja.
- **Isolamento:** cada loja só enxerga os próprios dados (garantido por RLS, pelo vínculo
  operador↔loja). O **catálogo** (EAN → nome/marca/imagem) é único e compartilhado.

## Tabelas

| Tabela | O que guarda |
|---|---|
| `lojas` | as lojas (nome) |
| `loja_membros` | vínculo: quais operadores acessam quais lojas |
| `catalogo` | cadastro global, uma linha por EAN: nome/marca/imagem |
| `produtos` | associação de presença: uma linha por loja + EAN, sem atributos repetidos |
| `lotes` | lotes/quantidades/validade, por loja e EAN |
| `pere_itens` / `pere_regs` | códigos de balança e registros de perecíveis, por loja |
| `ajustes` | configuração da loja (dígitos, valor, dias, OCR, token do Cosmos…) |

Cada linha tem `updated_at` (puxa "o que mudou depois da última vez") e `deleted_at`
(exclusão suave, para apagar também sincronizar). Conflito = quem salvou por último vence.

Offline-first: o `localStorage` continua sendo a cópia de trabalho; o app sincroniza quando
há internet. Sem rede, tudo funciona igual. Busca do nome: **catálogo → Cosmos → Open Food Facts → digitar**.

## Passo a passo (você faz uma vez)

1. Crie conta e projeto em https://supabase.com (plano **Free** serve). Região: **South America (São Paulo)**.
2. **Authentication → Providers → Email:** deixe **Enabled** e **desligue "Confirm email"**.
3. **SQL Editor → New query:** cole o conteúdo de [`schema.sql`](./schema.sql) e clique **Run**
   (deve aparecer *Success*; se der erro em vermelho, me mande o texto).
4. **Crie as lojas** (SQL Editor):
   ```sql
   insert into public.lojas (nome) values ('Bangu'), ('Campo Grande');
   select id, nome from public.lojas;   -- anote os id de cada loja
   ```
5. **Crie os operadores:** Authentication → Users → **Add user** → e-mail `usuario@loja.validade`
   (ex.: `joao@loja.validade`) + senha. Anote o **UID** de cada usuário (aparece na lista de Users).
6. **Vincule operador ↔ loja** (SQL Editor), um insert por acesso:
   ```sql
   insert into public.loja_membros (loja_id, user_id)
   values ('<id-da-loja>', '<uid-do-usuario>');
   ```
7. **Project Settings → API:** copie a **Project URL** e a **chave pública** (**anon**/**publishable**).

### Atualizar projeto existente

Para uma base já instalada, publique primeiro a versão nova do aplicativo (ela usa apenas
`loja_id`/`ean` em `produtos` e envia os atributos ao catálogo). Depois aplique a migração
[`20261107120000_produtos_como_associacao.sql`](./migrations/20261107120000_produtos_como_associacao.sql)
no SQL Editor. Ela preenche `catalogo` com descrições legadas que ainda não existam e só então
remove `nome`, `marca` e `img` de `produtos`. Faça backup antes. Não aplique essa migração
enquanto versões antigas do app ainda estiverem em uso: elas consultam as colunas antigas.

Me passe a **Project URL** e a **chave pública**. ⚠️ A `service_role`/`secret` **nunca** — é privada.

## Segurança (resumo)

- Só a chave **pública** (anon/publishable) vai no app. A `service_role` fica só no painel.
- **RLS ligado** em todas as tabelas: cada operador só acessa as lojas em que tem vínculo;
  o catálogo é compartilhado entre operadores logados. Sem login, não acessa nada.
- Criar lojas/usuários/vínculos é feito por você no painel (role de serviço). O app só lê/grava
  dados das lojas a que o operador tem acesso.

## Próximo passo (depois do projeto criado)

A camada no app: tela de **login (usuário + senha)**, tela de **escolher a loja**, e a
**sincronização** (enviar/receber mudanças, conflito por `updated_at`). Faço assim que você me
passar a **Project URL** + a **chave pública**, testando por partes.
