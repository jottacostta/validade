# Continuidade do trabalho — Área do Operador / Controle de Validade

> Documento de passagem de bastão entre agentes (Claude → ChatGPT/Manus).
> **Regra pedida pelo proprietário (Jonatas, 10/11/2026):** a cada mudança, atualizar este arquivo
> (seção "Diário") e a issue #25 com o que foi feito e o que falta.
> Leia também `AGENTS.md` (regras obrigatórias) e a issue #25 (canal de coordenação).

Última atualização: 10/11/2026 — por Claude.

---

## 1. Onde as coisas estão

| Item | Estado |
|---|---|
| `main` | commit `5b02033` (merge da PR #31). Publicada no GitHub Pages: `jottacostta.github.io/validade/` |
| PR #29 (layout Guanabara) | mesclada na branch da #22 em 10/11 |
| PR #22 (backend Área do Operador + layout) | mesclada na `main` (`edb4bd6`) |
| PR #30 (limpar notificações, senha pelo servidor, sessões, agendador) | mesclada na `main` (`4c16aa6`) |
| PR #31 (quantidade espremida + auditoria 360/320 px) | mesclada na `main` (`5b02033`) |
| **Branch `feat/catalogo-admin`** | **PR #32 aberta (Draft) — Catálogo do administrador (ver seção 4). Aguarda autorização de merge** |
| PRs #19, #27, #28 (documentação) | abertas, não tocadas por Claude. Estão desatualizadas em relação ao que foi implementado |

Donos de branch: desde 10/11 o Jonatas passou a **#22 e #29 para o Claude**. Se outro agente assumir,
registre a troca na issue #25 antes de enviar commits.

## 2. Estado de PRODUÇÃO (Supabase, projeto `validade`)

Tudo abaixo foi aplicado com autorização explícita do Jonatas na sessão de 10/11.

- **Migrations aplicadas** (além das anteriores):
  - `offline_rpc_idempotency` — `registrar_lote` / `registrar_perecivel` idempotentes. Conferido: MD5 do corpo das funções em produção = arquivo do repositório.
  - `notificacoes_remocao_logica` — coluna `removida_em`; `authenticated` tem só `SELECT` e `UPDATE(lida_em, removida_em)`.
  - `agendar_alertas_validade` — `pg_cron`, job `gerar-alertas-validade-diario`, `0 9 * * *` (06:00 de Brasília).
  - `agendador_dispara_push` — o mesmo job passa a chamar a Edge Function `alertas` (`dispatch`) via `pg_net`, lendo endereço, chave pública e segredo do Vault.
- **Edge Function `gerir-usuarios`**: versão 3. O arquivo publicado é um ponto de entrada de 1 linha que importa
  `supabase/functions/gerir-usuarios/index.ts` do repositório **fixado no commit `4c16aa6c6f68c0e7f47f6f7970111fe634624fb5`**.
  - Se o arquivo mudar na `main`, **é preciso publicar de novo** (`supabase functions deploy gerir-usuarios`), senão produção fica na versão antiga.
  - Teste feito: chamada sem usuário respondeu `401 {"error":"Sessão inválida"}` (a função inicializa).
  - **Não testado com usuário real:** `listar`, `criar`, `editar`, `trocar_senha_primeiro_acesso`, `trocar_senha`.
- **Edge Function `alertas`**: versão 1 (09/11), não alterada. `VAPID_PUBLIC_KEY` está configurada (a função devolve a chave pública).
- **Extensões**: `pg_cron`, `pg_net` (instalada para teste; o Jonatas decidiu **manter**, é necessária para o push), `supabase_vault`.
- **Vault**: `alertas_cron_secret`, `alertas_function_url`, `alertas_anon_key` (valores só no cofre; não estão no repositório).
- **Segredos da função `alertas`** (painel): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `ALERTAS_CRON_SECRET` — todos presentes em 10/11.
- Avisos do linter de segurança que já existiam e **não foram tratados**: `solicitar_exclusao` e `revisar_solicitacao_exclusao`
  são `SECURITY DEFINER` executáveis por `authenticated` (ambas conferem sessão, loja e papel — revisado por leitura);
  proteção contra senhas vazadas do Auth desligada (liga-se no painel).

## 3. PENDÊNCIAS, em ordem de prioridade

### 3.1 Push de validade (objetivo declarado do proprietário) — FUNCIONANDO NO SERVIDOR; falta inscrever aparelhos
Situação em 10/11 10:40: o Jonatas salvou `ALERTAS_CRON_SECRET` no painel (conferido pela impressão SHA-256 exibida
no painel). `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` também constam nos segredos da função.

- [x] Disparo manual da função `alertas` (`dispatch`) respondeu `200 {"notificacoes":6,"enviados":0,...}`: gerou 6 avisos
      e enviou 0 push **porque não há nenhum aparelho inscrito** (`push_subscriptions` = 0).
- [x] Migration `20261110030000_agendador_dispara_push.sql` aplicada em produção: o job `gerar-alertas-validade-diario`
      (09:00 UTC) agora chama a função `alertas` via `pg_net`. O comando do job foi executado uma vez à mão e respondeu 200.
- [x] Vault com os três nomes que o job lê: `alertas_function_url`, `alertas_anon_key`, `alertas_cron_secret`.
- [ ] **[todos os perfis]** Em cada aparelho: **Configurações → Notificações push → Ativar notificações push** (decisão do Jonatas em 10/11: todos os perfis ativam, e a tela fica em Configurações).
      Só depois disso `enviados` passa de 0. **Ainda não testado em aparelho real.**
- [ ] **[agente]** Em 11/11 depois das 09:00 UTC, conferir `cron.job_run_details` e `net._http_response`
      (esperado: status 200). Se o push falhar em aparelhos inscritos, olhar o campo `falhas` da resposta.
- [ ] A migration acima está na branch `feat/catalogo-admin` (PR #32); o repositório só reflete a produção depois da merge.
- Se o segredo for trocado no painel, atualizar o mesmo valor no Vault (`vault.update_secret`), senão o job recebe 401.

### 3.1.1 Limite conhecido do push para perfis de escopo global (NÃO resolvido)
O servidor só aceita inscrição (`subscribe`) e só gera avisos para quem está em `loja_membros` da loja:
`isMember()` em `supabase/functions/alertas/index.ts` e o `join public.loja_membros` em `gerar_alertas_validade()`.
Analista, gerente e administrador enxergam todas as lojas, mas **só recebem push das lojas em que estão vinculados**;
se entrarem em uma loja sem vínculo, "Ativar" responde 403 "Loja inválida ou sem vínculo".
Decisão pendente do Jonatas: esses perfis devem receber avisos de **todas** as lojas ou só das vinculadas?
Mudar isso exige alterar a função `alertas` e a função SQL (migration) — não foi feito.

### 3.2 Catálogo do administrador — EM ANDAMENTO (branch `feat/catalogo-admin`)
Ver seção 4. Falta: abrir PR, CI verde, conferência visual e autorização de merge.

### 3.3 Itens das referências ainda não implementados
- **Campos do perfil**: matrícula, data de admissão, setor de atuação, "Editar Perfil". Decisão proposta e não contestada:
  colunas em `perfis`, só o administrador preenche; o operador edita apenas o próprio nome. **Exige migration + RLS + função.**
  Atenção ao `AGENTS.md`: não usar dados reais de RH em testes/commits.
- **Tema claro/escuro**: exige paleta clara para todas as telas (o CSS novo usa cores fixas). Não iniciado.
- **"Embalado em"** (data de embalagem do perecível): não implementado. O Jonatas retirou só **temperatura** do plano.
- **"Filtros"** (4º botão) da Buscar Produto: não implementado.

### 3.4 Coisas a testar em aparelho real (nada disso foi testado fora de navegador de teste)
- Câmera, OCR/leitura de etiqueta, Flash, Trocar câmera, Ler da galeria.
- Som e vibração (preferências em Configurações).
- Registro com e sem internet; sincronização ao voltar a rede.
- Troca de senha (Configurações → Alterar Senha) contra o Supabase real.
- Gestão de usuários como administrador (depende da `gerir-usuarios` v3).

### 3.5 Documentação
- PRs #19, #27 e #28 e o corpo da issue #25 descrevem um estado antigo. Precisam ser atualizados ou fechados
  (decisão do Jonatas). `docs/especificacao-visual-operador.md` já registra que temperatura saiu do plano.

## 4. Catálogo de Produtos (trabalho em curso)

Pedido do Jonatas (10/11): *"Catálogo só fica disponível visualmente para o administrador, em área própria; siga o layout."*

Feito no commit `3ac395c` (branch `feat/catalogo-admin`), 129 testes passando localmente:
- Tela `#v-catalogo` ("Catálogo de Produtos"): busca (`#qCatalogo`), filtros Todos/Com registros/Sem registros
  (`#catalogoFiltros [data-cat-filter]`), indicadores (`#tCatTotal`, `#tCatCom`, `#tCatSem`), cartões `.catalog-card`
  (nome, EAN, marca, nº de registros na loja, botão "+" com `data-register-ean`), paginação (`#pagerCatalogo`).
- Entrada: Configurações → cartão **Administração** (`#cfgAdminCard`, botão `#cfgCatalogo`), visível só quando
  `papelAtual()==='admin'` (inclui o modo local sem Supabase). `ir('catalogo')` recusa os demais perfis.
- Meus Registros **não lista mais** produtos sem lote (eles ficam no Catálogo).
- É restrição **visual**: a leitura da tabela `catalogo` continua liberada a todos os perfis, porque o registro
  precisa buscar o nome pelo código. Nenhuma política/RPC foi alterada.

Falta:
- [x] PR #32 aberta para `main` (Draft).
- [x] Conferência visual a 360 px feita em navegador de teste (entrada em Configurações e tela do Catálogo).
- [x] **Decisão do Jonatas (10/11):** o Catálogo é **somente do administrador**. Gerente e analista não veem. Já é o comportamento implementado.
- [ ] Perguntar "Posso fazer a merge?" — nunca mesclar sem autorização explícita.

## 5. Como trabalhar neste repositório

- Fonte: `src/app.html` (app inteiro) e `src/leitor-ean.js`. **Nunca editar `dist/` à mão**: rodar `node build.js`.
  `dist/painel.html` muda a cada build; não precisa entrar no commit (o CI não confere esse arquivo).
- Testes: `npm test` (Node + Playwright). Em ambiente sem o Chromium do Playwright, apontar para o Chrome do sistema.
- Fluxo obrigatório (`AGENTS.md`): branch dedicada → teste que falha → correção → suíte completa → PR → CI → pedir merge.
- Decisões do proprietário já tomadas: navegação Modelo C (Início/Produtos/Perecíveis/Alertas/Ajustes); setores do
  backend (Açougue, Laticínios, Padaria, Salgados, FLV, Mercearia); Notificações com 4 abas; temperatura fora do plano;
  `pg_net` mantida; objetivo final = **push avisando validades**.
- Convenções da interface nova: ícones em SVG (`ic('nome')` no JS; sem emoji), selos `.chip.ok/.wa/.da/.in`,
  cartões `.operator-record`, paginação `paginar(chave, itens, filtro, idDoPager)`, telas internas com
  `titulosTela`/`subtitulosTela`.
- Larguras a conferir sempre: **360 px** (aparelho do proprietário) e 320 px.

## 6. Diário (acrescente uma linha a cada mudança)

- 10/11 — Claude — Catálogo do administrador implementado na branch `feat/catalogo-admin` (`3ac395c`); este documento criado.
- 10/11 — Claude — PR #32 aberta; subtítulo do cabeçalho do Catálogo encurtado (cortava a 360 px); conferência visual feita. Falta só a autorização de merge.
- 10/11 — Claude — Push: segredo salvo pelo Jonatas; disparo testado (200, 6 avisos, 0 push por falta de aparelhos inscritos); migration `agendador_dispara_push` aplicada em produção e incluída na PR #32. Falta inscrever aparelhos e conferir a execução de 11/11.
- 10/11 — Claude — Decisão registrada: Catálogo somente para administrador (sem mudança de código). PR #32 segue aguardando autorização de merge.
- 10/11 — Claude — Push: cartão de ativação movido para Configurações e visível a todos os perfis (teste cobre os 5); Notificações ganhou atalho para lá. Registrado o limite do servidor para perfis globais sem vínculo com a loja (seção 3.1.1).
