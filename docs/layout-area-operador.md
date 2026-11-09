# Especificação visual — Área do Operador

**Status:** documentação de layout / referência visual.  
**Escopo:** Área do Operador do aplicativo Controle de Validade (Supermercados Guanabara).  
**Base visual:** mockups aprovados nesta conversa.  
**Não é autorização para alterar banco, regras de negócio, RLS, autenticação ou outras áreas/perfis.**

## 1. Objetivo

Documentar a composição, hierarquia visual, navegação, componentes, estados e comportamento esperado das telas do Operador para que a implementação seja reproduzível e consistente, sem interpretações arbitrárias.

A implementação deve priorizar uso em celular, operação rápida no ambiente de loja, botões grandes e legíveis, contraste e prevenção de erros.

## 2. Identidade visual

### 2.1 Direção de arte

- Identidade Supermercados Guanabara.
- Cabeçalho azul corporativo com logo Guanabara, título da tela e identificação “Área do Operador”.
- Faixa amarela horizontal separando cabeçalho e conteúdo.
- Fundo azul-marinho/azul muito escuro.
- Cards com fundo azul profundo, bordas arredondadas e contorno azul/ciano discreto.
- Botões primários em azul vivo; amarelo reservado a destaques/seleção; vermelho para vencido/erro; âmbar para atenção; verde para situação válida/sucesso.
- Tipografia sans-serif, títulos fortes e hierarquia clara.
- Ícones acompanhados por rótulos. Não comunicar estado somente pela cor.
- Evitar brilho/glow excessivo na implementação: o mockup é uma referência de composição, não licença para sacrificar legibilidade ou desempenho.

### 2.2 Tokens de referência

Valores aproximados, ajustar ao design system já existente sem quebrar a identidade:

| Token | Referência |
|---|---|
| Fundo principal | azul-marinho quase preto |
| Superfície/card | azul-marinho médio |
| Primária | azul Guanabara vivo |
| Destaque | amarelo Guanabara |
| Texto principal | branco |
| Texto secundário | azul acinzentado claro |
| Sucesso | verde |
| Atenção | âmbar/amarelo |
| Erro/vencido | vermelho |
| Borda | azul/ciano discreto |
| Raio de card | 16–22 px |
| Área mínima de toque | 44 × 44 px; preferível 48 px ou mais |
| Espaçamento | escala consistente de 4/8/12/16/24 px |

As cores e medidas finais devem ser centralizadas em tokens CSS, não espalhadas por estilos isolados.

## 3. Estrutura global

### 3.1 Cabeçalho

- Logo Guanabara.
- Nome do aplicativo: **Controle de Validade**.
- Subtítulo da tela atual.
- Selo amarelo “Área do Operador”.
- Seta voltar nas telas internas.
- Faixa amarela inferior.
- O cabeçalho pode reduzir altura em telas pequenas, sem cortar logo, título ou navegação.

### 3.2 Navegação inferior

Barra persistente com cinco destinos:

1. **Início**
2. **Produtos**
3. **Perecíveis**
4. **Alertas**
5. **Ajustes**

Regras:
- Mostrar ícone e rótulo.
- Destino atual destacado em azul; indicador amarelo inferior.
- Alertas pode exibir badge de quantidade não lida.
- A barra deve respeitar safe areas e não cobrir conteúdo ou botões.
- Conteúdo rolável deve ter padding inferior equivalente à altura da barra.
- Em telas internas, manter a navegação consistente, salvo quando câmera/fluxo exigir uma experiência temporária claramente definida.

### 3.3 Responsividade

- Mobile-first, com referência principal de celular portrait.
- Cards em uma coluna no celular.
- Em tablets, permitir ampliar largura e usar grids somente quando isso melhorar a leitura.
- Não fixar dimensões absolutas que provoquem corte em aparelhos menores.
- Cabeçalho, barra inferior, teclado virtual e área segura devem ser considerados.
- Formulários devem permanecer acessíveis com teclado aberto.
- Listas longas usam scroll; não comprimir texto para caber.

## 4. Telas e fluxos

## 4.1 Início — Dashboard do Operador

**Composição**
1. Cabeçalho Guanabara / Área do Operador.
2. Card de saudação: avatar, “Olá, Operador!”, nome quando disponível e filial.
3. Ícone de notificações com badge.
4. Título “O que deseja fazer?”.
5. CTA principal grande: **Registrar produto — Escanear código ou etiqueta**.
6. Cards secundários:
   - **Meus registros** — consultar registros.
   - **Alertas** — vencidos e próximos do vencimento.
7. Card “Últimos registros” com “Ver todos”.
8. Itens resumidos com produto, lote, validade e estado.
9. Navegação inferior com Início selecionado.

**Interações**
- CTA abre fluxo de registro.
- Meus registros abre lista de registros.
- Alertas abre central de alertas.
- “Ver todos” abre Produtos/Registros.
- Sino abre notificações.

**Atenção — divergência de requisito:** a PR #19/documentação funcional anterior descreve entrada direta no leitor, sem dashboard alternativo. O mockup de Início aprovado nesta conversa apresenta dashboard. Esta divergência precisa ser reconciliada antes da implementação; não apagar silenciosamente uma das decisões.

## 4.2 Registrar produto — escolha do tipo

- Seletor visual: **Industrializado** e **Perecível**.
- CTA de leitura de código/etiqueta.
- Campo manual para EAN/código e botão Buscar.
- Estados de câmera/permissão e fallback manual.
- O tipo selecionado deve permanecer evidente.

## 4.3 Leitura de código de barras / etiqueta

- Área de scanner ampla e central.
- Instrução curta para posicionar código/etiqueta.
- Alternativa de digitação manual.
- Botão de voltar/cancelar.
- Estados: aguardando câmera, permissão negada, leitura concluída, código inválido, falha de leitura.
- Não bloquear o fluxo: busca manual deve continuar disponível.
- Para etiqueta de balança, apresentar os campos de configuração existentes e a leitura OCR somente se já suportada no produto; não inventar processamento no front-end.

## 4.4 Formulário de registro — industrializado

- Tipo de registro visível.
- Produto identificado (nome e EAN/código).
- Lote obrigatório.
- Validade obrigatória.
- Quantidade obrigatória.
- Setor obrigatório, em lista oficial (sem texto livre).
- Botão principal **Salvar registro**.
- Botão secundário para cancelar/voltar.
- Erros inline junto ao campo.
- Durante envio, bloquear repetição do submit e mostrar estado de carregamento.
- Só apresentar sucesso após confirmação do backend/Supabase.
- Em erro, preservar os campos preenchidos.

## 4.5 Formulário de registro — perecível

- Identificação/descrição do perecível.
- Código/SIF quando aplicável ao processo existente.
- Peso/quantidade conforme regra já existente.
- Lote e validade quando aplicáveis.
- Setor obrigatório na lista oficial.
- **Não solicitar nem exibir temperatura:** operador não terá termômetro disponível durante a rotina.
- Não criar campos obrigatórios que não foram definidos no processo.

## 4.6 Confirmação de registro

- Ícone de sucesso.
- Texto “Registro salvo com sucesso”.
- Resumo: produto, código, lote, validade, quantidade e setor.
- Botões:
  - **Novo registro**
  - **Ver meus registros**
- Não declarar sucesso antes da confirmação do backend.
- Fluxo de retorno automático ao leitor após sucesso é mencionado na especificação funcional anterior; conciliar com esta tela de confirmação e definir se ela será transitória ou permanecerá visível.

## 4.7 Produtos — Meus registros

- Busca por produto, código/EAN ou lote.
- Filtros por período, setor e situação.
- Indicadores de resumo, quando dados disponíveis: total, válidos, próximos do vencimento e vencidos.
- Lista de cards com nome, EAN, lote, setor, validade, quantidade e badge de estado.
- Toque no card abre detalhe.
- A lista deve paginar ou carregar progressivamente.
- Operador pode consultar registros da loja, mas **editar apenas registros próprios**.
- Se o registro pertence a outro operador, não mostrar ação de edição.
- Solicitação de exclusão/cancelamento, se oferecida, exige justificativa e aprovação Gerente/Admin; não realizar exclusão física.

## 4.8 Perecíveis — Registros

- Busca por descrição, código/SIF ou lote.
- Filtros por período, setor e estado.
- Cards com produto, lote, setor, validade e quantidade/peso.
- Indicadores de vencido, próximo do vencimento e válido.
- Sem temperatura.
- Detalhe abre ao tocar no card.
- Aplicar as mesmas regras de consulta da loja e autoria/edição.

## 4.9 Alertas — lista

- Resumo com contagem de vencidos, próximos do vencimento e pendências, se esses dados existirem.
- Filtros: Todos, Vencidos, A vencer.
- Lista de alertas com produto, lote, setor, validade e tempo até/desde vencimento.
- Cores: vermelho vencido, âmbar próximo, verde válido; sempre incluir texto e ícone.
- Toque abre detalhe do alerta.
- Não incluir ações “Tratar alerta” nem “Imprimir etiqueta” no detalhe: o usuário explicitamente pediu para removê-las.

## 4.10 Detalhe do alerta

- Produto, código/EAN, categoria/setor.
- Badge de situação (Vencido / Próximo / Válido).
- Card “Informações do lote”: lote, validade, quantidade, setor, data do registro e autor quando autorizado.
- Mensagem de atenção contextual.
- Ações permitidas:
  - **Editar registro**, apenas se o operador for autor e backend autorizar.
- Remover:
  - “Tratar alerta”
  - “Baixa/Avaria”
  - “Imprimir etiqueta”
- Mais opções, se implementadas: histórico do produto e outros registros do lote.
- Não apresentar dados fictícios como reais.

## 4.11 Editar registro

- Cabeçalho “Editar registro”.
- Mostrar produto/código como contexto.
- Formulário reaproveita campos do registro original.
- Identificar visualmente que é edição, não novo cadastro.
- Pré-preencher valores existentes.
- Validar lote, validade, quantidade e setor conforme tipo.
- Botões **Cancelar** e **Salvar alterações**.
- Confirmar alterações somente após resposta positiva do backend.
- Edição permitida somente ao autor do registro, validada no backend.
- Mostrar erro de conflito/permissão sem perder os dados editados.

## 4.12 Notificações

- Título “Notificações” e card “Suas notificações”.
- Filtros: Todas, Alertas, Sistema e Avisos.
- Lista com tipo, título, resumo, timestamp e lida/não lida.
- Toque em alerta de validade abre o lote/alerta correspondente.
- Ação “Marcar todas como lidas”.
- Não incluir exclusão irreversível de alertas operacionais sem regra confirmada. Preferir arquivar/ocultar notificações lidas, se backend suportar.
- Contagem do badge deve refletir notificações não lidas, não número arbitrário.

## 4.13 Ajustes

Manter a composição aprovada:

**Preferências**
- Notificações sonoras (toggle).
- Vibração (toggle, somente se plataforma suportar).
- Tema Claro/Escuro (se o app realmente suportar ambos).

**Informações do Sistema**
- Loja/filial.
- Operador autenticado.
- Versão do app.
- Última atualização, quando disponível.

**Suporte e Ajuda**
- **Alterar Senha**
- **Sobre o Aplicativo**

Remover:
- Manual do Operador.
- Fale Conosco.

**Ação**
- Sair do aplicativo, com confirmação se houver risco de perder trabalho não salvo.

## 4.14 Alterar senha

- Cabeçalho “Alterar Senha”.
- Campos:
  - Senha atual.
  - Nova senha.
  - Confirmar nova senha.
- Controles de mostrar/ocultar senha.
- Requisitos de senha informados pelo provedor de autenticação; não inventar política visual.
- Botões **Cancelar** e **Salvar nova senha**.
- Validar senha atual, política de senha e confirmação.
- Não exibir senha em logs, URL ou mensagens.
- Mensagem clara de sucesso/erro.
- Se autenticação exigir reautenticação, implementar o mecanismo oficial do provider.

## 4.15 Sobre o aplicativo

- Cabeçalho “Sobre o Aplicativo”.
- Nome: **Controle de Validade**.
- Descrição:
  > Aplicativo corporativo desenvolvido para apoiar a rotina operacional dos Supermercados Guanabara no registro e acompanhamento de produtos, lotes, datas de validade e perecíveis. Seu objetivo é facilitar a consulta, melhorar o controle operacional e apoiar a prevenção de perdas.
- Bloco “Criador do sistema”:
  - **Jonatas Costa**
  - Idealizador e desenvolvedor do Controle de Validade.
  - Texto institucional: foco em soluções práticas para a operação de supermercados, controle e prevenção de perdas.
- Versão do app dinâmica.
- Data de atualização/build dinâmica quando disponível.
- Não incluir biografia, cargo ou credenciais do criador sem confirmação.
- Não inventar links de suporte, política ou termos.

## 4.16 Perfil do Operador

A proposta visual contemplou:
- Avatar/nome.
- Matrícula, filial, função e setor quando disponíveis.
- Informações de conta e último acesso, se fornecidas pelo backend.
- Atalho para alterar senha.
- Sair da conta.

**Nota:** perfil não deve permitir alterar filial, função, matrícula ou permissões sem fluxo administrativo autorizado. Se perfil não for uma rota separada no app atual, não criar menu novo automaticamente; alinhar com arquitetura.

## 4.17 Busca de produto

- Campo de busca por nome, código EAN ou lote.
- Botão de scanner.
- Filtros: Todos, Industrializados, Perecíveis e filtros avançados.
- Resultados em cards com nome, EAN, setor, lote, validade e status.
- Toque abre detalhe do registro/lote.
- Busca deve consultar dados autorizados da loja.
- Se produto possuir vários lotes, apresentar todos os lotes relevantes, não apenas o primeiro.
- Debounce na pesquisa textual se adequado; manter feedback de carregamento.

## 4.18 Produto não encontrado / estados de busca

- Mensagem “Nenhum produto encontrado”.
- Exibir termo pesquisado.
- Ações: tentar novamente, limpar busca ou voltar.
- Não sugerir criar um cadastro mestre se isso não for permitido ao Operador.
- Se fluxo de registro permitir cadastrar lote para item existente, orientar para voltar ao registro.
- Distinguir “sem resultados” de “falha de rede/permissão”.

## 5. Estados globais obrigatórios

Cada tela que consulta/grava dados deve contemplar:

- Loading/skeleton.
- Estado vazio.
- Erro de rede.
- Erro de autenticação/sessão expirada.
- Erro de autorização (sem acesso).
- Erro de validação.
- Retry quando seguro.
- Confirmação de sucesso apenas depois da persistência.
- Proteção contra envio duplicado.
- Mensagens sem revelar informação sensível.
- Estados offline apenas se o app realmente suportar essa funcionalidade; não prometer sincronização offline sem implementação.

## 6. Acessibilidade e usabilidade operacional

- Contraste mínimo adequado.
- Texto legível em tela pequena.
- Botões grandes para uso rápido.
- Labels claros e consistentes.
- Não depender somente de cor.
- Foco visível para teclado e leitores de tela.
- Inputs com rótulos, não apenas placeholder.
- Ícones sem texto só para ações universalmente reconhecíveis e com aria-label.
- Não usar animações que atrapalhem scanner, scroll ou desempenho.
- Evitar cards excessivamente altos e efeitos de brilho que reduzam contraste.

## 7. Dados de mockup

- Todos os nomes de produtos, EANs, lotes, quantidades, datas, contagens, operador e filial apresentados nos mockups são **dados ilustrativos**.
- A UI final deve carregar dados do Supabase/backend autenticado.
- Não copiar os dados de exemplo dos mockups para produção.
- Não fixar “Filial 05 – Bangu”, “Jonatas” ou contagens como valores estáticos.
- Versão e última atualização devem vir de configuração/build real.

## 8. Permissões e segurança

- Ocultar ações não permitidas melhora UX, mas não substitui autorização no backend.
- Operador consulta registros da própria loja, conforme requisito funcional.
- Operador edita apenas registros de sua autoria.
- Operador não pode excluir fisicamente registro; solicitação de cancelamento/exclusão requer justificativa e aprovação Gerente ou Administrador.
- Não exibir dados de outras lojas.
- Nunca confiar em filial, papel, autoria ou permissão enviada pelo cliente.
- Não incluir segredo/service_role no frontend.

## 9. Compatibilidade com PRs existentes

- Esta especificação é **documentação visual independente**.
- Não alterar arquivos de implementação da PR #22 (responsabilidade do Manus).
- Não modificar migrations, Edge Functions, schema, RLS ou produção.
- Não fazer merge sem autorização explícita.
- PR #19 contém definições funcionais; em caso de contradição, preservar o registro da divergência e solicitar decisão, sem sobrescrever silenciosamente.
- A PR #22 pode ter mudanças de implementação que ainda não estejam homologadas; verificar o estado atual antes de considerar qualquer fluxo implementado.

## 10. Pendências de decisão antes de implementação

1. Resolver a divergência: dashboard Início aprovado visualmente versus entrada direta no leitor descrita na documentação funcional da PR #19.
2. Confirmar se a tela de confirmação permanece visível ou se após commit retorna automaticamente ao scanner.
3. Confirmar se Perfil do Operador será rota independente ou ficará incorporado em Ajustes.
4. Definir se notificações lidas podem ser arquivadas e por quanto tempo.
5. Confirmar quais filtros/indicadores realmente serão suportados pelo backend.
6. Confirmar tema claro: o mockup Ajustes inclui tema claro/escuro, mas as imagens do Operador são predominantemente dark.
7. Confirmar se imagem de produto é fornecida pelo catálogo ou se cards devem usar ícone genérico quando não houver imagem.

## 11. Checklist de implementação visual

- [ ] Cabeçalho e barra inferior compartilhados.
- [ ] Tokens de cor, tipografia, borda e espaçamento centralizados.
- [ ] Início.
- [ ] Registro industrializado.
- [ ] Registro perecível (sem temperatura).
- [ ] Scanner e fallback manual.
- [ ] Confirmação.
- [ ] Produtos / Meus registros.
- [ ] Perecíveis / Registros.
- [ ] Alertas.
- [ ] Detalhe do alerta (sem tratar/baixa/imprimir).
- [ ] Editar registro.
- [ ] Notificações.
- [ ] Ajustes.
- [ ] Alterar senha.
- [ ] Sobre o aplicativo (Jonatas Costa).
- [ ] Busca de produto.
- [ ] Produto não encontrado.
- [ ] Perfil, caso aprovado como rota independente.
- [ ] Estados de loading, vazio, erro e sucesso.
- [ ] Responsividade/safe areas/teclado.
- [ ] Revisão de acessibilidade.
- [ ] Testes visuais em celular pequeno e médio.
