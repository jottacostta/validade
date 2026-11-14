# Especificação funcional — Central Administrativa

**Produto:** Controle de Validade  
**Status:** Especificação aprovada pelo proprietário — 10/11/2026  
**Escopo:** governança administrativa, usuários, grupos de lojas, permissões e fluxo de solicitações.

## 1. Objetivo

Construir uma Central Administrativa modular para gerenciar o ecossistema do Controle de Validade. A central não será apenas uma tela de navegação: deverá oferecer gestão efetiva de usuários, lojas, permissões, solicitações, catálogo, relatórios, auditoria, configurações e manutenção.

A interface poderá evoluir por etapas, mas nenhuma funcionalidade será considerada concluída apenas por existir no menu. Cada ação deverá ter implementação, validação de autorização, tratamento de erros e testes.

## 2. Princípios de autorização

A autorização será calculada pela combinação de três dimensões independentes:

1. **Perfil:** papel institucional do usuário (Operador, Assistente, Analista, Gerente ou Administrador).
2. **Permissões:** ações permitidas ao perfil e eventuais exceções individuais.
3. **Escopo territorial:** lojas às quais o usuário está vinculado, diretamente ou por grupos.

A interface deve refletir as permissões, mas nunca será a autoridade de segurança. Toda operação sensível será validada no backend e pelas políticas RLS aplicáveis.

## 3. Grupos de lojas — decisão aprovada

- Um usuário poderá pertencer a **mais de um grupo de lojas**.
- Os grupos e vínculos serão atribuídos e administrados pelo Administrador.
- O escopo efetivo do usuário será a união das lojas dos grupos aos quais está vinculado, respeitadas as regras do seu perfil.
- Assistentes e Analistas ficam limitados às lojas de seus grupos atribuídos.
- Gerentes e Administradores possuem abrangência sobre todas as lojas.
- Assistentes e Analistas não podem ampliar ou alterar o próprio escopo territorial.
- O cadastro de subordinados por Assistente ou Analista deve respeitar o escopo do responsável; o vínculo do novo usuário não pode incluir lojas fora desse escopo.
- Alterações de grupos e vínculos devem ser auditadas e não podem ampliar privilégios por falha de validação.

## 4. Matriz hierárquica de cadastro — decisões aprovadas

| Quem cadastra | Operador | Assistente | Analista | Gerente | Administrador |
|---|:---:|:---:|:---:|:---:|:---:|
| Assistente | Sim | Não | Não | Não | Não |
| Analista | Sim | Sim | Não | Não | Não |
| Gerente | Sim | Sim | Sim | Não | Não |
| Administrador | Sim | Sim | Sim | Sim | Sim |

### Escopo por responsável

- **Assistente:** cadastra somente Operadores e somente nas lojas pertencentes aos seus grupos.
- **Analista:** cadastra Operadores e Assistentes somente nas lojas pertencentes aos seus grupos.
- **Gerente:** acessa todas as lojas e cadastra Operadores, Assistentes e Analistas em qualquer loja.
- **Administrador:** autoridade integral; pode cadastrar todos os perfis e administrar todos os grupos e lojas.

Ninguém, exceto o Administrador, pode conceder nível igual ou superior ao próprio. O Gerente não pode cadastrar Gerente; o Analista não pode cadastrar Analista; o Assistente não pode cadastrar Assistente.

## 5. Permissões configuráveis — decisão aprovada

O Administrador terá uma central de permissões com:

- **Matriz padrão por perfil:** define permissões iniciais de cada papel.
- **Exceções individuais:** permite conceder ou retirar permissões de um usuário específico sem alterar todos os usuários daquele perfil.
- **Checkboxes por ação:** controles explícitos para visualizar, incluir, editar, excluir, aprovar, exportar e administrar, conforme o módulo.
- **Escopo separado:** a permissão funcional não substitui nem amplia o escopo territorial.
- **Auditoria:** registrar autor da mudança, usuário/perfil afetado, valor anterior, valor novo, data/hora e justificativa quando aplicável.

A exceção individual será limitada pelo teto de autoridade do perfil e pelas regras de segurança. Não poderá conceder acesso a lojas fora do escopo permitido nem permitir autoelevação de privilégios. O Administrador tem autoridade integral.

## 6. Solicitações de alteração e exclusão de produto

O Operador não altera diretamente o cadastro oficial do catálogo. Ele poderá abrir solicitações:

| Tipo de solicitação | Dados exigidos | Perfis autorizados a aprovar |
|---|---|---|
| Alteração do nome do produto | Produto/EAN, nome atual, nome correto proposto e justificativa | Assistente, Analista, Gerente e Administrador |
| Exclusão de produto | Produto/EAN e justificativa | Gerente e Administrador |

### Regras de aprovação

- **Qualquer usuário autorizado pode aprovar:** não será exigida aprovação cumulativa de todos os níveis autorizados.
- A autorização deve ser conferida no momento da decisão, considerando permissão efetiva e escopo territorial.
- O solicitante não pode aprovar a própria solicitação.
- Registrar solicitante, loja, produto/EAN, conteúdo anterior e proposto, justificativa, decisor, data/hora, decisão e histórico.
- Rejeições devem registrar motivo.
- Solicitações devem ter estados explícitos, no mínimo: pendente, aprovada e rejeitada; cancelamento pode ser adicionado com regra própria.
- A alteração no catálogo só ocorre após aprovação válida.
- Exclusão de produto deve preferir **inativação/exclusão lógica**, preservando lotes, registros de validade, movimentações e trilha de auditoria. Exclusão física exige regra específica e prova de ausência de dependências, nunca apagamento silencioso do histórico.

## 7. Módulos da Central Administrativa

A estrutura funcional prevista contém:

1. **Painel administrativo:** indicadores, alertas, pendências e visão operacional consolidada.
2. **Usuários e perfis:** cadastro, edição, bloqueio, afastamento e gestão de vínculos.
3. **Permissões e acessos:** matriz por perfil, exceções individuais e escopo.
4. **Lojas e grupos:** cadastro, status, agrupamentos e associação de usuários.
5. **Catálogo de produtos:** consulta, cadastro, correção, inativação e gestão de categorias.
6. **Solicitações e aprovações:** fila, filtros, decisões e histórico.
7. **Relatórios e indicadores:** validade por período, registros por usuário, consolidação por loja, perdas/avarias e exportações.
8. **Auditoria e segurança:** trilha de ações, acessos, alterações e eventos administrativos.
9. **Configurações gerais:** parâmetros operacionais e integrações.
10. **Dados e manutenção:** importação/exportação, integridade, backup e rotinas de manutenção.
11. **Perfil e conta / Sobre:** dados do usuário, segurança da conta, versão, ambiente, suporte e documentação.

A navegação pode agrupar esses módulos em dez cartões, sem limitar a arquitetura interna a dez funcionalidades.

## 8. Segurança, integridade e auditoria

- Aplicar autorização no backend, Edge Functions/RPCs e RLS; não confiar em controles visuais.
- Validar perfil, permissão específica, escopo de lojas e estado do registro em cada operação.
- Proteger contra autoaprovação, autoelevação e concessão de privilégios acima do teto permitido.
- Proteger a existência do último Administrador.
- Auditar mudanças de perfil, permissões, grupos, vínculos, produtos e decisões de aprovação.
- Preservar histórico e integridade referencial; preferir inativação quando houver dependências.
- Não expor chaves privilegiadas no cliente.
- Testar cenários positivos e negativos, inclusive tentativas de acesso por outra loja e chamadas diretas ao backend.

## 9. Estratégia de entrega

Implementar incrementalmente, em PRs separadas quando o escopo justificar:

1. Estrutura da Central e navegação.
2. Usuários, grupos e vínculos territoriais.
3. Motor de permissões por perfil e exceções individuais.
4. Solicitações e aprovações.
5. Catálogo ampliado, relatórios e indicadores.
6. Auditoria, segurança, configurações e manutenção.

Cada etapa deve incluir testes automatizados, testes de autorização/RLS quando houver backend e validação visual em 360 px e 320 px. Nenhuma mudança em produção ou merge deve ocorrer sem o fluxo de revisão e autorização aplicável.

## 10. Decisões aprovadas e limites

As decisões dos itens 3, 4, 5 e 6 foram confirmadas pelo proprietário em 10/11/2026 nesta conversa. A especificação não significa que essas funcionalidades já estejam implementadas. A PR #34 permanece limitada à primeira camada de navegação e não deve ser descrita como entrega do ecossistema administrativo completo.

Questões técnicas ainda a detalhar antes da implementação incluem modelo de dados dos grupos, resolução de conflitos entre permissões padrão e exceções, políticas RLS correspondentes, estados/cancelamento de solicitações e critérios de retenção de auditoria.

## Perfil Promotor

O Promotor tem as mesmas permissões configuradas para Operador e acesso às filiais vinculadas. Quem pode cadastrar um Operador pode cadastrar um Promotor dentro do mesmo escopo. O cadastro e a conversão para esse perfil exigem o nome da empresa. A empresa aparece na gestão de usuários e em Meu Perfil e Conta.

Publique a migration de Promotor antes da Edge Function `gerir-usuarios` e da nova interface.
