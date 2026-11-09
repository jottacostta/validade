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

## Área Supervisor

**Conceitual, sujeito a confirmação de permissões e features reais. Não criar funcionalidades a partir da imagem.**

### Painel
Header e filial; indicadores somente se dados/queries já existirem; cards compactos; atalhos para pendências e relatórios que realmente existam.

### Equipe
Lista apenas de colaboradores visíveis ao perfil, dados autorizados e atividade existente. Não criar ranking, scoring ou avaliação de desempenho sem requisito aprovado.

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

As imagens geradas para Operador, Supervisor e Administrador são **referências de composição/estética**. Elas contêm textos e dados ilustrativos (ex.: números, nomes, filial e contagens); esses valores não devem ser copiados como dados reais. Implementar layout e conteúdo real do sistema, não reproduzir dados fictícios.

