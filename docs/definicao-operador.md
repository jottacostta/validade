# Definição funcional — Área do Operador

**Status:** definição funcional em andamento. O usuário autorizou a redefinição do front-end, com a Área do Operador como referência visual. A especificação está em docs/layout-area-operador.md e a implementação incremental na PR #29. Esta autorização não abrange migrations nem alterações de produção.

## Objetivo

Definir o comportamento da área Operador. A nova direção visual é o design Guanabara aprovado: dashboard Início, navegação inferior persistente e fluxo de registro em telas internas. A Área do Operador será a base do design system das demais áreas. Supabase/PostgreSQL continua como fonte oficial dos dados.

## Tela inicial e navegação — redefinição visual aprovada

- A área do Operador inicia no dashboard Início conforme mockup aprovado.
- Dashboard: saudação, loja/filial, sino de notificações, CTA Registrar produto, atalhos Meus registros/Alertas e últimos registros.
- Navegação inferior: Início, Produtos, Perecíveis, Alertas e Ajustes.
- CTA Registrar produto abre a escolha Industrializado/Perecível; a câmera só inicia após ação explícita.
- Após commit confirmado pelo Supabase, exibir tela de confirmação com resumo do registro.
- A confirmação oferece Novo registro (retorna à escolha de tipo) e Ver meus registros. Não retornar automaticamente ao scanner.
- Mostrar sucesso somente após resposta positiva do Supabase; em erro preservar os campos e impedir submissão duplicada.
- Mostrar usuário autenticado, papel e loja ativa.
- Seguir docs/layout-area-operador.md; dados do mockup são ilustrativos.

## Funcionalidades e permissões — decisões confirmadas

| Funcionalidade | Regra |
|---|---|
| Consulta | Operador visualiza **todos os registros da loja em que está cadastrado**, independentemente de quem os registrou. |
| Meus Registros | Operador pode editar **somente os registros criados por ele**. |
| Histórico | Histórico **pessoal** do Operador, referente às suas próprias ações/registros. |
| Solicitação de exclusão | Aprovação por **Gerente ou Administrador**. |
| Após cadastro | Mostrar confirmação; usuário escolhe novo registro ou consultar registros. |
| Alertas de vencimento | Operador configura antecedência e horários; push e notificações internas são canais candidatos, e calendário será avaliado quando tecnicamente possível. Disponibilidade, dependências e custos operacionais precisam ser confirmados; WhatsApp está excluído. |

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

## Pontos a detalhar antes da implementação

Os requisitos abaixo ainda não especificam decisões suficientes para implementação. Devem ser confirmados sem alterar as regras já declaradas como confirmadas:

- **Sequência de navegação:** dashboard e escolha de tipo estão definidos visualmente; permissões da câmera, scanner e fallback manual seguem requisitos técnicos e acessibilidade.
- **Vínculo do setor:** confirmar se o setor pertence a cada lote/registro, ao produto ou a outra entidade. A escolha deve permitir que o mesmo produto tenha lotes em setores diferentes, se esse for o comportamento desejado.
- **Autoria e registros existentes:** usar a identidade autenticada estável do backend para determinar autoria, e não um nome de usuário editável. Definir como tratar registros antigos sem autoria e como preservar valores anteriores em auditoria.
- **Duplicidade e reenvio:** distinguir repetição técnica da mesma requisição (por exemplo, retry após timeout) de um novo registro legítimo. Definir a chave de idempotência e as regras de unicidade do negócio sem bloquear lotes distintos.
- **Aprovação de exclusão:** detalhar transições de estado, notificações, cancelamento da solicitação e prevenção de autoaprovação, mantendo a aprovação por Gerente ou Administrador.
- **Alertas:** definir comportamento quando push não for suportado ou autorizado, disponibilidade das notificações internas, dependências de calendário e custos de infraestrutura/serviços antes de assumir compromisso de custo.

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

## Ajustes e alertas de vencimento — requisitos confirmados

### Canais considerados inicialmente — WhatsApp excluído
- **Push notifications** para o celular, por Web Push/PWA, sujeito a suporte do navegador/SO e permissão do usuário.
- **Notificações dentro do Validade** (central de notificações).
- **Calendário/agenda do celular**, a ser avaliado como integração ou exportação de eventos. Não prometer sincronização automática universal.

**WhatsApp está excluído**: não implementar, não integrar e não incorrer em custos de WhatsApp.

### Preferências do Operador
- Definir quantos dias antes da validade deseja ser avisado (intervalos sugeridos: 7, 3 e 1 dia, mas o padrão ainda precisa ser confirmado).
- Escolher horários de entrega das notificações.
- Escolher dias da semana, se aplicável.
- Selecionar setores ou itens monitorados, ou todos os setores.
- Ativar/desativar canais individualmente.
- Consultar e alterar preferências próprias.
- Confirmar disponibilidade por plataforma, dependências e custos operacionais; não prometer que push, central interna ou calendário terão custo zero.

### Requisitos técnicos
- Push requer suporte PWA/Service Worker, Web Push e permissão do dispositivo; confirmar no repositório se a infraestrutura já existe.
- Agendamento e envio devem ocorrer em backend/serviço confiável, não depender de a tela estar aberta.
- Preferências devem estar associadas ao usuário autenticado e loja.
- Alertas consultam validade no banco, usam timezone apropriado e registram status de envio/falha.
- Evitar notificações duplicadas para o mesmo lote, regra e janela de alerta.
- Notificações devem incluir produto, lote/código, setor, validade e loja, respeitando autorização.
- O calendário pode exigir ação do usuário (adicionar evento/arquivo .ics); não assumir que o Web App pode gravar diretamente na agenda nativa em todos os dispositivos.

### Decisões ainda pendentes
1. Antecedências padrão: 7/3/1 dias ou personalização livre?
2. Alertas para todos os setores ou somente setores selecionados?
3. Um horário diário ou múltiplos horários configuráveis?
4. Todos os dias ou dias da semana selecionados?
5. Preferências pessoais do Operador ou também regras padrão definidas pela loja?
6. Calendário: evento por lote ou resumo diário de vencimentos?

## Fluxo de registro

1. Operador entra no dashboard Início.
2. Aciona Registrar produto e escolhe Industrializado ou Perecível.
3. Identifica/busca produto por scanner ou entrada manual.
4. Preenche dados obrigatórios e seleciona setor oficial.
5. Front-end valida e envia requisição autenticada.
6. Supabase valida sessão, loja, papel e permissões.
7. Banco confirma a transação.
8. UI exibe confirmação com resumo e ações Novo registro / Ver meus registros.
9. Em falha, UI preserva os campos para correção/reenvio; não confirma registro.

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
- Após salvar, exibir confirmação; o usuário escolhe novo registro ou consulta.
- Dashboard, navegação e estilo seguem mockup Guanabara aprovado e docs/layout-area-operador.md.
- Alertas respeitam preferências, não duplicam indevidamente e são enviados por serviço confiável quando o usuário não está com a tela aberta.
- WhatsApp não faz parte do escopo.
- Nenhuma alteração de comportamento dos outros perfis nesta etapa.

## Fora do escopo desta definição

- Implementação de código de produção.
- Alterações nas áreas Assistente, Analista, Gerente ou Administrador.
- Alterações ou execução de migrations no Supabase.
- Mudanças de layout sem autorização.


## Instruções obrigatórias para agentes de IA — continuidade do projeto

Esta seção é um handoff operacional para qualquer agente de IA que assumir a implementação ou revisão desta área. Ela complementa os requisitos funcionais acima; não substitui as regras do repositório.

### Antes de iniciar qualquer trabalho
1. Leia integralmente este documento (`docs/definicao-operador.md`).
2. Leia `AGENTS.md`, `README.md` e demais instruções/documentação aplicáveis no repositório. Se houver instruções específicas em diretórios, respeite também essas instruções.
3. Examine a implementação atual, arquitetura, componentes, rotas, autenticação, schema Supabase, políticas RLS, migrations e testes relevantes antes de propor ou alterar código.
4. Identifique o comportamento existente e a causa do problema antes de modificar algo. Não presuma que uma implementação está ausente apenas porque não foi localizada superficialmente.
5. Diferencie explicitamente: requisito confirmado, decisão pendente, hipótese técnica e comportamento já existente.

### Restrições de escopo
- Siga o layout Guanabara aprovado em docs/layout-area-operador.md e PR #29. O usuário autorizou redesign do front-end; não altere regras de negócio, permissões ou backend por inferência.
- Trabalhe somente na área Operador, salvo autorização explícita para outras áreas/perfis.
- Não altere regras de negócio, permissões, setores oficiais ou fluxos definidos neste documento sem autorização.
- Não invente requisitos para decisões pendentes. Quando uma decisão funcional for necessária, registre a pergunta e solicite confirmação.
- Não implemente WhatsApp.
- Não execute migrations, alterações de schema, políticas RLS ou mudanças de dados em produção sem autorização expressa. Para mudanças de banco, apresente antes o plano, impacto e ambiente alvo.
- Nunca exponha credenciais, tokens, chaves privadas ou `service_role` no frontend, commits, logs ou documentação.

### Processo de desenvolvimento
1. Explique brevemente o diagnóstico e o escopo proposto antes de alterações relevantes.
2. Faça mudanças pequenas, isoladas e rastreáveis; evite refatorações não relacionadas.
3. Crie/atualize testes para os comportamentos afetados, incluindo autorização, isolamento por loja, autoria, validação e erros quando aplicável.
4. Execute os testes documentados no repositório e as verificações pertinentes (lint, build, testes automatizados e CI). Não declare testes aprovados sem executar e observar o resultado.
5. Corrija falhas introduzidas ou relacionadas antes de considerar o trabalho concluído. Não ignore falhas de CI nem desative testes para obter aprovação.
6. Abra ou atualize uma PR para revisão. Não faça merge até que os checks exigidos estejam verdes e haja autorização explícita do usuário para merge.
7. Não encerre acompanhamento enquanto houver checks, workflows ou testes relevantes em execução, salvo se o usuário pedir para parar.

### Entrega e registro
Ao concluir cada etapa, informe:
- diagnóstico e causa identificada;
- arquivos alterados e resumo objetivo;
- decisões tomadas e decisões ainda pendentes;
- testes executados e resultado real (incluindo falhas ou limitações);
- PR/commit relacionado;
- riscos, dependências e próximo passo recomendado.

Atualize a documentação quando uma decisão funcional for confirmada ou quando a implementação divergir do comportamento documentado. Não registre hipótese como decisão aprovada.

### Checklist de continuidade
- [ ] Ler este documento e as instruções do repositório.
- [ ] Inspecionar implementação atual antes de editar.
- [ ] Confirmar que o trabalho está dentro do escopo autorizado.
- [ ] Não inventar nem alterar requisitos pendentes.
- [ ] Validar autenticação, loja, papel e autoria no backend quando aplicável.
- [ ] Testar casos positivos, negativos e de erro relevantes.
- [ ] Executar testes/build/CI e registrar resultados.
- [ ] Abrir/atualizar PR; aguardar checks e autorização antes do merge.
- [ ] Documentar mudanças, limitações e pendências.
