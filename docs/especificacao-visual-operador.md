# Especificação visual e funcional — Área do Operador

## Status e autoridade

Este documento registra os requisitos aprovados pelo proprietário para a implementação do front-end do Controle de Validade. As imagens de referência fornecidas na conversa são a fonte visual oficial. A implementação deve reproduzir o design, não apenas reutilizar sua paleta de cores.

A Área do Operador estabelece o padrão visual de referência do projeto. Esta PR trata do front-end e não autoriza alterações em backend, banco de dados, políticas de segurança, migrations ou regras de negócio.

## Critérios obrigatórios de aceite

### 1. Fidelidade visual

Reproduzir cada tela de acordo com sua imagem de referência, incluindo:

- estrutura, hierarquia visual e proporções dos componentes;
- dimensões relativas, alinhamentos, margens, paddings e espaçamentos;
- tipografia, pesos, tamanhos e hierarquia dos textos;
- ícones, ilustrações e seus posicionamentos;
- cores, gradientes, fundos, transparências e sombras;
- bordas, raios, divisórias, cartões, campos, botões e indicadores;
- cabeçalho, identidade Guanabara, navegação inferior e estados selecionados;
- estados de foco, pressionado, desabilitado, carregamento, vazio, erro e sucesso.

Não aceitar uma tela como concluída apenas por compartilhar cores ou aparência genérica com o mockup. Comparar visualmente a implementação com a referência correspondente.

### 2. Fidelidade funcional

Todo elemento que aparenta ser interativo deve executar sua ação real. Não criar controles decorativos ou ações sem implementação.

Inclui navegação, voltar, busca, filtros, ordenação, paginação, formulários, seleção de tipo, leitor de código de barras, leitura de etiqueta, edição, consulta de histórico, notificações, preferências e ações de conta.

As telas devem apresentar feedback coerente de carregamento, sucesso, validação e falha. Evitar submissões duplicadas e preservar os dados preenchidos quando houver erro recuperável.

### 3. Preservação das regras e integrações

Preservar o comportamento existente e aprovado de:

- autenticação, sessão e identificação da loja;
- papéis, permissões e escopo de acesso;
- integração, consultas e gravações no Supabase;
- RLS, RPCs, Edge Functions e sincronização existentes;
- autoria, histórico, registros e validações;
- scanner, leitura de etiquetas e fluxos de industrializados e perecíveis.

A interface não substitui controles de segurança do servidor. Não enfraquecer validações, permissões ou políticas para facilitar a implementação visual. Não expor credenciais ou chaves privilegiadas no cliente.

### 4. Responsividade e acessibilidade

Usar as imagens como referência de composição e proporção. Adaptar o layout a diferentes dimensões de tela sem distorcer a identidade visual, cortar conteúdo, sobrepor controles ou prejudicar a operação por toque. Manter contraste, foco visível, rótulos e áreas de toque adequadas.

## Inventário de telas de referência

A implementação deve contemplar, no mínimo, os seguintes fluxos e telas representados nas imagens fornecidas:

1. Início / dashboard do Operador.
2. Seleção de cadastro: industrializado ou perecível.
3. Registro de produto industrializado.
4. Registro de produto perecível.
5. Leitura de etiqueta de perecível e confirmação dos dados lidos.
6. Meus Registros / produtos industrializados, com pesquisa, filtros, indicadores e paginação.
7. Registros de Perecíveis, com pesquisa, filtros, temperatura, indicadores e paginação.
8. Busca de produto, com filtros por tipo e resultados.
9. Alertas, com categorias, contadores e listagem.
10. Detalhe do alerta / lote.
11. Edição de registro.
12. Notificações, com categorias, status de leitura e ações.
13. Configurações / preferências.
14. Perfil do Operador.
15. Alteração de senha.
16. Sobre o aplicativo.
17. Confirmação de registro concluído, conforme fluxo funcional aprovado.
18. Histórico do produto.
19. Consulta de outros registros do mesmo lote.

Quando uma tela ainda não tiver imagem específica, criar sua interface seguindo o mesmo sistema visual aprovado, sem inventar regras de negócio.

## Direção de navegação e fluxo

- O Início é a tela inicial da Área do Operador.
- A navegação inferior deve seguir o padrão visual das referências e permitir acesso às áreas principais.
- O cadastro começa por uma escolha explícita entre industrializado e perecível.
- A câmera/leitor só deve ser acionada após ação explícita do usuário.
- Após a gravação confirmada pelo Supabase, apresentar confirmação clara do resultado, com opções para iniciar novo registro ou consultar os registros.
- Não apresentar sucesso antes da confirmação da persistência no servidor.
- Não retornar automaticamente ao scanner após salvar.

## Processo de implementação e validação

1. Inspecionar a estrutura atual e identificar os handlers, IDs, rotas, estados e integrações que precisam ser preservados.
2. Mapear cada imagem para a tela e o fluxo correspondente.
3. Implementar a estrutura HTML, o CSS detalhado e o JavaScript funcional sem substituir regras existentes.
4. Validar cada interação e os estados de erro/sucesso.
5. Comparar visualmente cada tela com sua referência em dimensões equivalentes e verificar também a adaptação responsiva.
6. Executar os testes e o build definidos pelo projeto; registrar os resultados reais na PR.
7. Corrigir regressões antes de considerar a entrega concluída.

## Fora do escopo desta PR

- Alterações em migrations, banco remoto, RLS, RPCs, Edge Functions ou infraestrutura Supabase.
- Mudanças em regras de negócio, permissões ou contratos de API sem autorização específica.
- Merge ou deploy de produção sem autorização explícita do proprietário.

## Critério final de conclusão

A PR não estará pronta apenas porque o aplicativo compila ou porque a tela inicial está visualmente próxima. Todas as telas do escopo devem apresentar fidelidade visual às referências, interações funcionais e preservação comprovada das regras e integrações existentes. Pendências, limitações de comparação visual e testes não executados devem ser declarados explicitamente.
