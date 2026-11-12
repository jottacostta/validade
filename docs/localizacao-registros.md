# Localização dos registros

Cada registro de lote (`public.lotes`) e cada registro perecível (`public.pere_regs`) possui `em_area_vendas`: `true` representa **Área de Vendas** e `false` representa **Depósito**. O formulário apresenta um checkbox, marcado inicialmente como Área de Vendas; a escolha é salva por registro, não por produto ou usuário.

A coluna pertence ao registro escopado por loja, portanto os usuários vinculados à mesma loja recebem o mesmo valor ao sincronizar. O usuário pode alterar o valor no formulário de edição conforme as permissões já aplicadas ao registro.

O frontend envia `p_em_area_vendas` nas novas sobrecargas de `registrar_lote` e `registrar_perecivel`. As assinaturas antigas continuam disponíveis para clientes já instalados; o valor padrão `true` preserva a compatibilidade para gravações legadas. A fila offline mantém o campo no payload até a confirmação do servidor, e a sincronização de retorno atualiza o cache local. Dados antigos ou respostas de servidores sem o campo são interpretados como Área de Vendas.

A localização aparece nos cartões de lotes e perecíveis, nos detalhes do registro e nas planilhas XLSX administrativas. A migration `20261112070000_localizacao_lotes_area_vendas.sql` deve ser aplicada no Supabase antes de publicar uma versão do frontend que use a nova RPC; este arquivo de documentação e a alteração local não aplicam mudanças ao banco de produção.
