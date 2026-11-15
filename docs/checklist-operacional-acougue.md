# Checklist Operacional Diário — Açougue

Fonte do modelo: `Checklist_Operacional_Acougue_v2.docx`, anexado por Jonatas em 13/11/2026. O aplicativo mantém uma versão congelada do modelo em cada ronda para que alterações futuras não modifiquem rondas antigas.

## Itens do modelo

1. **Ilhas de exposição e geladeira de peixes:** organização e limite de abastecimento; rupturas; limpeza das grelhas; precificação conforme a tabela da moída; temperatura das ilhas e da geladeira de peixes; organização, limpeza e preços da geladeira de peixes.
2. **Balcões de atendimento e pesagem:** balanças limpas, higienizadas e niveladas; bobinas térmicas e sacos plásticos abastecidos; vidros sem marcas de mãos ou gordura.
3. **Sala de manipulação:** EPIs/insumos abastecidos e em uso; sabonete líquido, álcool 70% e papel toalha; mesas, bandejas e lixeiras organizadas/higienizadas; serra-fita limpa e sanificada; ausência de garrafas de água ou bebidas.
4. **Sala de descongelamento técnico:** cubas limpas e abastecidas; nenhuma mercadoria aberta ou desprotegida.
5. **Controle rígido de validades:** validade/rotulagem/integridade das bandejas; cortes bovinos com regra PEPS; validade dos cortes suínos.
6. **Câmara de congelados:** produtos fora do piso com estrados/paletes; mercadorias organizadas, sem produtos soltos ou sobre pranchas; paredes e portas limpas e sem acúmulo de gelo; BRT limpo, higienizado e organizado.

São 23 verificações; cada uma exige resposta **Sim** ou **Não**. O item Temperatura exige registro numérico em °C para as ilhas e para a geladeira de peixes. Há campo separado para observações e ocorrências.

## Fluxo no Validade

- Em **Ajustes → Configuração de Rondas**, o Administrador define, para cada filial, quem pode preencher, quem valida como **Encarregado** e quem valida como **Subgerente de Perecíveis**. As três designações precisam pertencer à filial e são mutuamente exclusivas.
- A opção de Rondas é mostrada somente ao usuário designado para a filial selecionada. O servidor também valida o vínculo; esconder o botão não é o controle de segurança.
- O executor escolhe um modelo e pode gerar uma ronda por filial, data e modelo. Um rascunho pode ser salvo parcialmente. O envio exige todas as respostas e, no modelo padrão do Açougue, também as duas temperaturas.
- Em **Modelos personalizados**, o Administrador cria ou edita modelos por filial, com seções e perguntas de Sim/Não. Cada edição gera uma versão para as próximas rondas.
- Em **Rondas geradas**, o Administrador seleciona a data e pode ativar ou desativar cada ronda. Rondas inativas ficam no histórico em modo de consulta e preservam as respostas e assinaturas. A aba continua disponível aos usuários designados mesmo sem rondas ativas.
- Após a submissão, o conteúdo fica bloqueado. As duas pessoas designadas precisam assinar a versão submetida. O executor/autor não pode assinar a própria ronda. Uma devolução exige motivo e permite correção seguida de nova submissão.
- A aprovação final equivale a uma assinatura eletrônica interna auditável, associada a conta autenticada, nome, etapa, versão e horário. Não é assinatura digital ICP-Brasil nem declaração de conformidade legal.
- O Word também tem uma linha separada para “Sub Encarregado”. Ela não foi adicionada como terceira etapa porque o fluxo solicitado explicitamente prevê duas validações: Encarregado e Subgerente de Perecíveis. Essa diferença deve ser confirmada antes de ativar a configuração para filiais reais.

## Operação e publicação

- A consulta de designação, os rascunhos, o envio e as assinaturas dependem de conexão com o Supabase. O módulo não mantém fila offline de assinatura; isso evita indicar como validada uma ronda cuja gravação ainda não foi confirmada pelo servidor.
- Aplique `20261115125146_rondas_personalizadas.sql` antes de publicar esta versão do PWA, em rollout autorizado. As rondas da filial que estava com o checklist desligado passam a constar como inativas. O histórico e as designações existentes são preservados.
- O build embute `src/checklist.css` e `src/checklist.js` no PWA para que a nova área não dependa de arquivos externos separados.
