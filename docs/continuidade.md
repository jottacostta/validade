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
| `main` | commit `1da3e67` (merge da PR #32). Publicada no GitHub Pages: `jottacostta.github.io/validade/` |
| PR #29 (layout Guanabara) | mesclada na branch da #22 em 10/11 |
| PR #22 (backend Área do Operador + layout) | mesclada na `main` (`edb4bd6`) |
| PR #30 (limpar notificações, senha pelo servidor, sessões, agendador) | mesclada na `main` (`4c16aa6`) |
| PR #31 (quantidade espremida + auditoria 360/320 px) | mesclada na `main` (`5b02033`) |
| PR #32 (Catálogo do administrador, push em Configurações, agendador do push, avisos para perfis globais) | mesclada na `main` (`1da3e67`) em 10/11, com autorização do Jonatas |
| **Área do Administrador (seção 7)** | **NÃO INICIADA — próximo trabalho grande** |
| PRs #19, #27, #28 (documentação) | abertas, não tocadas por Claude. Estão desatualizadas em relação ao que foi implementado |

Donos de branch: desde 10/11 o Jonatas passou a **#22 e #29 para o Claude**. Se outro agente assumir,
registre a troca na issue #25 antes de enviar commits.

## 2. Estado de PRODUÇÃO (Supabase, projeto `validade`)

Tudo abaixo foi aplicado com autorização explícita do Jonatas na sessão de 10/11.

- **Migrations aplicadas** (além das anteriores):
  - `offline_rpc_idempotency` — `registrar_lote` / `registrar_perecivel` idempotentes. Conferido: MD5 do corpo das funções em produção = arquivo do repositório.
  - `notificacoes_remocao_logica` — coluna `removida_em`; `authenticated` tem só `SELECT` e `UPDATE(lida_em, removida_em)`.
  - `agendar_alertas_validade` — `pg_cron`, job `gerar-alertas-validade-diario`, `0 9 * * *` (06:00 de Brasília).
  - `alertas_escopo_global` — destinatários de `gerar_alertas_validade()` = vinculados + analista/gerente/admin de todas as lojas; políticas de `notificacoes` aceitam `private.tem_escopo_global()`. Conferido: MD5 de `prosrc` em produção = corpo do arquivo do repositório (`53253286…`).
  - `agendador_dispara_push` — o mesmo job passa a chamar a Edge Function `alertas` (`dispatch`) via `pg_net`, lendo endereço, chave pública e segredo do Vault.
- **Edge Function `gerir-usuarios`**: versão 3. O arquivo publicado é um ponto de entrada de 1 linha que importa
  `supabase/functions/gerir-usuarios/index.ts` do repositório **fixado no commit `4c16aa6c6f68c0e7f47f6f7970111fe634624fb5`**.
  - Se o arquivo mudar na `main`, **é preciso publicar de novo** (`supabase functions deploy gerir-usuarios`), senão produção fica na versão antiga.
  - Teste feito: chamada sem usuário respondeu `401 {"error":"Sessão inválida"}` (a função inicializa).
  - **Não testado com usuário real:** `listar`, `criar`, `editar`, `trocar_senha_primeiro_acesso`, `trocar_senha`.
- **Edge Function `alertas`**: versão 3, publicada em 10/11 pelo mesmo método da `gerir-usuarios` — ponto de entrada de 1 linha importando
  `supabase/functions/alertas/index.ts` **fixado no commit `1da3e67d5fd77394d8ff16070144b0516b95a578`**. Se o arquivo mudar na `main`, publicar de novo.
  Testes após publicar: `?action=public-key` → 200; `dispatch` → `200 {"notificacoes":2,"enviados":0,...}`.
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
- [x] A migration está na `main` (PR #32 mesclada).
- Se o segredo for trocado no painel, atualizar o mesmo valor no Vault (`vault.update_secret`), senão o job recebe 401.

### 3.1.1 Avisos para perfis de escopo global — APLICADO EM PRODUÇÃO (10/11)
**Decisão do Jonatas:** analista, gerente e administrador recebem avisos de **todas as lojas**; operador e assistente, só das vinculadas.
- [x] Migration `alertas_escopo_global` aplicada (MD5 conferido) e função `alertas` v3 publicada.
- [x] `dispatch` após a mudança gerou 2 avisos novos (destinatários globais), 0 push (nenhum aparelho inscrito).
- [ ] Testar com usuário real: gerente/admin sem vínculo ativa o push em Configurações e recebe o aviso.
- Atenção: administrador passa a receber avisos de todas as lojas — pode ser muito volume. Se o Jonatas reclamar,
  a solução é preferência por usuário (não existe hoje).
- `gerar_alertas_validade()` recusa quem não é `service_role`; por isso o agendador chama a Edge Function.

### 3.2 Catálogo do administrador — CONCLUÍDO (PR #32 mesclada)
Somente o administrador vê (decisão do Jonatas). Ver seção 4. Falta apenas teste em aparelho real.

### 3.2.1 Área do Administrador — NÃO INICIADA
Ver seção 7 (plano detalhado e imagem de referência).

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
- [x] Merge autorizada pelo Jonatas e feita em 10/11 (`1da3e67`).

## 7. Área do Administrador (pedido de 10/11 — NÃO INICIADO)

Pedido do Jonatas: *"crie a área do administrador: tudo o que tem na área do operador mais o que está na imagem"*.
Imagem de referência: `docs/referencias/area-administrador.jpg` ("Estrutura Definitiva da Área de Ajustes (Administrador)").

**Layout da imagem:** cabeçalho "Controle de Validade / Área do Administrador" com sino; título "Ajustes do Sistema —
Configurações, acessos e manutenção"; lista de 10 cartões **claros** (fundo branco, ícone colorido, título, subtítulo, seta);
cada cartão abre uma subpágina com lista de itens no mesmo estilo; barra inferior igual à do operador, com "Ajustes" em amarelo.

O que já existe no app para cada seção (todas as partes existentes estão hoje em Ajustes → "Configurações avançadas",
em `src/app.html`, dentro de `#preferencesArea`):

| Seção da imagem | Já existe | Não existe (precisa construir) |
|---|---|---|
| 1. Perfil e Conta | Perfil (`#profileArea`), Alterar Senha (`#passwordArea`), "Sair de todos os aparelhos" | Meus Dados editável, **2FA** (Supabase Auth MFA), lista de Sessões Ativas |
| 2. Usuários e Permissões | `#cardUsuarios` (listar/criar/editar via função `gerir-usuarios`, vínculo com lojas) | Tela "Perfis de Acesso" (hoje a matriz é fixa no código), Bloqueios e Afastamentos |
| 3. Lojas (Filiais) | `#cardLojasAdmin` ("Administração de lojas") — **verificar o que ele faz hoje** | Status ativa/inativa, gerenciar equipes |
| 4. Catálogo de Produtos | Tela `#v-catalogo` (consulta + "+" para registrar) | Cadastrar/editar produto, categoria, setor/subsetor, importação XLSX |
| 5. Perecíveis e Validade | Aba "Códigos" de perecíveis (`#pe-cad`), dias de alerta (`#aDias`), etiqueta da balança (`#aDig`, `#aValor`) | Regras de alerta por categoria, categorias de perecíveis |
| 6. Relatórios e Indicadores | Planilha CSV e Relatório de texto em Meus Registros/Perecíveis/Alertas | Validade por período, registros por usuário, consolidado por loja, perdas e avarias, agendamento de envios |
| 7. Auditoria do Sistema | `#cardAuditoria` (somente admin) + tabela `auditoria` + `auditar()` no app | Filtros por usuário/loja/período, exportação |
| 8. Configuração Geral | Notificações (`#aNotif`), token Cosmos (`#aCosmos`), OCR (`#aOcr`), som/vibração | Parâmetros do sistema, "Integrações" como tela, **toggle de Modo Offline** (hoje o offline é automático) |
| 9. Dados e Manutenção | Backup/restauração em JSON, "Apagar todos os dados" local, solicitações de exclusão | Importar produtos XLSX, exportar registros XLSX, limpeza de registros no servidor |
| 10. Sobre o Sistema | `#aboutArea` (versão, plataforma) | Ambiente (Produção/Staging), suporte e documentação |

**Ordem sugerida de implementação**
1. **Casca de navegação** (só front-end, sem backend): para `papelAtual()==='admin'`, Ajustes abre "Ajustes do Sistema" com os
   10 cartões; cada cartão abre uma subpágina que **reaproveita** os blocos existentes (mover os cartões de
   `#preferencesArea` para as subpáginas certas, mantendo os IDs — muitos testes usam esses IDs).
   Operador e demais perfis continuam com a tela atual de Configurações.
2. Itens só de front-end: filtros/exportação da auditoria, relatórios a partir dos dados já sincronizados, "Sobre" com ambiente.
3. Itens que exigem backend (cada um com migration, RLS e testes próprios): 2FA, sessões ativas, bloqueio de usuário,
   status de loja, categorias, importação XLSX, perdas e avarias, agendamento de envios.

**Decisões que precisam do Jonatas antes de construir**
- Itens sem backend aparecem como "em breve" ou ficam fora do menu até existirem? (até aqui a regra foi: nada de controle decorativo)
- Gerente e analista usam esta mesma área (com menos itens) ou só o administrador? (o Catálogo ele definiu como só admin)
- O visual dos cartões é claro (fundo branco) sobre fundo escuro — confirmar que é isso mesmo, já que a Área do Operador é toda escura.

**Cuidados**
- Não mover controles sem ajustar/rodar a suíte: os testes clicam em `nav button[data-v="aj"]` e usam direto `#aDias`, `#aCosmos`,
  `#bExp`, `#cardUsuarios` etc. Hoje `#preferencesArea` fica visível ao abrir Ajustes; se a casca esconder isso, os testes precisam
  ser atualizados para navegar até a subpágina (sem enfraquecer asserções).
- Autorização sempre validada no servidor (`AGENTS.md`): esconder menu não é segurança.
- Conferir sempre em 360 px.

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
- 10/11 — Claude — Decisão: perfis globais recebem avisos de todas as lojas. Migration `alertas_escopo_global` + ajuste em `alertas/index.ts` + teste de contrato na PR #32. Nada aplicado/publicado em produção ainda.
- 10/11 — Claude — PR #32 mesclada (`1da3e67`); migration `alertas_escopo_global` aplicada e conferida por MD5; função `alertas` v3 publicada e testada (public-key 200, dispatch 200). Pedido novo registrado: Área do Administrador (seção 7), não iniciada; imagem em `docs/referencias/area-administrador.jpg`.
