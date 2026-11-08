# Regras obrigatórias para agentes de IA

Estas instruções se aplicam a qualquer IA, agente ou colaborador automatizado que trabalhe neste repositório. Leia este arquivo antes de modificar código.

## Regra inviolável: nunca fazer merge sem autorização explícita

- **É proibido fazer merge de qualquer Pull Request sem consultar Jonatas e receber autorização explícita para aquela merge.**
- CI verde, aprovação de review, PR pronta ou solicitação para “corrigir”, “testar”, “acompanhar” ou “concluir” não equivalem a autorização de merge.
- Ao terminar implementação e validação, apresentar resumo, testes/checks e riscos, e perguntar: **“Posso fazer a merge?”**
- Não fazer merge, squash, rebase para merge, deploy de produção ou aplicar migration de produção antes da autorização explícita.
- Se a autorização estiver ambígua, não fazer merge. Perguntar.

## Fluxo obrigatório de desenvolvimento

1. Inspecionar o código atual, documentação, histórico e testes antes de editar.
2. Identificar causa raiz; não alterar arquivos sem entender o comportamento existente.
3. Criar/usar branch dedicada; nunca desenvolver diretamente em `main`.
4. Fazer alterações pequenas, focadas e documentadas.
5. Adicionar ou atualizar testes que cubram a mudança e regressões relevantes.
6. Executar os testes definidos no projeto, build e verificações estáticas aplicáveis.
7. Abrir ou atualizar Pull Request. Preferir Draft enquanto houver pendências.
8. Aguardar CI; investigar e corrigir falhas. Não declarar sucesso sem resultados observáveis.
9. Antes de solicitar merge, garantir que os checks obrigatórios estejam verdes, revisar diff e explicar limitações.
10. Parar e pedir autorização explícita do proprietário antes de fazer merge.
11. Não aplicar migrations nem mudanças destrutivas em produção sem autorização separada e explícita.

## Transparência e segurança

- Nunca inventar que testes, build, CI, review ou deploy foram executados.
- Informar comandos/testes que não puderam ser executados e o motivo.
- Não incluir dados reais de RH, usuários, credenciais, tokens, secrets ou dados sensíveis em commits, testes ou logs.
- Não expor secrets; não copiar valores de ambiente para issues/PRs.
- Mudanças de autorização devem ser validadas no backend (RLS/RPC/Edge Function), não somente na interface.
- Preservar compatibilidade, dados existentes, histórico e sincronização; investigar risco de regressão/offline.
- Evitar aplicar alterações diretamente no banco Supabase de produção. Preferir migration versionada, revisão e testes em ambiente seguro.

## Regras de trabalho para este projeto

- Consultar `README.md`, `CONTEXTO.md`, documentação em `docs/` e instruções adicionais antes de implementar.
- Seguir os scripts de teste e build de `package.json` e workflow em `.github/workflows/`.
- Não alterar ou regenerar `dist/` manualmente sem confirmar o fluxo de build esperado.
- Revisar permissões por papel e escopo de loja, incluindo tentativas de acesso indevido.
- Para exclusões, considerar auditoria, tombstones/sync offline, concorrência e recuperação quando aplicável.
- Logout deve invalidar a sessão, limpar estado sensível e impedir que refresh/Voltar restaure sessão encerrada.
- Operador só pode editar inserções próprias (descrição, quantidades e validade), conforme regra de negócio aprovada; autorização deve ser verificada no servidor.

## Checklist antes de solicitar merge

- [ ] Escopo e diff revisados
- [ ] Testes automatizados executados e aprovados
- [ ] Build aprovado
- [ ] CI obrigatório verde
- [ ] Segurança/RLS/escopo de loja revisados
- [ ] Sem secrets ou dados sensíveis
- [ ] Pendências e riscos comunicados
- [ ] **Autorização explícita de Jonatas para merge recebida**

Sem o último item, a PR permanece aberta.
