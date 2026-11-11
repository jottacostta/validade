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

**Decisões do Jonatas (10/11, 11:11) — CONFIRMADAS**
1. O que não existe **deve ser construído** (não usar "em breve", não deixar fora do menu para sempre).
2. Gerente e analista usam a **mesma área**, com **menos acesso por hierarquia**.
3. O visual **segue o layout do operador** (escuro), não os cartões brancos da imagem.
4. Diretriz: "quanto mais completa a área do administrador, mais as outras áreas ganham acesso" — construir primeiro o
   administrador completo e depois liberar partes para os outros perfis.

**Estado atualizado em 10/11: ETAPA 1 IMPLEMENTADA NA BRANCH `feat/area-ajustes-administrador` (PR em preparação).**
- Menu administrativo com as 10 seções, seguindo os tokens e componentes escuros da Área do Operador.
- Analista, gerente e administrador recebem a mesma central, com visibilidade por hierarquia: analista 5 seções, gerente 6, administrador 10.
- As telas existentes são reaproveitadas sem mover seus elementos/IDs: cada subpágina filtra os cartões de `#preferencesArea` por `data-sec`.
- Catálogo abre a tela já existente; Perfil e Sobre reutilizam as telas atuais; Relatórios acionam os exports já existentes (CSV/compartilhamento).
- Recursos ainda não implementados não recebem controles falsos: relatórios consolidados, 2FA, sessões ativas, gestão de status de filiais, importação XLSX, exportação XLSX, limpeza no servidor, ambiente, suporte e documentação detalhada seguem como etapas futuras.
- O modo offline permanece automático; nenhuma opção manual foi criada porque o motor atual não oferece esse toggle.
- A PR #33 de documentação foi mesclada na `main`; esta implementação está em branch separada e não altera backend, migrations, RLS ou Edge Functions.

**Desenho pronto para a etapa 1 (casca de navegação), ainda não implementado**
- Em `#settingsRefArea`, no topo, um cartão `#sysMenuCard` "Ajustes do Sistema — Configurações, acessos e manutenção",
  escondido por padrão e visível para analista, gerente e admin (`papelAtual()`; no modo local o papel é `admin`).
- Dentro dele `#sysMenu`, com um botão `.opt-row[data-sys="<chave>"]` por seção, gerado a partir de uma lista no JS:

| chave | título | quem vê | o que abre |
|---|---|---|---|
| `perfil` | Perfil e Conta | analista, gerente, admin | `mostrarVistaAjustes('profile')` |
| `usuarios` | Usuários e Permissões | analista, gerente, admin | subpágina com `#cardUsuarios` |
| `lojas` | Lojas (Filiais) | admin | subpágina com `#cardLojasAdmin` |
| `catalogo` | Catálogo de Produtos | admin | `ir('catalogo')` (usar `id="cfgCatalogo"` neste botão e remover `#cfgAdminCard`) |
| `pereciveis` | Perecíveis e Validade | analista, gerente, admin | subpágina com os cartões "Etiqueta da balança" e "Alertas" |
| `relatorios` | Relatórios e Indicadores | analista, gerente, admin | subpágina nova com botões que acionam `#bCsvProd`, `#bRelProd`, `#bCsvPe`, `#bRelPe`, `#bAlertExport` |
| `auditoria` | Auditoria do Sistema | admin | subpágina com `#cardAuditoria` |
| `config` | Configuração Geral | gerente, admin | subpágina com "Busca do nome do produto", "Alertas" e `#cardConta` |
| `dados` | Dados e Manutenção | admin | subpágina com "Backup" e `#cardSolicitacoes` |
| `sobre` | Sobre o Sistema | analista, gerente, admin | `mostrarVistaAjustes('about')` |

- Subpágina **sem mover os cartões**: marcar cada cartão de `#preferencesArea` com `data-sec="..."` e, na subpágina,
  pôr `data-sec-ativa="<chave>"` em `#preferencesArea` com CSS escondendo os cartões das outras seções. Na tela normal de
  Configurações nada muda, então os testes que usam `#aDias`, `#aCosmos`, `#bExp` etc. continuam passando.
- `mostrarVistaAjustes` ganha a vista `'sys'` (título = nome da seção; abas escondidas; voltar retorna a Configurações).
- Testes a escrever primeiro: admin vê 10 itens; gerente vê 6 (sem lojas, catálogo, auditoria, dados); analista vê 5
  (sem configuração geral); operador não vê o cartão; em `pereciveis` `#aDias` aparece e `#bExp` não; em `dados` o inverso.
- Testes existentes a ajustar ao remover `#cfgAdminCard`: `test/operator-ui.test.js` (linhas com `cfgAdminCard`) —
  `#cfgCatalogo` continua existindo, agora dentro do menu.
- A hierarquia acima é **proposta do Claude**, não foi confirmada item a item pelo Jonatas.

**Etapas seguintes (cada uma em PR própria; as que mexem em banco precisam de migration + RLS + testes de contrato)**
2. Completar Relatórios: validade por período, registros por usuário, consolidado por loja, perdas/avarias, agendamento e exportação de auditoria.
3. Usuários: bloqueios e afastamentos; tela de perfis de acesso. Lojas: status ativa/inativa e gestão de equipes.
4. Catálogo: cadastrar/editar produto, categoria, setor/subsetor, importação XLSX. Dados: exportar XLSX e limpeza controlada no servidor.
5. Perfil: Meus Dados editável, 2FA (Supabase Auth MFA), sessões ativas. Configuração: parâmetros globais e integração administrável; modo offline continua automático até existir requisito/contrato técnico para alternância manual.
6. Sobre: ambiente (produção/staging), documentação e suporte. Implementar integrações sem expor chaves privilegiadas no cliente.

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
- 10/11 — ChatGPT — Iniciada a etapa 1 da Área de Ajustes: central de dez seções, subpáginas por perfil e reaproveitamento dos componentes existentes; sem alterações de backend. PR #33 já mesclada.


## 7.1 Especificação funcional consolidada — decisões aprovadas em 10/11/2026

Documento normativo criado: `docs/especificacao-funcional-administrador.md`.

Decisões confirmadas pelo proprietário:
- **Grupos:** um usuário pode pertencer a múltiplos grupos de lojas, atribuídos pelo Administrador. Assistente e Analista ficam restritos à união das lojas de seus grupos; Gerente e Administrador têm escopo global.
- **Permissões:** matriz padrão por perfil + exceções individuais por usuário, configuradas pelo Administrador por checkboxes. Permissão funcional e escopo territorial são dimensões separadas; exceções não podem ultrapassar o teto de autoridade nem ampliar lojas indevidamente.
- **Aprovação:** qualquer usuário com a permissão específica pode aprovar (não é necessária aprovação cumulativa), desde que esteja autorizado para a loja e não seja o próprio solicitante.
- **Cadastro:** Assistente cadastra Operadores no próprio escopo; Analista cadastra Operadores e Assistentes no próprio escopo; Gerente cadastra Operadores, Assistentes e Analistas em qualquer loja; Administrador cadastra todos os perfis e administra todos os grupos.
- **Solicitações:** alteração de nome de produto pode ser aprovada por Assistente, Analista, Gerente ou Administrador; exclusão somente por Gerente ou Administrador. Exclusão deve preservar histórico, preferencialmente por inativação lógica.

Essas decisões são **especificação aprovada, não funcionalidades implementadas**. A PR #34 continua sendo a primeira etapa de navegação; implementação de backend, migrations, RLS, Edge Functions e interface de gestão ocorrerá em etapas próprias.

- 10/11 — ChatGPT — Criado `docs/especificacao-funcional-administrador.md` na branch `feat/area-ajustes-administrador`; decisões de grupos, permissões e aprovações consolidadas. PR #34 permanece aberta, sem merge.

## 8. Ajustes do Operador — menu próprio (10/11/2026)

Pedido do Jonatas: replicar o padrão visual da central administrativa nos Ajustes do Operador, respeitando os limites do papel.

- Branch de trabalho: `feat/operator-settings-layout`, baseada na `main` em `fd27718928a312c2c0263c8cf48d6bcdcd83f4fd`.
- Implementação publicada na PR #36: menu dedicado para o perfil Operador com subpáginas de preferências/configuração, suporte e perfil, reutilizando os controles existentes e sem conceder opções administrativas.
- O Assistente mantém seu fluxo de Ajustes preexistente; a nova central é exclusiva ao Operador.
- Nenhuma migration, RPC, RLS, Edge Function, configuração ou dado remoto foi alterado nesta tarefa.
- Build e `npm test` passaram localmente (138/138 testes); os dois checks do CI da PR #36 passaram no commit `d53ca8a34d3f30b18ee974c1f604039e8d6d68a5`.
- Próximo: revisão da PR; sem merge ou deploy até autorização separada.

Diário:
- 10/11 — Manus — Implementada em branch dedicada a central visual de Ajustes do Operador, preservados os limites de papel e atualizados testes de navegador/contrato; validação local 138/138 e CI da PR #36 verde. Sem merge/deploy.
- 11/11 05:55 — Claude — **Nome do produto (PR #40, mesclada em `beb754e`)**: regra do Jonatas — gerente e administrador editam o nome direto em Editar registro (`#edNome`); operador, assistente e analista enviam a correção (`#bSolicitarNome` → RPC `solicitar_correcao_nome`) e gerente/admin avaliam no cartão `#cardCorrecoesNome` (Ajustes → Perecíveis e Validade; RPC `revisar_correcao_nome`). Migration `20261111050000_correcao_nome_catalogo` **aplicada em produção** com autorização (MD5 das 3 funções confere com o repositório): tabela `solicitacoes_nome` (RLS), gatilho `catalogo_nome_guard` que preserva nome já preenchido quando quem envia não é gerente/admin. Pendências: perecível ainda não tem fluxo de solicitação (só gerente/admin editam); notificar gerente/admin quando chegar solicitação nova; testar em aparelho real.
- 11/11 05:55 — Claude — PR #37 (armazenamento cheio → IndexedDB) mesclada ontem em `33311bc`. Teste `Google Calendar: JWT…` (PR #39 do Manus) falhou uma vez no CI e passou na reexecução: é instável, compara `validade_sessao` com campos extras (`cosmos`, `papel`, `nome`).
- 11/11 06:40 — Claude — **Alertas e Notificações virou seção do menu de Ajustes** (pedido do Jonatas: o cartão `#pushCard` ficava solto abaixo do menu). Novo item `alertas` em `SYS_SECOES` (analista, gerente, admin) e `op-alertas` em `OPERADOR_SECOES`, ambos logo acima de Sobre. `#pushCard` só aparece dentro dessa seção (ou em Configurações para perfis sem menu, ex.: assistente). Saiu das seções `config` e `op-preferencias` (renomeada para "Preferências"). `#bIrPush` abre a seção direto. Atenção: `#aDias`, `#aNotif`, `#alertaLojaDias`, regras pessoais, push e Google Calendar estão todos dentro de `#pushCard`, logo agora ficam em Alertas e Notificações.
- 11/11 07:40 — Claude — PR #42 (Alertas e Notificações no menu) mesclada com autorização (`53c310d`).
- 11/11 07:40 — Claude — **Perfis de acesso, etapa 1** (decisão do Jonatas: todas as permissões definidas pelo Administrador, **por perfil inteiro**, em dois blocos: básicas e especiais). Migration `20261111070000_perfis_de_acesso.sql`: tabela `papel_permissoes` (só guarda alterações; sem linha vale `private.permissao_padrao`), `private.tem_permissao(chave)`, RPC `definir_permissao_papel` (só admin, auditada). App: lista `PERMISSOES` em `src/app.html` (tem que ser igual à do banco; teste de contrato confere), `temPermissao()`, `carregarPermissoes()` (cache em `SYNC.permissoes`), cartão `#cardPerfisAcesso` em Ajustes → Usuários e Permissões (só admin).
  - **Já obedecem à tabela no servidor** (`servidor:true`): `nome_editar` e `nome_solicitar`.
  - **Só no app, dentro do teto atual do servidor** (dá para restringir, não para ampliar): `registrar`, `editar_proprios`, `solicitar_exclusao`, `relatorios`, `registros_editar_outros`, `exclusoes_aprovar`, `usuarios_gerenciar`.
  - **Travadas na tela** ("Regra fixa do servidor nesta etapa"): `alertas_loja_configurar`, `avisos_todas_lojas`, `lojas_gerenciar`, `catalogo_gerenciar`, `auditoria_ver`, `dados_manutencao`.
  - **Próximas etapas** (uma PR + migration por área): trocar as checagens fixas de papel por `private.tem_permissao(...)` nas policies/RPCs/Edge Functions (lotes e pere_regs, solicitações de exclusão, `gerir-usuarios`, lojas, catálogo, auditoria, função `alertas`), marcar `servidor:true` no app e abrir as seções do menu para os perfis que receberem a permissão (hoje `secaoPermitida` ainda exige `roles`).
- 11/11 08:30 — Claude — PR #43 mesclada e migration `perfis_de_acesso` aplicada em produção (08:00). **Decisão do Jonatas (08:05/08:07): nada pode ficar desabilitado na tela de Perfis de acesso; o Administrador concede qualquer permissão a qualquer perfil, sem limite.** Portanto toda permissão precisa virar `servidor:true` com `teto:TODOS4`.
- 11/11 08:30 — Claude — **Perfis de acesso, etapa 2**: migration `20261111080000_permissoes_registros_exclusoes.sql` — policies `*_ins`/`*_upd` de `produtos`, `lotes`, `pere_itens`, `pere_regs`, policy `solicitacao_sel` e funções `solicitar_exclusao`/`revisar_solicitacao_exclusao` passam a usar `private.tem_permissao` (alcance por loja inalterado). No app: `registrar`, `editar_proprios`, `solicitar_exclusao`, `registros_editar_outros`, `exclusoes_aprovar` liberadas para todos os perfis; `#cardSolicitacoes` foi para `data-sec="pereciveis"` (gerente não alcançava a seção `dados`).
  - **Ainda travadas (8), por ordem sugerida:** `relatorios` e `dados_manutencao` (só app: abrir as seções do menu para quem tiver a permissão, inclusive Operador/Assistente — `secaoPermitida` hoje exige `roles`); `auditoria_ver` (policy `auditoria_sel` + menu + `#cardAuditoria`); `alertas_loja_configurar` (função `private.validar_ajustes_alertas_gerenciais` + tela); `catalogo_gerenciar` (`private.proteger_tombstone_catalogo` + `podeVerCatalogo`); `lojas_gerenciar` (policies de `lojas`/`loja_membros` + Edge Function `gerir-usuarios`); `usuarios_gerenciar` (policies de `perfis` + `gerir-usuarios`); `avisos_todas_lojas` (hoje embutida em `private.tem_escopo_global`, `gerar_alertas_validade`, `preparar_alertas_push`, `projetar_google_calendar` e na Edge Function `alertas`: exige uma função `private.papel_tem_permissao(papel, permissao)` para uso em consultas por perfil).
- 11/11 08:45 — Claude — PR #44 mesclada e migration `permissoes_registros_exclusoes` aplicada em produção.
- 11/11 09:40 — Claude — **Perfis de acesso, etapa 3 (nada mais travado)**: migration `20261111090000_permissoes_areas_administrativas.sql` — `public.papel_tem_permissao(papel, permissao)` (para consultas por perfil e Edge Functions); policies de `auditoria`, `lojas`, `loja_membros`, `perfis`, `notificacoes`; funções `proteger_tombstone_catalogo`, `validar_ajustes_alertas_gerenciais`, `gerar_alertas_validade`, `preparar_alertas_push`, `projetar_google_calendar` (troca só do trecho de papel; falha inteira se o trecho não existir). Nova permissão `usuarios_excluir` (padrão: gerente) para manter a regra antiga de exclusão. Edge Functions `gerir-usuarios` e `alertas` consultam `papel_tem_permissao` (**precisam ser republicadas** apontando para o commit da `main`). App: as 16 permissões com `teto:TODOS4,servidor:true`; `SECAO_PERMISSAO` abre as seções Usuários, Lojas, Catálogo, Relatórios, Auditoria e Dados para qualquer perfil com a permissão (Operador recebe as seções extras no próprio menu); cartões usam `temPermissao`.
  - Limites conhecidos: (1) `private.tem_escopo_global()` continua por papel (analista, gerente, admin) — alcance de leitura/gravação entre lojas não virou permissão; (2) em `gerir-usuarios`, quem tem `usuarios_gerenciar` atua como gestor (cria/edita só Operador e Assistente; troca de papel acima disso continua do Administrador); Assistente sem a permissão mantém a regra antiga (cria Operador na própria loja); (3) seção `config` e `pereciveis` do menu seguem `roles`; (4) Assistente não tem menu: vê os cartões direto em Configurações.
- 11/11 09:55 — Claude — PR #45 mesclada, migration `permissoes_areas_administrativas` aplicada e Edge Functions `gerir-usuarios` v6 / `alertas` v5 republicadas (fixadas em `eea174e`). As 16 permissões ficaram concedíveis a qualquer perfil.
- 11/11 10:15 — Claude — **Perfis de acesso com botão Salvar** (pedido do Jonatas: não havia botão para guardar por perfil). As caixas ficam pendentes (`permPendentes`) até `#bPermSalvar`; `#permStatus` mostra quantas alterações faltam salvar; trocar de perfil com pendências pede confirmação; falha mantém a pendência. Removido o texto "Regra fixa do servidor" e a auditoria duplicada no cliente (o RPC já audita).
- 11/11 13:30 — Claude — **Aprovar exclusão não excluía** (relato do Jonatas). Causa: o lote da solicitação já estava removido (`deleted_at` preenchido 1,5 min depois do pedido, por outro caminho); `revisar_solicitacao_exclusao` lançava "Registro já removido ou não encontrado", desfazia tudo e a solicitação ficava pendente para sempre. Migration `20261111130000_aprovar_exclusao_ja_removida.sql`: nesse caso a aprovação conclui a solicitação e grava `ja_removido` na auditoria. Não foi causado pelas mudanças de permissões de hoje.
- 11/11 13:55 — Claude — PR #48 mesclada e migration `aprovar_exclusao_ja_removida` aplicada. **GitHub Actions/Pages instável desde ~12:20** (runner sem DNS no `playwright install`; `deploy-pages` falhou no commit `670a25d` com "Fetching artifact metadata failed"). Como a #48 não mudou o app, o site publicado segue igual ao da #46. Reexecutar os workflows da `main` quando o GitHub normalizar.
- 11/11 14:20 — Claude — **Alertas personalizados** (pedido do Jonatas: só o Administrador envia; ele habilita outros perfis em Perfis de acesso). Nova permissão `alertas_enviar` (padrão: ninguém além do admin). Migration `20261111140000_alertas_personalizados.sql`: RPC `enviar_alerta_personalizado(titulo, mensagem, loja?, papel?)` grava em `notificacoes` com `tipo='sistema_personalizado'` (aba Sistema), `dedupe_key='personalizado:<envio>'`, `payload.envio_id/remetente_id`; loja nula = todas (exige `tem_escopo_global`); o remetente não recebe. Edge Function `alertas`: nova ação `custom-push` (só o remetente, envio de até 15 min) manda web push aos aparelhos inscritos. App: cartão `#cardAlertaPersonalizado` no topo de Ajustes → Alertas e Notificações (`#apTitulo`, `#apMensagem`, `#apLoja`, `#apPapel`, `#bApEnviar`, `#apStatus`). Pendências: histórico de alertas enviados; envio para um usuário específico; agendamento.
- 11/11 12:35 — Claude — **Aviso de instalação (PWA)** (pedido do Jonatas): cartão `#installCard` no Início ("Instale o aplicativo", botões Instalar / Agora não) e cartão `#installSobre` em Sobre. Usa `beforeinstallprompt` quando o navegador oferece; senão mostra o passo a passo (iOS: Compartilhar → Adicionar à Tela de Início; demais: menu → Instalar aplicativo). Some quando aberto como app instalado (`display-mode: standalone`) ou após `appinstalled`; "Agora não" adia 7 dias (chave `pwa_install_adiado` — **não usar prefixo `validade_`**: a migração de dados antigos no início do script trata chave única com esse prefixo como dados). Manifest ganhou ícone 512 (`src/pwa-icon-512.png`, exigido pelo Chrome/Android) e cores do app; o service worker passa a ser registrado ao abrir (`registrarServiceWorker`, só em https).
