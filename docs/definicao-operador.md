# Definição funcional — Área do Operador

**Status:** definição funcional em andamento. As decisões confirmadas abaixo devem ser preservadas na implementação. Esta documentação não autoriza mudanças de layout ou migrations de produção.

## Objetivo

Definir o comportamento da área Operador, respeitando o layout já existente. O Supabase/PostgreSQL é a fonte oficial dos dados; o navegador não deve ser requisito para persistência.

## Tela inicial e navegação — confirmado

- Ao entrar na área do Operador, a tela inicial já abre diretamente no **modo leitor de código**.
- No fluxo inicial, o Operador escolhe entre **Produtos industrializados** e **Produtos perecíveis**.
- Não criar dashboard/painel inicial alternativo nem redesenhar o layout já definido.
- Após concluir um cadastro com sucesso, o leitor retorna automaticamente para permitir novo registro.
- Mostrar confirmação somente após resposta positiva do Supabase.
- Em erro, exibir mensagem útil e preservar os dados preenchidos.
- Impedir submissão duplicada enquanto a requisição estiver em andamento.
- Mostrar claramente usuário autenticado e loja ativa, conforme layout existente.

## Funcionalidades e permissões — decisões confirmadas

| Funcionalidade | Regra |
|---|---|
| Consulta | Operador visualiza **todos os registros da loja em que está cadastrado**, independentemente de quem os registrou. |
| Meus Registros | Operador pode editar **somente os registros criados por ele**. |
| Histórico | Histórico **pessoal** do Operador, referente às suas próprias ações/registros. |
| Solicitação de exclusão | Aprovação por **Gerente ou Administrador**. |
| Após cadastro | Retornar automaticamente ao leitor para novo registro. |
| Alertas de vencimento | Operador poderá configurar alertas de validade e horários preferidos para recebê-los; detalhes a definir em conjunto. |

A consulta ampla da loja não concede permissão de edição sobre registros de terceiros. A autorização de edição deve ser validada no backend/Supabase, não apenas escondendo controles na interface.

## Registro de produtos

### Industrializados / convencionais
- Localizar produto por EAN, leitor ou pesquisa manual.
- Registrar lote, quantidade, validade e setor.
- O setor é obrigatório.

### Perecíveis
- Registrar descrição/código, SIF quando aplicável, peso, validade e setor.
- O setor é obrigatório.

### Setores oficiais
Lista definida pelo usuário:
1. Açougue
2. Laticínios
3. Padaria
4. Salgados
5. FLV
6. Mercearia

- Setor deve ser selecionado em lista, sem digitação livre.
- Não adicionar setores fora da lista sem autorização.
- O filtro de setor na consulta deve usar os mesmos valores usados no registro.

## Back-end / Supabase

- Autenticação obrigatória e sessão JWT.
- Validar no banco papel, usuário e loja autorizada; não confiar apenas no front-end.
- Todas as operações de estoque devem estar vinculadas a `loja_id`.
- RLS deve impedir leitura/escrita em lojas não autorizadas.
- O catálogo compartilhado (`catalogo`) não deve ser confundido com estoque por loja (`produtos`, `lotes`).
- Setor deve ser persistido de forma consistente e validado no backend. Preferir referência normalizada, caso exista no schema.
- Registrar autoria e timestamps.
- Nunca usar `service_role` no cliente.
- Considerar RPC transacional para inserir/associar produto e lote atomicamente, evitando gravação parcial.
- Erros devem retornar mensagens/códigos claros; a UI só confirma após commit.
- Consulta da loja pode ser ampla, mas edição deve restringir-se aos registros criados pelo Operador autenticado.

## Solicitação de exclusão — regra confirmada, detalhes a definir

- Operador não deve excluir fisicamente registros diretamente.
- Deve enviar solicitação de exclusão/cancelamento com justificativa obrigatória.
- A solicitação pode ser aprovada por Gerente **ou** Administrador.
- Recomenda-se cancelamento lógico com trilha de auditoria, preservando histórico.
- Definir posteriormente estados (pendente/aprovada/rejeitada/cancelada), notificações e tratamento após aprovação.

## Histórico pessoal

- Exibir as ações/registros associados ao Operador autenticado.
- Histórico deve ser persistido no backend; não usar localStorage como fonte de auditoria.
- Idealmente registrar usuário, data/hora, ação, valores anteriores e posteriores e justificativa, quando aplicável.
- A consulta geral da loja não deve ampliar automaticamente o escopo do histórico pessoal.

## Ajustes e alertas de vencimento — em discussão

### Requisito confirmado
- Operador poderá configurar alertas para ser avisado quando produtos/lotes estiverem próximos do vencimento.
- Operador escolhe os critérios de antecedência e os horários preferidos para receber as notificações.
- Investigar integração com agenda/calendário do celular e envio de mensagens por WhatsApp.

### Proposta inicial para discussão (não aprovada)
- Configurar antecedência do alerta por intervalos, por exemplo: 7, 3 e 1 dia antes do vencimento, ou personalizar os dias.
- Configurar horários de entrega (por exemplo, início do turno e/ou outro horário escolhido).
- Escolher dias da semana e canal de notificação.
- Permitir ativar/desativar cada canal.
- Alertas devem incluir produto, lote/código, setor, validade e loja, respeitando acesso autorizado.
- Evitar alertas duplicados para o mesmo item, regra e período; permitir marcar como lido.
- O Operador pode consultar e alterar suas próprias preferências.

### Canais e limitações a avaliar
- **Notificação dentro do sistema:** canal básico, vinculado à conta do Operador.
- **Notificação push:** possível, mas exige suporte de notificações do navegador/app, permissão do dispositivo e infraestrutura de envio.
- **Agenda/calendário do celular:** possível avaliar exportação/integração (ex.: evento ou arquivo de calendário). A sincronização automática depende do sistema operacional e permissões; não presumir que o site possa escrever diretamente em qualquer agenda.
- **WhatsApp:** possível somente por integração oficial/serviço autorizado (ex.: WhatsApp Business Platform ou provedor). Exige número confirmado, consentimento, configuração de templates quando aplicável, credenciais seguras e custos/limites do fornecedor. Não prometer envio direto pelo front-end nem usar automação não oficial.
- Preferências do Operador devem ser armazenadas de forma segura; agendamento e envio de notificações precisam ocorrer em backend/serviço confiável, não depender de a tela estar aberta.
- O mecanismo de alerta deve consultar validade no banco, usar timezone adequado (loja/usuário) e registrar status de entrega/falha.

### Decisões ainda necessárias
1. Quais antecedências padrão? (ex.: 7, 3 e 1 dia, configuráveis, ou escolha livre).
2. Operador configura alertas para todos os produtos da loja ou apenas setores/itens selecionados?
3. Horário de envio: um horário diário, múltiplos horários ou horário por alerta?
4. Dias da semana: todos os dias ou apenas dias selecionados?
5. Canais desejados na primeira versão: notificação dentro do sistema, push, calendário, WhatsApp?
6. Alertas são individuais por Operador ou devem seguir também configurações gerais da loja?
7. O WhatsApp será um recurso futuro (fase 2), após validação de custos e requisitos oficiais?

## Fluxo de registro

1. A área do Operador abre no leitor de código.
2. Operador escolhe Industrializados ou Perecíveis.
3. Identifica/busca o produto ou perecível.
4. Preenche dados obrigatórios e seleciona setor oficial.
5. Front-end valida campos e envia requisição autenticada.
6. Supabase valida sessão, loja, papel e permissões.
7. Banco confirma a transação.
8. UI exibe sucesso e retorna automaticamente ao leitor.
9. Em falha, UI mostra erro e preserva os campos para correção/reenvio; não confirma registro.

## Critérios de aceite

- Operador consulta todos os registros da própria loja, mas não de outras lojas.
- Operador só edita registros criados por ele; backend rejeita tentativa de editar registro de outro usuário.
- Histórico pessoal não inclui ações de terceiros.
- Solicitação de exclusão requer justificativa e pode ser aprovada por Gerente ou Administrador.
- Registro só é considerado salvo após confirmação do PostgreSQL.
- Requisições repetidas não geram duplicidade silenciosa.
- Erros de validação, RLS, rede e conflito são distinguíveis.
- UI não depende de localStorage para confirmar registros.
- Setor é obrigatório em ambos os fluxos e só aceita os seis valores oficiais.
- Após salvar, o leitor retorna automaticamente.
- Layout existente é preservado; nenhuma tela inicial alternativa é criada.
- Alertas respeitam preferências do Operador, não duplicam indevidamente e são enviados por serviço confiável mesmo quando o usuário não está com a tela aberta.
- Nenhuma alteração de comportamento dos outros perfis nesta etapa.

## Fora do escopo desta definição

- Implementação de código de produção.
- Alterações nas áreas Assistente, Analista, Gerente ou Administrador.
- Alterações ou execução de migrations no Supabase.
- Mudanças de layout sem autorização.
