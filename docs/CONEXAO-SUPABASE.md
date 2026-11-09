# Como conectar ao Supabase (guia para o ChatGPT / assistentes)

Este guia ensina a se conectar ao backend do projeto **validade**. Inclui as **chaves
públicas** (seguras de usar/compartilhar) e exemplos prontos. Vale junto com o
`CONTEXTO.md` (visão geral, tabelas, RBAC e o contrato da Edge Function de usuários).

> ⚠️ **Regra de ouro:** só existem duas chaves públicas (abaixo). A chave **secreta**
> (`service_role` / `sb_secret_...`) **NUNCA** deve ser usada em código de cliente,
> colada em chat, nem commitada. Ela só vive dentro de Edge Functions (injetada
> automaticamente). A segurança do sistema vem do **RLS**, não de esconder a chave anon.

---

## 1. Dados de conexão

| Item | Valor |
|---|---|
| Project ref / id | `khgtwbegrxhajgdzfxyv` |
| **API URL** | `https://khgtwbegrxhajgdzfxyv.supabase.co` |
| Domínio de login (usuário→e-mail) | `loja.validade` |

### Chaves PÚBLICAS (podem ser usadas no cliente — protegidas por RLS)

**Chave publishable (recomendada para apps novos):**
```
sb_publishable_AG0aLLJwyc22rNXMq_-g6w_K2sFDIws
```

**Chave anon legada (JWT) — é a que o app usa hoje (`config.json` → `supaKey`):**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoZ3R3YmVncnhoYWpnZHpmeHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5OTY0NzYsImV4cCI6MjEwOTU3MjQ3Nn0.y-qv_6z0GXv2J_dkGLqCjJTTaG_qqzIhNw8VABbGyZo
```

Qualquer uma das duas serve como `apikey`. Nos exemplos abaixo chamo de `APIKEY`.

---

## 2. Como a autenticação funciona aqui

- Login é por **nome de usuário**, convertido em e-mail: `usuario@loja.validade`.
- O login retorna um **`access_token` (JWT do usuário)**. É esse token que libera os
  dados conforme o papel/loja (RLS). A `apikey` sozinha (anon) quase não lê nada — a
  maioria das tabelas exige usuário autenticado.
- Em requisições autenticadas vão **dois** cabeçalhos: `apikey: APIKEY` e
  `Authorization: Bearer <access_token>`.

### 2.1. Fazer login (obter o access_token)
```bash
curl -s -X POST \
  "https://khgtwbegrxhajgdzfxyv.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: APIKEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"USUARIO@loja.validade","password":"SENHA"}'
# → { "access_token": "...", "refresh_token": "...", "user": {...}, ... }
```

No JavaScript (como o app faz, via o helper `sbReq`):
```js
const SUPA_URL = "https://khgtwbegrxhajgdzfxyv.supabase.co";
const APIKEY = "sb_publishable_AG0aLLJwyc22rNXMq_-g6w_K2sFDIws";

async function login(usuario, senha) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: APIKEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${usuario}@loja.validade`, password: senha }),
  });
  if (!r.ok) throw new Error("Usuário ou senha inválidos");
  return r.json(); // use data.access_token
}
```

---

## 3. Ler/gravar dados (REST / PostgREST)

Base REST: `https://khgtwbegrxhajgdzfxyv.supabase.co/rest/v1/<tabela>`

Exemplo — listar as lojas que o usuário logado pode ver:
```bash
curl -s "https://khgtwbegrxhajgdzfxyv.supabase.co/rest/v1/lojas?select=id,nome&order=nome.asc" \
  -H "apikey: APIKEY" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Exemplo — ler o próprio papel:
```
GET /rest/v1/perfis?select=papel,nome&limit=1
```

Exemplo — upsert (enviar/atualizar) respeitando RLS:
```bash
curl -s -X POST \
  "https://khgtwbegrxhajgdzfxyv.supabase.co/rest/v1/preferencias?on_conflict=user_id" \
  -H "apikey: APIKEY" -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d '[{"user_id":"<uid>","cosmos_token":"MEU_TOKEN"}]'
```

O que cada papel pode ler/gravar é decidido pelo **RLS no servidor** (ver `CONTEXTO.md`
§4 e §8). Não há como burlar pelo cliente.

---

## 4. Chamar a Edge Function de gestão de usuários

Tudo que é privilegiado (criar/editar/excluir usuário, trocar senha) passa pela função
`gerir-usuarios` — ela roda no servidor com a `service_role` e aplica as regras por papel.

- **Endpoint:** `POST https://khgtwbegrxhajgdzfxyv.supabase.co/functions/v1/gerir-usuarios`
- **Headers:** `apikey: APIKEY`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`
- **Corpo:** `{ "acao": "listar" | "criar" | "editar" | "excluir", ... }`

Exemplo — listar usuários:
```bash
curl -s -X POST \
  "https://khgtwbegrxhajgdzfxyv.supabase.co/functions/v1/gerir-usuarios" \
  -H "apikey: APIKEY" -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"acao":"listar"}'
```

Exemplo — criar usuário (admin):
```json
{"acao":"criar","usuario":"maria.silva","nome":"Maria Silva","senha":"umaSenhaBoa1","papel":"operador","lojas":["<loja_id>"]}
```

O contrato completo (todas as ações, campos e validações) está em `CONTEXTO.md` §9.2.
O código-fonte está em `supabase/functions/gerir-usuarios/index.ts`.

---

## 5. Rodar/alterar o backend (Supabase CLI)

Para publicar funções ou aplicar migrations, use a **Supabase CLI** (precisa de um
**access token da conta**, obtido em supabase.com → Account → Access Tokens — isso é
diferente das chaves públicas e é pessoal; não vai para o repositório):

```bash
# instalar: https://supabase.com/docs/guides/cli
supabase login                      # cola o access token da conta
supabase link --project-ref khgtwbegrxhajgdzfxyv

# publicar a Edge Function de usuários
supabase functions deploy gerir-usuarios

# aplicar as migrations do repositório
supabase db push
```

As migrations estão em `supabase/migrations/`. O schema "do zero" (idempotente) está em
`supabase/schema.sql`.

---

## 6. O que o ChatGPT consegue fazer

- **Lendo o repositório** (GitHub público `jottacostta/validade`): entende todo o código,
  o schema, as migrations, a Edge Function e este guia — e pode **escrever/propor código**
  (ex.: a tela de usuários em `src/app.html`, testes, novas migrations).
- **Para efetivamente rodar contra o banco ao vivo** (deploy de função, `db push`,
  consultas REST autenticadas), é preciso **executar os comandos** acima na máquina do
  dono (ou o dono conecta o MCP do Supabase). O ChatGPT, sozinho, não tem acesso de
  escrita ao projeto; ele gera o código/comandos e o dono aplica.
- **Nunca** peça nem use a chave secreta no cliente. Se algo precisar de privilégio,
  a resposta certa é **passar pela Edge Function**, não expor a service_role.

---

## 7. Checklist rápido para colar no ChatGPT
1. Leia `CONTEXTO.md` (visão, tabelas, RBAC, contrato da função) e este arquivo.
2. URL: `https://khgtwbegrxhajgdzfxyv.supabase.co` · apikey pública acima · login
   `usuario@loja.validade`.
3. Dados protegidos exigem `Authorization: Bearer <access_token>` (faça login primeiro).
4. Ações de usuário → Edge Function `gerir-usuarios` (nunca service_role no cliente).
5. Para aplicar no servidor, gere os comandos da §5; o dono executa.
