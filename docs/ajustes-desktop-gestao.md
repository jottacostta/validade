# Painel de gestão — Administrador e Gerente

## O que muda

A central anterior ocultava a navegação mobile, mas oferecia apenas Visão geral e Relatórios. A nova barra lateral reúne visão geral, registros, solicitações, relatórios, ajustes e atalhos para as áreas administrativas já existentes. **Perfis de acesso continua exclusivo do Administrador**; o Gerente recebe as entradas compatíveis com suas permissões. O scanner continua oculto e bloqueado no desktop.

As telas de Ajustes são reutilizadas, não clonadas. A mudança entre desktop e celular, o retorno após navegar no mobile e o encerramento da sessão restauram o elemento original e invalidam o estado sensível. Respostas de perfil de uma sessão anterior não podem conceder acesso à sessão atual; falha na confirmação de perfil limpa a autorização anterior.

## Uso no computador e no celular

No computador, a barra lateral concentra a navegação e o seletor de filial fica acima do conteúdo. A visão geral destaca Área de Vendas e Depósito, com registros ativos, unidades de industrializados e peso dos perecíveis em kg. Recolhidos e registros ocultos por vencimento ficam no histórico.

Em Registros, a ordem padrão usa a data de cadastro, do mais recente ao mais antigo. Também é possível inverter as datas ou ordenar pelo nome do produto de A–Z e Z–A. Lançamentos sem data ficam ao fim das ordenações por data. Os filtros por usuário que cadastrou, localização, tipo e status podem ser combinados com a busca. Ao trocar de filial, a tabela restaura a ordenação padrão e limpa os filtros anteriores.

No celular, Administrador e Gerente autorizado abrem o painel em **Ajustes → Painel de gestão**. A visão geral usa os mesmos indicadores e a listagem é exibida em cartões. Em **Usuários → Perfis de acesso → Gerente**, o Administrador usa a permissão existente **Ver e exportar relatórios e acessar o painel de gestão no celular**. Ela é habilitada no perfil Gerente por padrão e pode ser revogada. A seleção de filiais e as ações de cada perfil continuam sujeitas às regras existentes do Supabase.

## Um escopo de dados para todo o painel

O seletor aceita uma filial específica ou **Todas as lojas permitidas**. Registros, gráficos, indicadores, usuários, solicitações, auditoria e relatórios acompanham esse recorte. Trocar de filial limpa o snapshot anterior, invalida consultas atrasadas e fecha edições em andamento. Falha na consulta não permite exibir dados da filial anterior como se fossem da filial nova.

Para o Gerente, “todas” significa a união das lojas atribuídas individualmente pelo Administrador em `loja_membros`: uma loja, um grupo ou todas as lojas existentes selecionadas no cadastro. O papel e a permissão de gerenciar usuários/receber avisos não concedem alcance global ao Gerente. Não há inclusão automática de lojas futuras. Administrador e Analista mantêm o alcance global de dados já existente.

A restrição do Gerente é aplicada também no servidor: RLS, RPCs, gestão de usuários, avisos e filas de push. Gerente sem vínculos fica sem dados de filiais. Permissões de ação continuam independentes do alcance de dados, e as concessões configuráveis legadas para os demais papéis são preservadas. Somente o Administrador pode atribuir vínculos a contas de Gerente; gestores não podem ampliar o próprio alcance por uma chamada direta.

A listagem de usuários mostra apenas os vinculados ao escopo escolhido. A edição pelo Administrador preserva todos os vínculos do alvo mesmo após filtrar a lista por uma filial. Quando um gestor limitado edita um usuário compartilhado, vínculos externos são preservados no banco, mas seus IDs não entram na resposta enviada ao gestor.

## Indicadores e gráficos

A visão geral acrescenta distribuição por situação de validade, setor e local de armazenamento, evolução de registros, ranking de informantes, comparação de filiais e qualidade do cadastro, além dos indicadores e gráficos de recolhimento/reativação existentes. Os cálculos usam os registros consultados; não incluem valores financeiros ou previsões inventadas.

Quantidades industrializadas são apresentadas em unidades e pesos de perecíveis em kg, sem somar grandezas incompatíveis. A situação “a vencer” segue o prazo de alerta da filial do registro, inclusive em consultas consolidadas. A evolução de cadastros usa a data de criação, nunca a data de atualização como substituto.

O carregamento pagina os registros e o catálogo; descrições não se perdem ao ultrapassar 200 EANs. Existe um limite de segurança de 25.000 registros por tabela, informado na interface quando atingido. Os relatórios representam o snapshot consultado e respeitam o mesmo escopo.

## Solicitações, edições e aprovações

A central mostra solicitações de exclusão e correção de nome, contadores e ações de revisão existentes. Filiais e permissões determinam o que cada usuário pode visualizar e decidir. Aprovações continuam passando pelas RPCs já autorizadas no backend; o painel não aceita uma aprovação apenas porque um botão ficou visível.

A gestão de registros oferece edição dos campos operacionais, recolhimento, reativação e exclusão administrativa conforme a autorização do perfil. O alvo é identificado pelo ID e pela filial presentes no snapshot atual, inclusive no consolidado. Atalhos de usuários, lojas, catálogo, auditoria e manutenção reutilizam as telas e suas permissões existentes; o acesso total do Administrador é preservado.

## Causa do erro ao recolher

O aplicativo usa identificadores textuais de registro, inclusive IDs curtos criados offline. As funções antigas exigiam `p_id uuid`, causando `invalid input syntax for type uuid` antes de efetuar o recolhimento. A migration de ações de registros substitui essas assinaturas por `text`, compara o registro com sua loja e preserva o mesmo histórico.

Recolher não apaga o registro. O recolhimento está disponível para registros ativos. Permanecem a permissão `registros_recolher` configurável por perfil e a reativação por Assistente e acima. A exclusão administrativa do painel usa uma RPC transacional: tombstone e auditoria são confirmados juntos; falha na auditoria desfaz a exclusão.

## Edição de usuários e senha

Nome, papel, vínculos e auditoria passam por uma única transação no banco. Validações, escopo, hierarquia e proteção do último Administrador antecedem a mutação. A alteração de senha ocorre depois do commit, pois Supabase Auth é outro serviço. Se apenas a senha falhar, o frontend informa o sucesso parcial de cadastro e não afirma que a senha foi alterada.

## Validação e rollout

Executar `node build.js`, `npm test` e `git diff --check`. A suíte inclui Playwright, contratos, métricas e PostgreSQL embarcado (PGlite) com dados fictícios. Os testes SQL executam recolhimento/reativação com IDs textuais, autorização por loja, rollback da exclusão auditada e da edição de usuários, RLS de Gerentes e geração/preparação/reivindicação de alertas. As capturas de validação não são sessões reais de produção.

Esta entrega depende de três migrations novas, nesta ordem:

1. `20261112120000_edicao_usuarios_atomica.sql`;
2. `20261112121000_acoes_registros_ids_texto_auditadas.sql`;
3. `20261112123000_escopo_individual_gerente.sql`.

Também é necessário reimplantar **gerir-usuarios** (incluindo `scope.ts`) e **alertas**, preservando a configuração de autenticação vigente e os secrets existentes. Não ativar nem reimplantar Google Calendar: continua fora do frontend e sem uso, conforme decisão anterior do proprietário.

O frontend não deve ser publicado antes das migrations e Edge Functions correspondentes. Aplicação de migrations exige autorização específica, separada do merge. CI verde e confirmação das assinaturas/RLS devem anteceder o rollout; após o merge, verificar o GitHub Pages e o conteúdo efetivamente servido. Não substituir essas verificações por uma afirmação de sucesso baseada apenas no build local.

— Manus
