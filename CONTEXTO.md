# Contexto do projeto — Sistema de Validade e Catálogo (Supermercados Guanabara)

> Documento de handoff para continuar a construção (pode ser colado no ChatGPT ou em
> qualquer assistente). Descreve o objetivo, a arquitetura, o backend, a segurança,
> a hierarquia de usuários e **o que está em construção agora**. Mantido em português.
>
> Última atualização: localização por lote (Área de Vendas/Depósito) e permissão de recolhimento configurável por perfil.

---

## 1. O que é

Aplicativo **web (um único arquivo HTML)** para **controle de validade** e **perecíveis**
em supermercados, com **catálogo de produtos** e **sincronização em nuvem** entre
aparelhos e lojas. Usado nas lojas Guanabara (RJ). Objetivo declarado: *"o melhor
sistema de validade e catálogo de produtos do Brasil"*.

- Roda no navegador do celular e também como **PWA** publicado no **GitHub Pages**.
- Pode ser embutido no **ApkForja** (gerador de APK) — por isso o build gera também
  `dist/APP_VALIDADE.js` (constantes `APP_VALIDADE` / `LEITOR_EAN`).
- Funciona **offline-first** (localStorage) e sincroniza com **Supabase** quando online.

**Link público (produção):** https://jottacostta.github.io/validade/
**Painel de status do projeto:** `dist/painel.html` (gerado por `painel.js`).

---

## 2. Arquitetura

O app NÃO é escrito direto no HTML final. Há um **template com marcadores** que o
`build.js` substitui por configurações da loja.

```
src/app.html        → template do app (HTML+CSS+JS, tudo inline)
src/leitor-ean.js   → leitor de código de barras 1D + GS1 (DataMatrix/QR) + OCR de etiqueta
build.js            → monta dist/ a partir de src/ + config.json
config.json         → config da loja (cores, nome, Supabase URL/chave pública, domínio de login…)
painel.js           → gera dist/painel.html (status do projeto)
```

Marcadores substituídos pelo build (têm que sumir no final, senão o build falha):
`/*COR*/ /*COR2*/ /*COR3*/ /*CORDARK*/ /*ACENTO*/ /*NOME_HTML*/ /*CFG*/ /*LEITOR*/`

- `/*CFG*/` vira o objeto `CFG` (JSON) com: `cosmos, nome, slogan, zap, dias, dig,
  valor, supaUrl, supaKey, loginDom, logo`.
- `/*LEITOR*/` vira o conteúdo de `src/leitor-ean.js`.

### Build / testes / deploy

```bash
node build.js config.json      # gera dist/validade.html, dist/APP_VALIDADE.js, dist/painel.html
node --test --test-concurrency=1   # 51 testes (node:test + Playwright headless)
```

- **Deploy**: `push` no branch `main` dispara GitHub Actions:
  - `.github/workflows/testes.yml` → roda build + testes; confere que
    `dist/validade.html` e `dist/APP_VALIDADE.js` estão em dia com `src/`
    (NÃO confere `dist/painel.html`, que muda a cada commit por embutir estado do git).
  - `.github/workflows/pages.yml` → publica no GitHub Pages.
- **Importante:** sempre rodar `node build.js` e commitar o `dist/` junto com o `src/`.

---

## 3. Estrutura do repositório

```
build.js, painel.js, config.json
src/app.html, src/leitor-ean.js, src/logo.jpg
dist/validade.html, dist/APP_VALIDADE.js, dist/painel.html
supabase/
  schema.sql                         # script "do zero" (referência, idempotente)
  migrations/20261106200000_init.sql
  migrations/20261107020000_cosmos_por_usuario_e_hardening.sql
  functions/gerir-usuarios/index.ts  # Edge Function de gestão de usuários (NOVA, ver §9)
  README.md
test/*.test.js                       # testes (app, build, gs1, leitor, ocr, código de barras)
docs/TECNICO.md
.github/workflows/testes.yml, pages.yml
CONTEXTO.md                          # este arquivo
```

---

## 4. Backend Supabase

- **Projeto:** `validade` — ref/id `khgtwbegrxhajgdzfxyv` (região us-east-2).
- **URL:** `https://khgtwbegrxhajgdzfxyv.supabase.co`
- **Chave no app:** apenas a **publishable/anon** (vai em `config.json` → `CFG.supaKey`).
  A segurança NÃO depende de esconder essa chave; depende de **RLS**.
- **Chave secreta (service_role):** NUNCA vai para o app nem para o git. Só é usada
  DENTRO de Edge Functions (injetada automaticamente como `SUPABASE_SERVICE_ROLE_KEY`).
  ⚠️ A chave secreta já foi exposta uma vez no chat — **recomenda-se rotacioná-la**
  em Supabase → Project Settings → API Keys.

### Tabelas (schema `public`)

| Tabela | Para quê |
|---|---|
| `lojas` (id, nome) | lojas da rede |
| `loja_membros` (loja_id, user_id) | quais lojas cada usuário acessa |
| `catalogo` (ean, nome, marca, img, updated_at) | cadastro global único: uma linha por EAN |
| `produtos` (loja_id, ean, updated_at, deleted_at) | associação: EAN encontrado em cada loja, sem nome/marca/imagem |
| `lotes` (id, loja_id, ean, lote, qtd, val, em_area_vendas, …) | lotes/validades por loja, com localização do lote |
| `pere_itens` (loja_id, cod, descricao, sif) | itens de perecíveis (código de balança) |
| `pere_regs` (id, loja_id, cod, peso/preco, val, em_area_vendas, …) | registros de perecíveis, com localização do registro |
| `ajustes` (loja_id, …) | ajustes por loja |
| `perfis` (id→auth.users, nome, papel) | papel do usuário (RBAC) |
| `preferencias` (user_id→auth.users, cosmos_token) | **token do Cosmos por usuário** |
| `auditoria` (user_id, usuario, papel, loja_*, acao, detalhe jsonb, criado) | log oculto |

### Funções e RLS

- `private.meu_papel()` → retorna o papel do usuário logado (lê `perfis`).
- `private.membro_da(loja uuid)` → booleano: o usuário pertence à loja?
- Ambas são `SECURITY DEFINER` e ficam no schema **`private`** (NÃO exposto pela API
  REST), para não serem chamáveis via `/rest/v1/rpc`. O `authenticated` tem `execute`
  (usadas dentro das políticas de RLS); o `anon` não.
- Gatilhos: `public.ao_criar_usuario()` (cria linha em `perfis` ao cadastrar no Auth)
  e `public.protege_papel()` (só admin pode mudar `papel`). Sem `execute` para anon/auth.
- **RLS por papel** (resumo): operador/assistente registram na própria loja;
  assistente/analista/gerente registram e editam; analista/gerente/admin leem tudo;
  admin faz tudo. (Decisão aprovada: **analista pode registrar dados** — PR #17.)

O estado vivo do banco está refletido em `supabase/schema.sql` e nas migrations.
O verificador de segurança (Supabase advisors) está **limpo**, exceto 1 item que só
existe no plano pago: *"Leaked password protection"* (checagem HaveIBeenPwned) — fica
desligado no plano Free; não é um buraco, é um extra.

---

## 5. Login e fluxo de telas

Fluxo: **Splash → Tela de Login (bloqueante) → Escolher loja → Sistema**.

- Login por **nome de usuário** (não e-mail). Internamente vira e-mail no Auth:
  `usuario + "@" + loginDom`, com `loginDom = "loja.validade"` (em `config.json`).
- A tela de login é **cheia, opaca e bloqueante** (`#conta`, visual glassmorphism):
  não dá acesso a nada do sistema até logar E escolher a loja.
- Após logar, o usuário escolhe entre as lojas vinculadas a ele (`loja_membros`).
- Sessão persiste em `localStorage` (`validade_sessao`): `access_token, refresh_token,
  usuario, email, uid, papel, nome, lojaId, lojaNome, cosmos`.
- Em **Ajustes** há apenas a gestão da conta já logada (trocar loja / sair) e o campo
  do **token pessoal do Cosmos**.

Chaves no localStorage: `validade_dados` (D, dados do app), `validade_sessao` (SESS),
`validade_sync` (SYNC), `preferencias` lido do servidor para `SESS.cosmos`.

---

## 6. Funcionalidades principais

- **Leitura de código de barras** 1D (EAN-13/8, UPC-A/E) em JS puro.
- **GS1 DataMatrix/QR** das etiquetas de balança: extrai GTIN, validade (17),
  peso (3103), preço e **código de balança** (ex.: GTIN `02060190009984` → código `6019`
  com `dig=5`). Campo `dig` define o tamanho do código (4, 5 ou 6).
- **OCR** (Tesseract.js via CDN) para capturar descrição do produto e **lote** (o lote
  vai para o campo SIF dos perecíveis).
- **Catálogo global único** (uma linha por EAN) compartilhado: ao escanear, busca o nome em ordem:
  **catálogo → Cosmos (token do usuário) → Open Food/Beauty/Products Facts → digita**.
- **Backup na nuvem** por loja (associações de produto, lotes, perecíveis) com debounce; hoje é
  **push** (envia). (Pendência: puxar/mesclar de outros aparelhos e propagar exclusões.)
- **Token do Cosmos por usuário**: cada pessoa cadastra o seu em Ajustes; fica em
  `preferencias` (RLS: só a própria linha) e vale em qualquer aparelho.
- **Localização por registro**: `lotes.em_area_vendas` e `pere_regs.em_area_vendas` informam se cada lote/registro está na Área de Vendas (`true`, padrão) ou no Depósito (`false`). A localização fica no Supabase e é compartilhada dentro da loja, sincroniza pela fila offline e aparece nos cartões, edição e relatórios XLSX.
- **Recolhimento configurável**: `registros_recolher` é uma permissão por perfil definida pelo Administrador em Ajustes → Usuários e Permissões → Perfis de acesso. O padrão permite Operador, Assistente, Analista e Gerente; o servidor valida permissão e escopo da loja. Reativar registros recolhidos continua restrito a Assistente e perfis superiores.

---

## 7. Segurança (resumo)

- **RLS** isola dados por usuário/loja (regras aplicadas no servidor).
- **Anti-SQL-injection**: todo acesso é via PostgREST/Supabase (consultas
  parametrizadas); não há concatenação de SQL no cliente.
- **Criptografia em trânsito** (HTTPS) e senhas com hash (bcrypt) no Auth.
- **Funções de permissão fora da API** (schema `private`).
- **Auditor oculto**: toda ação relevante grava em `auditoria`; só o **admin** vê o log
  (card "Auditoria" em Ajustes). A tabela é append-only.
- Pendências de segurança desejáveis: MFA para admin/analista; senha forte na criação
  (ver §9, já previsto na Edge Function).

---

## 8. Hierarquia de usuários (RBAC) — MATRIZ DE PERMISSÕES

Papéis: `operador`, `assistente`, `analista`, `gerente`, `admin` (superuser).
> Nota: há também o papel **`gerente`** (poderes próximos de analista: registra, edita,
> gere usuários; não é admin). A tabela abaixo foca em operador/assistente/analista/admin.

| Ação | operador | assistente | analista | admin |
|---|:--:|:--:|:--:|:--:|
| Registrar lotes/perecíveis (na sua loja) | ✅ | ✅ | ✅ | ✅ |
| Editar/cadastrar códigos de perecíveis | ❌ | ✅ | ✅ | ✅ |
| Ler tudo (todas as lojas) | ❌ | ❌ | ✅ | ✅ |
| **Criar usuários** | ❌ | ✅ | ✅ | ✅ |
| **Editar usuário (nome + senha)** | ❌ | ❌ | ✅ | ✅ |
| **Mudar papel de usuário** | ❌ | ❌ | ❌ | ✅ |
| **Atribuir/trocar lojas do usuário** | ❌ | ❌ | ❌ | ✅ |
| **Excluir usuário** | ❌ | ❌ | ❌ | ✅ |
| Ver log de auditoria | ❌ | ❌ | ❌ | ✅ |

Além da matriz acima, `registros_recolher` é configurável pelo Administrador por perfil e, por padrão, fica habilitada para Operador, Assistente, Analista e Gerente. A RPC valida a permissão e o escopo no servidor; a reativação continua restrita a Assistente ou superior.

Regras finas:
- Assistente cria usuários **sempre como `operador`** e só pode atribuir **as lojas das
  quais ele mesmo é membro**.
- Analista cria usuários e edita **nome e senha** (não mexe em papel nem lojas).
- Só **admin** define papel, atribui lojas e exclui. Não é permitido rebaixar/excluir
  o **último admin**, nem o admin excluir a própria conta.

---

## 9. EM CONSTRUÇÃO AGORA: Tela de Gestão de Usuários

### 9.1. O que já está pronto
- **Edge Function** `supabase/functions/gerir-usuarios/index.ts` (escrita, revisar/ajustar).
  Roda com a `service_role` (server-side), identifica quem chama pelo **JWT** e aplica a
  matriz da §8. Ainda **NÃO publicada** (deploy pendente) e **sem UI** no app ainda.

### 9.2. Contrato da Edge Function (para o front chamar)

- **Endpoint:** `POST {supaUrl}/functions/v1/gerir-usuarios`
- **Headers:** `Authorization: Bearer <access_token do usuário>`, `apikey: <anon>`,
  `Content-Type: application/json`. (No app, usar o helper `sbReq(path, opt)`.)
- **Corpo:** `{ "acao": "...", ... }`. Campo opcional `dominio` (default `loja.validade`).

Ações:

| acao | quem pode | corpo | resposta |
|---|---|---|---|
| `listar` | assistente+ | `{acao:"listar"}` | `{usuarios:[{id,usuario,nome,papel,lojas:[{id,nome}]}], lojas:[{id,nome}], euPapel}` |
| `criar` | assistente+ | `{acao:"criar", usuario, nome, senha, papel?, lojas:[id...]}` | `{ok:true,id}` ou `{error}` |
| `editar` | analista+ | `{acao:"editar", id, nome?, senha?, papel?(admin), lojas?(admin)}` | `{ok:true}` ou `{error}` |
| `excluir` | admin | `{acao:"excluir", id}` | `{ok:true}` ou `{error}` |

Validações no servidor (já implementadas):
- `usuario`: `^[a-z0-9._-]{3,30}$` (minúsculas).
- **senha forte**: mínimo 6 caracteres, não pode ser comum (lista), nem igual ao usuário.
- `papel ≠ operador` só se o chamador for admin.
- `criar` exige ao menos 1 loja (dentre as que o chamador pode atribuir).
- `editar`: campos `papel`/`lojas` só para admin; protege o último admin.
- `excluir`: só admin; não exclui a si mesmo nem o último admin.
- Toda ação grava em `auditoria` (`criou_usuario`, `editou_usuario`, `excluiu_usuario`).

### 9.3. O que falta construir
1. **Deploy** da função: `supabase functions deploy gerir-usuarios` (ou via MCP
   `deploy_edge_function`, `verify_jwt: true`). Conferir CORS (já tem headers `*`).
2. **UI no app** (`src/app.html`), provavelmente um card "Usuários" em Ajustes visível
   para `assistente+` (criar um `pode('verUsuarios')`/`pode('criarUsuario')` etc.):
   - Lista de usuários (nome, usuário, papel com selo, lojas) chamando `acao:"listar"`.
   - Form "Novo usuário": usuário, nome, senha (com olho de mostrar/ocultar), papel
     (select só para admin; senão forçado operador), lojas (checkboxes — só as
     permitidas). Chama `acao:"criar"`.
   - Editar (analista+): nome, senha (em branco = manter), e para admin papel + lojas.
   - Excluir (admin): com confirmação.
   - Validar senha forte também no cliente (mesma regra) para UX.
3. **Testes** (`test/app.test.js`): gating por papel (quem vê o card) e mocks dos
   endpoints `/functions/v1/gerir-usuarios` para criar/listar.
4. Rebuild + commit `dist/` + push.

### 9.4. Decisões assumidas (confirmar com o dono se quiser mudar)
- Papel só é definido/alterado por **admin** (assistente/analista criam operadores).
- Assistente só atribui as **próprias lojas**; analista/admin atribuem qualquer loja.
- Listagem de usuários visível a assistente+ (mostra todos).

---

## 10. Roadmap / pendências
- Finalizar a **gestão de usuários** (UI + deploy, §9).
- **Sincronização completa** do estoque (puxar/mesclar de outros aparelhos; propagar
  exclusões). Hoje o backup é só envio (push).
- Melhorias sugeridas por pesquisa: **FEFO**, alertas escalonados → tarefas,
  remarcação/descarte com motivo + relatório de perdas/quebra.
- **MFA** para admin/analista; e, se migrar para plano Pro, ligar "Leaked password
  protection".

---

## 11. Convenções importantes
- **Branch de trabalho:** `ccr-97fcafcf-9m1t7a` (designado). Na prática, nesta fase os
  deploys foram feitos direto no `main` (Pages publica do `main`). Combinar antes de mudar.
- **Nunca** commitar a chave secreta (service_role) nem colá-la em código/variáveis do app.
- Sempre `node build.js` antes de commitar; os testes rodam com `--test-concurrency=1`.
- Mensagens de commit em PT-BR, descritivas.

---

## 12. Como pedir ajuda ao ChatGPT (o que colar)
Cole este arquivo inteiro e diga em que ponto quer ajuda. Para a **tela de usuários**,
o essencial é: a **matriz da §8**, o **contrato da função na §9.2**, e o padrão do app
(§2 e §5). Peça o código do **card de Usuários em `src/app.html`** chamando
`/functions/v1/gerir-usuarios` via `sbReq`, mais os **testes** e o **rebuild**.
Lembre o ChatGPT de **não** colocar a chave secreta no cliente — tudo que é privilegiado
passa pela Edge Function.
