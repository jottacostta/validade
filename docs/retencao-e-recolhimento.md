# Retenção operacional e recolhimento de registros

## Regra aprovada

- Lotes industrializados e registros perecíveis continuam disponíveis nas telas operacionais até cinco dias após o vencimento, inclusive no dia `D+5`.
- A partir de `D+6`, o registro deixa de aparecer nas listas operacionais, na busca operacional, nos últimos registros da tela inicial e nos alertas ativos. O registro **não é excluído** do banco nem do histórico.
- Para produto que vence hoje ou nos próximos cinco dias, um usuário com permissão pode marcar o registro como **Recolhido**. O botão só aparece para registros próprios quando o usuário tem `editar_proprios`, ou para outro registro quando tem `registros_editar_outros` (administrador conserva acesso total). Recolher não é excluir: o mesmo registro continua no banco e fica oculto nas listas operacionais de todos os usuários daquela loja.
- O recolhimento só é confirmado online pelo RPC `marcar_registro_recolhido`, que valida sessão, vínculo à loja, papel/permissão, data de validade e concorrência. Uma falha do servidor não altera o estado local.
- O registro recolhido some imediatamente das telas operacionais e dos alertas locais; sua linha é mantida com `recolhido_em` e `recolhido_por` enquanto estiver recolhida. Assistente, analista, gerente ou administrador podem abrir a lista de recolhidos e reativar um recolhimento equivocado enquanto o registro ainda estiver dentro da janela de retenção. A reativação também usa RPC autorizada no servidor e volta a disponibilizar o mesmo registro para a loja, sem criar cópia.

## Alertas e relatórios

- O gerador server-side de alertas internos e o preparador/dispatcher de Push ignoram registros recolhidos e encerram itens de Push pendentes para registros removidos, recolhidos ou além do período de retenção.
- A central administrativa e o XLSX preservam o histórico, distinguindo estado de validade (por exemplo, “Vencido”) de estado operacional (“Ativo”, “Recolhido” ou “Oculto após 5 dias vencido”). Indicadores operacionais contam apenas registros ativos.
- A regra de cinco dias usa a data local de `America/Sao_Paulo` no banco e a data local do aparelho no PWA. A interface reavalia a lista quando o dia local muda.

## Persistência e rollout

A migration `supabase/migrations/20261111223000_recolhimento_retencao_registros.sql` adiciona as colunas, as RPCs de recolhimento/reativação e a proteção contra alteração via upsert genérico, e atualiza a geração de alertas/Push. Aplicar a migration no Supabase antes de publicar o frontend correspondente. Não há remoção física de registros nem backfill destrutivo.
