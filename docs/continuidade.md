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
| **Branch `feat/catalogo-admin`** | **aberta — Catálogo do administrador (ver seção 4). Aguarda PR/CI/autorização de merge** |
| PRs #19, #27, #28 (documentação) | abertas, não tocadas por Claude. Estão desatualizadas em relação ao que foi implementado |

Donos de branch: desde 10/11 o Jonatas passou a **#22 e #29 para o Claude**. Se outro agente assumir,
registre a troca na issue #25 antes de enviar commits.

## 2. Estado de PRODUÇÃO (Supabase, projeto `validade`)

Tudo abaixo foi aplicado com autorização explícita do Jonatas na sessão de 10/11.

- **Migrations aplicadas** (além das anteriores):
  - `offline_rpc_idempotency` — `registrar_lote` / `registrar_perecivel` idempotentes. Conferido: MD5 do corpo das funções em produção = arquivo do repositório.
  - `notificacoes_remocao_logica` — coluna `removida_em`; `authenticated` tem só `SELECT` e `UPDATE(lida_em, removida_em)`.
  - `agendar_alertas_validade` — `pg_cron`, job `gerar-alertas-validade-diario`, `0 9 * * *` (06:00 de Brasília), comando `select public.gerar_alertas_validade()`.
- **Edge Function `gerir-usuarios`**: versão 3. O arquivo publicado é um ponto de entrada de 1 linha que importa
  `supabase/functions/gerir-usuarios/index.ts` do repositório **fixado no commit `4c16aa6c6f68c0e7f47f6f7970111fe634624fb5`**.
  - Se o arquivo mudar na `main`, **é preciso publicar de novo** (`supabase functions deploy gerir-usuarios`), senão produção fica na versão antiga.
  - Teste feito: chamada sem usuário respondeu `401 {"error":"Sessão inválida"}` (a função inicializa).
  - **Não testado com usuário real:** `listar`, `criar`, `editar`, `trocar_senha_primeiro_acesso`, `trocar_senha`.
- **Edge Function `alertas`**: versão 1 (09/11), não alterada. `VAPID_PUBLIC_KEY` está configurada (a função devolve a chave pública).
- **Extensões**: `pg_cron`, `pg_net` (instalada para teste; o Jonatas decidiu **manter**, é necessária para o push), `supabase_vault`.
- **Vault**: segredo `alertas_cron_secret` criado (valor só no cofre; não está no repositório).
- Avisos do linter de segurança que já existiam e **não foram tratados**: `solicitar_exclusao` e `revisar_solicitacao_exclusao`
  são `SECURITY DEFINER` executáveis por `authenticated` (ambas conferem sessão, loja e papel — revisado por leitura);
  proteção contra senhas vazadas do Auth desligada (liga-se no painel).

## 3. PENDÊNCIAS, em ordem de prioridade

### 3.1 Push de validade (objetivo declarado do proprietário) — BLOQUEADO em ação do Jonatas
Situação: o agendador gera os avisos **dentro do app**, mas o **push não sai**.

1. **[Jonatas]** Salvar o segredo `ALERTAS_CRON_SECRET` em *Supabase → Edge Functions → Secrets*, com o **mesmo valor**
   guardado no Vault (`alertas_cron_secret`). O valor foi entregue a ele no chat. Dois pedidos automáticos pelo conector
   ficaram sem confirmação; precisa ser feito no painel.
2. **[agente]** Confirmar com um disparo de teste: `POST /functions/v1/alertas` com corpo `{"action":"dispatch"}`,
   cabeçalhos `Authorization: Bearer <anon key>` e `x-alertas-cron-secret: <segredo do Vault>`.
   - `401 Não autorizado` → segredo ainda não salvo (estado atual em 10/11 08:30).
   - `503 Credenciais VAPID não configuradas` → falta `VAPID_PRIVATE_KEY` e/ou `VAPID_SUBJECT`.
   - `200` → funcionando.
   - O teste pode ser feito de dentro do banco com `net.http_post`, lendo o segredo de `vault.decrypted_secrets`.
3. **[agente]** Nova migration trocando o job do `pg_cron`: em vez de `select public.gerar_alertas_validade()`, chamar a
   função `alertas` (ação `dispatch`) via `net.http_post` com o segredo lido do Vault. Motivo: a função `alertas` só envia
   push das notificações **criadas naquela chamada**; se o banco gerar antes, o push não é enviado.
   **Não colocar segredo nem token na migration** (há teste de contrato: `test/supabase-contract.test.js`).
4. **[operadores]** Cada aparelho precisa tocar em "Ativar notificações" (Alertas → Notificações → Push neste aparelho).
   Em 10/11 havia 0 inscrições em `push_subscriptions`.
5. Verificar no dia seguinte `cron.job_run_details` (a primeira execução do job é 11/11 às 09:00 UTC).

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
- [ ] Abrir a PR para `main`, aguardar CI.
- [ ] Conferência visual a 360 px (o script de captura falhou por erro meu no script, não no app).
- [ ] Decidir com o Jonatas se **gerente/analista** também devem ver o catálogo (hoje: só admin).
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
