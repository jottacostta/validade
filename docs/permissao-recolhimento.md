# Permissão para recolher registros tratados

O botão **Recolher** é controlado como uma permissão por perfil no painel **Ajustes → Perfis de acesso** do Administrador. O Administrador pode habilitar ou desabilitar essa permissão separadamente para Operador, Assistente, Analista e Gerente; o perfil Administrador sempre conserva acesso total.

Por padrão, todos os quatro perfis de loja podem recolher qualquer lote ou registro perecível elegível da loja a que estejam vinculados, ainda que outra pessoa tenha feito o cadastro. A permissão se aplica apenas à ação de recolher — não concede acesso à edição dos dados do registro nem permite apagar registros.

O botão aparece em todos os registros ativos, independentemente da data de validade. A migration `20261113121825_recolhimento_sem_janela.sql` aplica a mesma regra no servidor. Depois de recolhido, o registro fica oculto para os usuários da loja. A reativação permanece restrita a Assistente, Analista, Gerente e Administrador, conforme o comportamento existente.

A mesma permissão é verificada no frontend e na RPC `marcar_registro_recolhido`; a RPC também exige autenticação e valida o vínculo ou escopo da loja. As alterações feitas pelo Administrador no painel são persistidas via `definir_permissao_papel` e registradas na auditoria de permissões.

## Implantação

A migration `20261112080000_recolhimento_configuravel_por_perfil.sql` deve estar aplicada antes de publicar a versão do frontend que expõe e usa esta permissão. Ela adiciona o novo identificador à tabela de permissões, define o padrão habilitado para os perfis de loja e atualiza a RPC para validar o acesso por perfil e escopo.
