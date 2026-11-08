# Definição funcional — Área do Operador

**Status:** proposta inicial para discussão. Não representa autorização para implementar regras ainda não aprovadas.

## Objetivo

Definir, separadamente dos demais perfis, o comportamento da área Operador no front-end e no back-end. O Supabase/PostgreSQL é a fonte oficial dos dados de estoque; o navegador não deve ser requisito para persistência.

## Escopo do Operador

### Front-end
- Tela Registrar: localizar produto por EAN, pesquisa manual ou scanner.
- Mostrar nome do produto e dados relevantes do catálogo.
- Formulário de lote: lote, quantidade e validade.
- Formulário de perecível: descrição/código, SIF quando aplicável, peso e validade.
- Mostrar confirmação somente após resposta positiva do Supabase.
- Em erro, exibir mensagem útil retornada pelo backend e manter os campos preenchidos.
- Mostrar claramente a loja ativa e o usuário autenticado.
- Impedir submissão duplicada enquanto a requisição estiver em andamento.
- Consulta de registros deve respeitar o escopo da loja autorizada.

### Back-end / Supabase
- Autenticação obrigatória e sessão JWT do usuário.
- Validar no banco papel, usuário e loja autorizada; não confiar apenas no front-end.
- Todas as operações de estoque devem ser vinculadas a `loja_id`.
- Aplicar RLS para impedir leitura/escrita em lojas não autorizadas.
- O catálogo compartilhado (`catalogo`) não deve ser confundido com estoque por loja (`produtos`, `lotes`).
- Registrar autoria e timestamps quando suportados pelo schema.
- Nunca usar `service_role` no cliente.
- Considerar RPC transacional para inserir produto/associação e lote atomicamente, evitando gravação parcial.
- Falhas devem retornar códigos/mensagens claros; a UI só confirma após commit.

## Matriz de permissões — proposta inicial

| Ação | Operador |
|---|---|
| Consultar catálogo de produtos | Permitido |
| Registrar lote na loja vinculada | Permitido |
| Registrar perecível na loja vinculada | Permitido |
| Consultar estoque/lotes da loja vinculada | Permitido, sujeito à definição de UI |
| Alterar lote já existente | **A definir** |
| Excluir lote ou produto | **Não permitido por padrão** |
| Consultar outra loja | **Não permitido** |
| Administrar usuários, lojas ou permissões | Não permitido |

## Fluxos propostos

1. Login e seleção de loja autorizada.
2. Operador busca/escaneia produto.
3. Front-end valida campos obrigatórios.
4. Envia requisição ao Supabase com sessão JWT.
5. Banco aplica RLS e valida loja.
6. Banco confirma transação.
7. UI exibe sucesso e atualiza a lista a partir da resposta/consulta ao banco.
8. Em falha, UI mostra erro e preserva o formulário; não registra sucesso localmente.

## Critérios de aceite

- Operador não consegue consultar nem modificar registros de outra loja, inclusive chamando REST diretamente.
- Registro só é considerado salvo após confirmação do PostgreSQL.
- Requisições repetidas não geram duplicidade silenciosa.
- Erros de validação, RLS, rede e conflito são distinguíveis na interface.
- A UI não depende de localStorage para confirmar um registro.
- Testes cobrem acesso permitido e negado para o papel Operador.
- Nenhuma alteração de comportamento dos outros perfis nesta etapa.

## Decisões pendentes de Jonatas

1. Operador pode **editar quantidade/validade de lote existente**, ou apenas cadastrar e consultar?
2. Operador pode visualizar o histórico completo de lotes da própria loja ou somente os registros que ele criou?
3. Deve existir cancelamento/estorno de registro? Se sim, preferir trilha de auditoria e cancelamento lógico, não exclusão física.

## Fora do escopo desta PR

- Implementação de código de produção.
- Alterações nas áreas Assistente, Analista, Gerente ou Administrador.
- Alterações ou execução de migrations no Supabase.
- Mudanças na matriz de permissões dos outros papéis.
