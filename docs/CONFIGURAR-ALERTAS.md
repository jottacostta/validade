# Configurar alertas internos e push

Este guia descreve a configuração posterior dos alertas e Web Push. Estado verificado em 2026-11-09: as migrations de solicitações de exclusão, matriz de papéis/ownership, validação fail-closed da revisão, isolamento dos tokens pessoais e índices de chaves estrangeiras já foram aplicadas ao Supabase. A migration de associação catálogo/produto (`20261107120000_produtos_como_associacao.sql`) e a migration desta área (`20261109000000_area_operador_compartilhamento_alertas.sql`) ainda não foram aplicadas; nenhuma Edge Function foi publicada e nenhum Cron foi criado.

As migrations remotas foram aplicadas como versões `20261109121203_solicitacoes_exclusao_com_aprovacao`, `20261109121652_matriz_papeis_ownership_rls`, `20261109122158_harden_review_role_null`, `20261109122302_restrict_personal_cosmos_token_access` e `20261109122348_index_audit_and_creator_foreign_keys`. A migration de associação de produtos e a migration do Operador devem aguardar a publicação do frontend compatível: a versão atualmente publicada ainda envia `nome` para `produtos` e não envia setor em novos lotes/perecíveis. Aplicar essas duas migrations antes do frontend atualizado interromperia cadastros.

## O que será configurado

A migration `supabase/migrations/20261109000000_area_operador_compartilhamento_alertas.sql` adiciona setor e snapshot de autoria, RPCs de registro, tabela de notificações internas e subscriptions Web Push. A Function `alertas` valida JWT nas ações de inscrição e valida segredo separado na ação de dispatch. A ação de dispatch chama a RPC que cria notificações idempotentes para todos os membros de cada loja e envia push às subscriptions registradas para cada usuário destinatário.

## Secrets fora do repositório

Configure estes valores no painel do Supabase (Edge Functions → Secrets) ou pelo mecanismo seguro de secrets do projeto. **Não os coloque em arquivos versionados, código frontend, tickets, logs ou comandos gravados no histórico do shell.** A Function também precisa das variáveis padrão do ambiente Supabase `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; esta última só é lida no servidor.

- `VAPID_PUBLIC_KEY`: chave pública VAPID; pode ser retornada ao cliente por `GET ?action=public-key`.
- `VAPID_PRIVATE_KEY`: chave privada VAPID; somente no servidor.
- `VAPID_SUBJECT`: subject VAPID, normalmente um `mailto:` operacional ou URL institucional.
- `ALERTAS_CRON_SECRET`: segredo aleatório longo, independente das chaves VAPID, enviado somente pelo agendador no header `x-alertas-cron-secret`.

Gere as chaves VAPID localmente com ferramenta confiável instalada no seu computador/ambiente administrativo, por exemplo `npx web-push generate-vapid-keys`. Guarde o par em um cofre de secrets; cadastre a pública e a privada nos secrets da Function. Gere `ALERTAS_CRON_SECRET` com gerador criptográfico de aleatoriedade (p.ex. `openssl rand -hex 32`) e transfira-o diretamente ao secret store e ao Cron. Não registre a saída em documentação ou Git.

## Publicação após autorização

1. Faça backup e revisão das migrations, confirme a publicação do frontend compatível e confira a sequência/estado das migrations no projeto; programe janela apropriada.
2. **Somente com autorização explícita**, aplique as migrations versionadas pelo fluxo de deploy de banco aprovado.
3. **Somente com autorização explícita**, faça deploy de `supabase/functions/alertas` preservando o gateway JWT padrão (não configurar `verify_jwt = false`).
4. Cadastre os secrets acima no projeto Supabase correto. Não exponha service role nem chave VAPID privada ao navegador.

A chamada de scheduler exige o JWT padrão da Edge Function além do segredo de cron: envie `Authorization: Bearer <JWT de serviço de curta duração apropriado>` e `x-alertas-cron-secret: <secret>`. Não copie tokens/segredos para o repositório. Use um provedor de agendamento com armazenamento seguro de headers; se não houver forma segura de manter um JWT válido, escolha uma integração Supabase suportada com credenciais seguras em vez de desativar a validação JWT do gateway. Não usar anon key como autenticação do dispatch.

## Agendamento sugerido

Configure externamente um Cron **diário às 09:00 no fuso `America/Sao_Paulo`** (`0 9 * * *`, com timezone configurado explicitamente pelo provedor). POST para a URL da Function `alertas` com JSON `{"action":"dispatch"}` e headers `Content-Type: application/json`, `Authorization: Bearer ...` e `x-alertas-cron-secret: ...`. Configure retries limitados e alertas operacionais sem registrar headers nem corpo de subscriptions.

O cron **não está configurado** nesta entrega. A RPC gera alertas de validade até `ajustes.dias` dias (fallback 30) e alertas vencidos. Chaves únicas por destinatário, registro, data de validade e tipo impedem duplicação. Registros novos sem setor válido são rejeitados; registros legados podem continuar com setor `NULL`.

## Validação após publicação

1. Use ambiente de homologação com usuários de teste vinculados a pelo menos duas lojas; nunca faça o teste inicial em produção.
2. Com JWT de usuário membro, consulte `GET ?action=public-key`, habilite push com gesto explícito do usuário no navegador e chame `POST` `{"action":"subscribe","lojaId":"…","subscription":{"endpoint":"…","keys":{"p256dh":"…","auth":"…"}}}`. Confirme que usuário sem vínculo recebe `403`.
3. Chame `unsubscribe` autenticado e confirme que somente o endpoint pertencente àquele usuário é removido; `lojaId` serve para validar que ele ainda tem acesso a uma loja ativa. Endpoint já vinculado a outra conta deve ser rejeitado.
4. Registre lote e perecível por suas RPCs; confira atomicidade, autoria e setor na loja correta. Teste payload inválido, duplicidade de lote normalizada, mesmo `p_id`, ausência de acesso à loja e setor inválido.
5. Execute dispatch com credenciais válidas em homologação. Confirme notificações internas, ausência de notificações duplicadas em reexecução, escopo estrito por loja, envio push e remoção de subscriptions que respondam 404/410. Teste também segredo incorreto e falta de configuração VAPID.
6. Verifique a tela de notificações e o estado `lida_em` com usuário destinatário; teste tentativa de leitura/alteração por outro usuário.

## Limitações e permissões

- Notificações internas são persistentes; RLS permite leitura e atualização apenas pelo destinatário que ainda seja membro da loja. A criação é restrita a `service_role` por grants, sem policy de inserção para clientes.
- Subscriptions são associadas ao usuário e ao aparelho, com endpoint único global; assim, o mesmo usuário pode receber alertas das lojas às quais continua vinculado. A Function valida membership ao ativar e administra subscriptions via service role. As chaves/endpoint são dados sensíveis; não devem ser logados nem enviados a analytics.
- Push depende de navegador compatível, permissão explícita, service worker instalado, conexão e endpoint ainda válido. O envio pode falhar ou ser atrasado; a notificação interna persiste como canal de fallback.
- A remoção automática ocorre em respostas HTTP 404/410. Outras falhas são contabilizadas sem registrar endpoint/chaves; considere métricas agregadas e política de retry no scheduler.
- A camada não substitui os controles atuais de acesso por loja. Revisar políticas e grants das migrations anteriores antes de aplicar.
