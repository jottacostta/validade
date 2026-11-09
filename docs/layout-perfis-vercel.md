# Layout por perfil — Controle de Validade Guanabara

**Handoff de UI para Vercel** · **Proposta visual, não implementação** · Mobile-first (Android)

## Escopo e coordenação

Esta PR é exclusivamente documental. A implementação visual deverá ser feita em uma PR própria depois de validar o plano.

- PR #22 (Manus) é responsável pela implementação funcional da Área do Operador. Não editar sua branch, cherry-pick, rebase ou alterar seus arquivos sem alinhamento.
- PR #19 define regras funcionais do Operador e declara que não autoriza alterações de layout. Esta especificação visual é separada; não modifica nem substitui suas decisões.
- Não alterar regras de negócio, autenticação, RLS, Supabase, migrations, Edge Functions ou dados.
- Não fazer merge ou deploy sem autorização.
- Se mockup conflitar com requisito confirmado, prevalece o requisito; registrar divergência e solicitar decisão.

## Direção de arte

Manter identidade Guanabara existente: logo sem deformação, cabeçalho azul com detalhe amarelo, dark mode, azul de ação, cards arredondados e tipografia clara. Não trocar os ícones/logo existentes sem aprovação.

Paleta de referência (auditar tokens existentes antes de introduzir):
- Fundo: `#0E151D`
- Superfície/card: `#182631`
- Superfície secundária: `#111D28`
- Borda: `#293846`
- Azul primário: `#0B4A91`
- Azul vivo: `#0877D9`
- Amarelo Guanabara: `#F7D900`
- Texto principal: `#F3F6FA`
- Texto secundário: `#A2B0BE`
- Sucesso: `#16A34A`; alerta: `#EAA21A`; erro: `#DC2626`

Referência de qualidade: hierarquia clara, botões com área de toque confortável, contraste acessível, espaçamento consistente (escala de 4/8px), sem cards altos ou conteúdo apertado. A paleta é uma referência, não ordem para substituir o CSS atual indiscriminadamente.

## Shell comum

### Header
Logo Guanabara + “Controle de Validade” + subtítulo atual; loja e usuário apenas se esses dados estiverem disponíveis/autorizados. Header compacto no celular e logo preservada em proporção.

### Navegação
Ícone + rótulo; estado ativo claro; adaptar itens ao perfil e às rotas/permissões reais. Respeitar safe-area do Android, não cobrir CTA, teclado ou conteúdo. O outline de foco acessível não deve virar decoração permanente. Não criar rotas fictícias.

## Área Operador

### Tela inicial
Ordem:
1. Header, loja e operador (dados reais).
2. Saudação curta.
3. CTA dominante “Registrar produto” (ícone scanner; subtexto “Escanear código ou etiqueta”).
4. Atalhos “Meus registros” e “Alertas” se existirem no fluxo autorizado.
5. Lista curta de registros recentes, apenas se permitido e suportado.

Sem dashboards gerenciais ou números fictícios. Foco: ação diária.

### Registro
Título → tipo Industrializado/Perecível conforme fluxo atual → scanner → busca manual → produto identificado → campos atuais (lote, validade, quantidade/peso, setor etc.) → CTA salvar.

Scanner é dominante, mas busca manual sempre acessível. Campos obrigatórios evidentes; teclado numérico quando adequado; CTA acessível com teclado aberto. Não inventar/remover campos. Desabilitar submissão duplicada. Manter dados em erro. Sucesso só após confirmação real do backend.

### Confirmação
Após commit confirmado, mostrar sucesso e resumo real do produto/lote/validade/quantidade/setor. Ações “Novo registro” e consulta, se disponíveis. Em erro, mensagem útil, preservar formulário e permitir retry.

### Meus registros
Busca e filtros compactos; cards priorizam nome do produto e validade, depois lote, quantidade, setor e data. Status com texto + cor. Respeitar regras de autoria e escopo; UI não substitui RLS. Não oferecer edição/exclusão se não permitido.

### Alertas
Lista acionável com produto, lote, validade e contexto; vencido vermelho, próximo âmbar, normal neutro/verde, sempre acompanhados por texto/ícone. Não prometer push, calendário ou integração não implementada.

## Área Analista

**Conceitual, sujeito a confirmação de permissões e funcionalidades reais. Não criar funcionalidades a partir da imagem.**

### Painel
Header e filial; indicadores somente se dados/queries já existirem; cards compactos; atalhos para pendências e relatórios que realmente existam.

### Análise operacional
- Visão analítica de registros, lotes, validade e alertas existentes, conforme permissões e consultas aprovadas.
- Busca, filtros e agrupamentos apenas por dimensões suportadas (ex.: período, setor, status ou loja).
- Tabelas compactas com ordenação e paginação quando necessárias; no celular, cards legíveis.
- Indicadores e comparações devem vir de dados reais e critérios documentados.
- Não criar ranking, scoring ou avaliação de desempenho de colaboradores sem requisito aprovado.

### Solicitações
Estados pendente/aprovada/recusada somente se o backend suportar. Card com produto/lote/solicitante/data/motivo/status. Aprovar/recusar só com permissão; confirmação e justificativa conforme regra. Mostrar resultado apenas após resposta do servidor.

### Relatórios
Somente relatórios existentes; filtros e exportações suportados. Evitar gráficos densos em celular.

## Área Administrador

**Conceitual e limitada às funcionalidades e permissões já existentes.**

### Painel
Indicadores reais e atalhos administrativos existentes; densidade maior que Operador, sem excesso.

### Usuários/permissões
Lista de usuários, perfil e loja quando autorizados. Backend é a autoridade; esconder botão no frontend não é segurança.

### Cadastros
Agrupar cadastros já existentes (setores, produtos, fornecedores/categorias apenas se aplicável). Reutilizar formulários e entidades atuais.

### Relatórios
Relatórios reais, filtros suportados e exportações implementadas. Respeitar escopo por loja.


## Área do Assistente (IA)

**Objetivo:** oferecer uma experiência conversacional para orientar o usuário dentro do Controle de Validade, sem substituir telas, permissões, regras ou decisões humanas.

> A interface é uma proposta. Antes de implementar, confirmar se o assistente, suas fontes de dados, ações e permissões já estão aprovados e disponíveis. Não simular respostas com dados reais nem inventar integração/IA.

### Tela principal
- Header compacto “Assistente” e identificação do perfil/loja quando autorizada.
- Mensagem inicial curta e contextual.
- Área central de conversa com mensagens do usuário e do assistente claramente diferenciadas.
- Composer fixo na parte inferior, acima da safe area e do teclado.
- Campo de texto multilinha, botão enviar e indicador de processamento.
- Sugestões de perguntas rápidas apenas se forem suportadas (ex.: “Como registrar um produto?”, “Quais são meus alertas?”).

### Aparência da conversa
- Mensagens do usuário alinhadas à direita; assistente à esquerda.
- Cards/respostas com contraste e largura confortável para leitura.
- Respostas longas com títulos, listas e etapas.
- Links/botões de ação devem ser explícitos e nunca executar ações críticas sem confirmação.
- Estados: inicial, enviando, resposta, erro, sem conexão e limite/indisponibilidade.
- Permitir copiar resposta e iniciar nova conversa se esses recursos estiverem disponíveis.

### Contexto e segurança
- O assistente só pode consultar informações que o usuário atual tem permissão para ver.
- Respeitar filial, perfil, autoria e políticas do backend.
- Não expor dados de outros usuários/lojas.
- Não permitir que instruções conversacionais contornem autorização, validação ou RLS.
- Se não souber ou não tiver acesso, declarar isso e orientar o caminho correto; não inventar informação.
- Ações que alterem registros devem exigir confirmação explícita e usar APIs autorizadas; não executar apenas por texto sem confirmação.
- Mostrar quando a resposta depende de dados atualizados ou de uma consulta real, se aplicável.

### Mobile
- Composer permanece acessível com teclado aberto.
- Mensagens não ficam escondidas atrás da navegação.
- Scroll automático somente quando apropriado, sem interromper leitura de mensagens antigas.
- Botão de enviar acessível por toque; evitar ícones pequenos.

## Área do Gerente

**Objetivo:** oferecer visão gerencial da loja, com foco em situação, prioridades e acompanhamento. Esta área deve ser distinta do Analista (análise detalhada) e do Administrador (configuração e gestão de acesso).

> Os indicadores e ações abaixo são candidatos de layout, não métricas ou permissões confirmadas. Antes de construir, validar requisitos, consultas, escopo de loja e acesso do perfil Gerente. Não adicionar dados ou KPIs fictícios.

### Painel gerencial
- Header com “Visão Gerencial”, loja e usuário, conforme dados autorizados.
- Filtros de período/área somente se suportados.
- Cards de indicadores reais e aprovados, por exemplo: produtos/lotes monitorados, vencidos, próximos do vencimento e pendências abertas.
- Destaque visual para exceções que demandam ação.
- Tendência/gráfico somente se houver histórico confiável; preferir cards/listas no mobile.

### Prioridades e acompanhamento
- Lista ordenada por criticidade (critério funcional aprovado), com produto/lote, setor, prazo/status e ação disponível.
- Separar “Atenção imediata”, “Acompanhar” e “Situação regular” apenas se as regras atuais suportarem.
- Exibir origem/atualização dos dados quando necessário.
- Evitar ranking individual de funcionários ou métricas de produtividade sem requisito e aprovação.

### Relatórios gerenciais
- Acesso a relatórios autorizados.
- Filtros por período, setor e loja apenas quando backend suportar.
- Exportações somente se implementadas e permitidas.
- Respeitar isolamento por filial e permissões do gerente.

### Ações
- A interface deve priorizar consulta e acompanhamento.
- Aprovação, exclusão, alteração de cadastro ou outras ações de impacto só aparecem quando autorizadas por requisito e backend.
- Confirmar ações importantes e exibir resultado somente após resposta do servidor.

### Diferença entre perfis
- **Operador:** executa registro e consulta seu trabalho.
- **Analista:** examina dados operacionais, filtros, tendências e relatórios autorizados.
- **Gerente:** acompanha indicadores, riscos e prioridades da loja.
- **Administrador:** administra estrutura, usuários, permissões e configurações do sistema.
- **Assistente:** interface conversacional de apoio; não é um perfil que concede acesso adicional.

## Componentes reutilizáveis

Auditar e reaproveitar: Header, bottom navigation, botões primário/secundário, action cards, KPI cards, product/lot cards, alert cards, search, filter chips, badges, modal, toast, loading/skeleton, empty/error states.

Componentes equivalentes devem compartilhar tokens, espaçamento, radius, tipografia e estados. Evitar duplicação de CSS/markup.

## Responsividade e acessibilidade

- Prioridade: Android/smartphones pequenos; depois tablets e desktop.
- Sem overflow horizontal.
- Botões e campos com alvo de toque confortável.
- Cards não devem ficar infinitamente largos no desktop.
- Navegação respeita safe areas.
- Teclado não oculta ação principal.
- Contraste adequado, foco visível, labels acessíveis.
- Estado não comunicado só por cor.
- Empty/loading/error/success/offline/permission-denied quando aplicável.
- Não mostrar sucesso antes do backend confirmar.

## Processo obrigatório para Vercel/agente

1. Ler README, AGENTS.md e documentação funcional.
2. Inspecionar app atual, CSS, componentes, rotas, autenticação e permissões.
3. Revisar PRs abertas (#19 e #22) e seus diffs antes de tocar em arquivos.
4. Comparar screenshots atuais com mockups e mapear componentes existentes.
5. Apresentar plano e lista de arquivos a modificar.
6. Implementar por etapas pequenas, sem mudanças funcionais não autorizadas.
7. Rodar build, testes e `git diff --check`; validar Android e desktop.
8. Gerar Preview e screenshots para revisão.
9. Abrir PR separada; não mergear/deployar sem autorização.

## Critérios de aceite visual

- Identidade Guanabara e logo preservadas.
- Hierarquia de cada perfil clara.
- Layout utilizável em Android pequeno.
- Nenhum overflow ou sobreposição com navegação/teclado.
- Cards e botões alinhados e consistentes.
- Estados loading/error/empty/success tratados.
- Funcionalidades existentes não regressam.
- Nenhuma regra/permissão/backend alterada por iniciativa própria.
- Preview validado pelo usuário antes do merge.

## Mockups

As imagens geradas para Operador, Assistente, Analista, Gerente e Administrador são **referências de composição/estética**. Elas contêm textos e dados ilustrativos (ex.: números, nomes, filial e contagens); esses valores não devem ser copiados como dados reais. Implementar layout e conteúdo real do sistema, não reproduzir dados fictícios.

