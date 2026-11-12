# Retenção operacional e recolhimento de registros

## Regra aprovada

- Lotes industrializados e registros perecíveis continuam disponíveis nas telas operacionais até cinco dias após o vencimento, inclusive no dia `D+5`.
- A partir de `D+6`, o registro deixa de aparecer nas listas operacionais, na busca operacional, nos últimos registros da tela inicial e nos alertas ativos. O registro **não é excluído** do banco nem do histórico.
- Para produto que vence hoje ou nos próximos cinco dias, usuários dos perfis de loja podem marcar o registro como **Recolhido** quando o perfil tem a permissão `registros_recolher`. O padrão concede essa permissão a Operador, Assistente, Analista e Gerente; o Administrador pode configurá-la por perfil em Ajustes → Usuários e Permissões → Perfis de acesso. Recolher não é excluir: o mesmo registro continua no banco e fica oculto nas listas operacionais de todos os usuários daquela loja.
- O recolhimento só é confirmado online pelo RPC `marcar_registro_recolhido`, que valida sessão, escopo da loja, permissão efetiva, data de validade e concorrência. Uma falha do servidor não altera o estado local.
- O registro recolhido some imediatamente das telas operacionais e dos alertas locais; sua linha é mantida com `recolhido_em` e `recolhido_por` enquanto estiver recolhida. Assistente, analista, gerente ou administrador podem abrir a lista de recolhidos e reativar um recolhimento equivocado enquanto o registro ainda estiver dentro da janela de retenção. A reativação também usa RPC autorizada no servidor e volta a disponibilizar o mesmo registro para a loja, sem criar cópia.

## Alertas e relatórios

- O gerador server-side de alertas internos e o preparador/dispatcher de Push ignoram registros recolhidos e encerram itens de Push pendentes para registros removidos, recolhidos ou além do período de retenção.
- A central administrativa e o XLSX preservam o histórico, distinguindo estado de validade (por exemplo, “Vencido”) de estado operacional (“Ativo”, “Recolhido” ou “Oculto após 5 dias vencido”). Indicadores operacionais contam apenas registros ativos.
- A regra de cinco dias usa a data local de `America/Sao_Paulo` no banco e a data local do aparelho no PWA. A interface reavalia a lista quando o dia local muda.

## Persistência e rollout

As migrations versionadas em `supabase/migrations/` são a fonte do schema. Aplicar as migrations necessárias em ordem no Supabase antes de publicar o frontend correspondente: `20261112070000_localizacao_lotes_area_vendas.sql` (campo compartilhado Área de Vendas/Depósito nos lotes e perecíveis) e `20261112080000_recolhimento_configuravel_por_perfil.sql` (permissão por perfil e validação da RPC de recolhimento). As migrations anteriores de retenção e auditoria permanecem pré-requisitos para as telas operacionais e relatórios descritos acima. Não há remoção física de registros nem backfill destrutivo nesta alteração.

## Auditoria e indicadores

Cada mudança confirmada de ativo para recolhido ou de recolhido para ativo gera um evento explícito na tabela `auditoria`, dentro da mesma transação que altera o registro. O evento identifica usuário e papel autenticados, loja, tipo/ID do registro, produto, validade e estado anterior/novo. A falha ao gravar o evento cancela a alteração; chamadas repetidas que não mudam o estado não criam evento duplicado. A tabela já é protegida por RLS e pela permissão `auditoria_ver`.

A área **Relatórios e Indicadores** exibe, para quem possui `auditoria_ver`, totais por usuário e por ação no intervalo escolhido e as 12 ações mais recentes desse período. A consulta pagina os resultados até 10.000 eventos; acima disso, o painel avisa para restringir o intervalo. O filtro oferece últimos 7, 30, 90 ou 365 dias, todo o período ou datas personalizadas, aplicando os limites no servidor. A consulta também filtra pela loja e pelas duas ações; os indicadores não alteram nem removem registros. No mesmo painel há um ranking dos dez produtos mais reativados na janela móvel fixa dos últimos 30 dias, independente do período selecionado para os demais indicadores; o agrupamento distingue industrializados e perecíveis e limita os dados à loja ativa. O ranking conta eventos registrados na auditoria, não quantidades de unidades, e não reconstrói eventos anteriores à ativação da auditoria. A migration `20261111231500_auditoria_recolhimento.sql` deve ser aplicada antes da publicação do frontend que apresenta os dados.
