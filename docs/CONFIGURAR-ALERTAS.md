# Alertas internos compartilhados e Push pessoal

Este documento descreve o desenho no código versionado. **A correção do cron desta branch ainda depende de aplicação da migration e deploy da Edge Function.** Confirme o estado real do Supabase antes de qualquer rollout.

## Semântica e permissões

- **Alertas internos no app:** continuam compartilhados no escopo da loja; notificações são geradas para os destinatários da loja e para perfis globais conforme as políticas existentes. A janela de antecedência é uma configuração compartilhada da loja (`public.ajustes.dias`), não uma preferência local.
- **Quem configura a loja:** somente **gerente ou administrador** pode alterar a janela compartilhada e autorizar/desautorizar o Push interno. O banco aplica a restrição no trigger; o frontend também deixa os controles somente leitura para os demais papéis. Administradores mantêm acesso irrestrito.
- **Push interno da loja:** é um canal distinto, desligado por padrão e habilitado apenas após autorização gerencial. Depois de autorizado, os alertas internos novos podem ser enviados aos destinatários com subscription Push válida. Cada pessoa ainda precisa ativar o Push no próprio aparelho; desativar o Push da loja impede novas entregas internas.
- **Push pessoal:** cada usuário configura várias regras próprias de antecedência em dias e hora local, por exemplo `30 dias / 08:00`, `15 dias / 09:00` e `7 dias / 08:00`. A autorização do Push interno não altera essas regras pessoais.
- **Escopo e aparelho:** as regras pessoais são da conta; a subscription é vinculada ao usuário e ao aparelho. Sem subscription válida, a preferência é mantida, mas não há entrega Push naquele aparelho.
- **Fuso:** cada regra pessoal armazena timezone IANA; o padrão é `America/Sao_Paulo`. “30 dias” significa diferença de data civil nesse fuso, não 720 horas.
- **Ajustes locais:** o destaque da lista e o lembrete nativo seguem locais ao aparelho; não controlam os alertas internos compartilhados nem o cron do Push.
- **Avisos de sistema:** avisos manuais `sistema_personalizado`, enviados pela função autorizada de gerente/administrador, aparecem em uma faixa global no topo para a loja selecionada. O botão **OK** marca somente aquele aviso como lido para a conta autenticada; o app busca avisos ao restaurar/selecionar a sessão, ao retornar ao app e periodicamente (com limite de uma consulta por minuto). Isso é distinto do Push.

## Arquivos envolvidos

- `supabase/migrations/20261110160000_alertas_regras_pessoais.sql`: cria `alertas_regras` com RLS por usuário e a outbox pessoal idempotente; preserva a geração diária dos alertas internos e instala o dispatcher minutely.
- `supabase/migrations/20261111173500_gerar_alertas_via_edge_function.sql`: substitui a chamada SQL direta do `pg_cron` por uma chamada autenticada à Edge Function `alertas`, que executa o RPC usando `service_role` no servidor.
- `supabase/migrations/20261110170000_push_interno_autorizado.sql`: acrescenta autorização de Push por loja, restringe mudanças em `ajustes.dias` e `push_interno` a gerente/admin, e cria outbox idempotente separada para notificações internas.
- `supabase/functions/alertas/index.ts`: valida o segredo para geração diária e dispatch; gera notificações internas via RPC de servidor, prepara/reivindica filas pessoais e internas separadamente, envia aos subscribers do destinatário e registra resultados. Inscrição e cancelamento continuam exigindo JWT válido e escopo de loja.
- `src/app.html`: cartão dedicado combina regras pessoais e Push, apresenta a janela interna da loja em leitura para papéis sem permissão, mantém o cache das regras offline separado por UID e mostra os avisos de sistema no topo.

## Dependências e credenciais

A migration usa `pg_cron`, `pg_net` e os valores já esperados no Vault pelo agendador: `alertas_function_url`, `alertas_anon_key` e `alertas_cron_secret`. A Function também exige as variáveis de runtime do Supabase e os secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e `ALERTAS_CRON_SECRET`. Não grave tokens, chaves privadas, endpoints Push ou corpos de subscriptions no Git, no frontend, em tickets ou logs.

O gateway JWT da Function deve permanecer habilitado. Antes do rollout, valide em homologação que a chamada do Cron com a credencial guardada no Vault passa pelo gateway e que o segredo de cron é conferido pela Function; não contorne um 401 desabilitando a validação JWT. Nenhum segredo deve ser copiado para migrations ou documentação.

## Cadência e confiabilidade

- Geração de notificações internas: diariamente às 09:00 UTC, conforme a convenção existente no projeto. O `pg_cron` chama a Edge Function protegida, que usa `service_role` para executar o RPC; a chamada de geração grava notificações no app, mas não envia Push diretamente. A janela de antecedência é a definida pelo gerente/admin para cada loja.
- Push pessoal: o dispatcher é chamado a cada minuto e materializa a regra quando o horário local configurado é alcançado na data prevista.
- Push interno: a fila só inclui notificações criadas enquanto o Push da loja estiver autorizado; notificações anteriores à autorização não são enviadas retroativamente.
- Chaves únicas por regra/usuário/loja/registro/validade/data local e por notificação interna evitam duplicatas durante reexecuções concorrentes.
- As outboxes usam lease e backoff, encerrando após oito tentativas. O provedor Web Push é externo e não garante entrega estritamente uma vez; uma falha após entrega remota e antes da confirmação pode causar reenvio.
- Notificações internas persistentes continuam como canal de consulta no app mesmo quando Push pessoal ou Push interno está desativado/indisponível.

## Rollout seguro

1. Revisar as migrations, contratos de RLS e sequência no ambiente de homologação.
2. Confirmar os secrets requeridos no Vault/Supabase sem revelar valores.
3. Aplicar migrations apenas com autorização explícita e pelo fluxo de deploy aprovado.
4. Fazer deploy da Edge Function apenas com autorização explícita, mantendo JWT habilitado.
5. Testar como gerente/admin a configuração compartilhada e autorização do Push interno; confirmar que operador, assistente e analista conseguem consultar a janela da loja, mas não a alteram.
6. Testar múltiplas regras pessoais, lojas diferentes, perfis globais, dispositivos sem subscription, retries, endpoint expirado, desligamento do Push interno e isolamento das preferências por UID.
7. Não considerar a aceitação local dos testes como prova de aplicação de migration, configuração do Vault, execução do cron ou entrega real de Push.

## Google Calendar pessoal

A integração Google é opcional e pertence à conta individual do usuário. Quando autorizada, os avisos pessoais são sincronizados com o calendário principal da conta Google, considerando as regras pessoais ativas, os registros das lojas às quais esse usuário tem acesso, a hora/fuso de cada regra e ocorrências futuras em uma janela limitada. Isso não habilita nem substitui o Push interno compartilhado da loja. Desconectar remove a autorização guardada pelo app; eventos já criados no Google Calendar não são apagados automaticamente.

A sincronização automática atual é iniciada pelo PWA ao restaurar a sessão e durante a sincronização periódica da loja, com intervalo mínimo entre reconciliações; também há botão de sincronização manual. **Não existe dispatcher server-side para Calendar nesta entrega**, então mudanças de estoque não chegam ao Google enquanto o PWA do usuário não voltar a ficar ativo.

Os IDs determinísticos e o mapping por usuário tornam as tentativas repetidas idempotentes: se duas sincronizações criarem o mesmo evento ao mesmo tempo, a resposta `409` é reconciliada atualizando o evento existente; eventos previamente mapeados que sumiram do Calendar são verificados e recriados com o mesmo ID. Se o Google responder `invalid_grant` ao renovar o token, a conexão local é removida e a interface pede que o usuário conecte novamente; a falha não expõe nem registra o refresh token.

O OAuth deve ser iniciado no servidor após validar o JWT Supabase e usar um `state` aleatório de uso único no callback HTTPS. O refresh token é cifrado no backend e nunca enviado ao PWA. Use o scope mínimo necessário, preferencialmente `https://www.googleapis.com/auth/calendar.events.owned`, e o calendário `primary`; a API permite criar eventos com horário e fuso IANA. Consulte a [documentação oficial do fluxo OAuth Web Server](https://developers.google.com/identity/protocols/oauth2/web-server), [scopes do Calendar](https://developers.google.com/workspace/calendar/api/auth) e [criação de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

Para habilitar em produção, o proprietário do projeto precisa ativar Google Calendar API no Google Cloud, configurar a tela de consentimento e registrar um OAuth Client ID do tipo Web. A URI de callback HTTPS deve coincidir exatamente com a URI configurada no Google Cloud. O tipo External em estado Testing aplica expiração curta aos refresh tokens quando se pedem scopes do Calendar; a documentação do Google informa sete dias nesse cenário. Para uso contínuo, configure o público/publicação e conclua a verificação exigida para o scope e público escolhidos ([OAuth consent e verificação](https://developers.google.com/workspace/guides/configure-oauth-consent), [ciclo de vida dos refresh tokens](https://developers.google.com/identity/protocols/oauth2)).

O backend requer os secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` e uma chave de 32 bytes em Base64 chamada `GOOGLE_CALENDAR_TOKEN_KEY`, além do Supabase Edge Function runtime. Configure os valores somente no cofre de secrets da Edge Function; não os coloque em `config.json`, HTML, GitHub, issue ou log. A Function que recebe o callback Google precisa de `verify_jwt=false` no gateway porque o navegador retorna do Google sem JWT Supabase; seus endpoints de status, autorização, sincronização e desconexão continuam validando o JWT Supabase dentro da Function. O rollout dessa integração exige credenciais e consentimento Google configurados pelo proprietário e não está concluído apenas por existir código local.
