// Hierarquia de promoção (decisão do proprietário, 12/11/2026):
//   - Administrador: atribui e administra qualquer papel.
//   - Gerente: promove e administra até Analista.
//   - Analista: promove e administra até Assistente.
//   - Qualquer outro perfil que receba "Gerenciar usuários" em Perfis de acesso: até Assistente.
// Sem a permissão de gerenciar usuários não há atribuição de papel (o Assistente segue
// criando Operador pela regra própria do index.ts). Arquivo sem dependências para teste em Node.
const PAPEIS_ORDEM = ["operador", "assistente", "analista", "gerente", "admin"];
const NIVEL_PAPEL: Record<string, number> = { operador: 1, assistente: 2, analista: 3, gerente: 4, admin: 5 };

export function tetoAtribuicao(papelAtor: string, gerenciaUsuarios: boolean): number {
  if (papelAtor === "admin") return 5;
  if (!gerenciaUsuarios) return 0;
  if (papelAtor === "gerente") return 3;
  return 2;
}

export function podeAtribuirPapel(papelAtor: string, gerenciaUsuarios: boolean, papelNovo: string): boolean {
  const nivel = NIVEL_PAPEL[papelNovo];
  return !!nivel && nivel <= tetoAtribuicao(papelAtor, gerenciaUsuarios);
}

export function podeAdministrarPapel(papelAtor: string, gerenciaUsuarios: boolean, papelAlvo: string): boolean {
  const nivel = NIVEL_PAPEL[papelAlvo];
  return !!nivel && nivel <= tetoAtribuicao(papelAtor, gerenciaUsuarios);
}

export function papeisAtribuiveis(papelAtor: string, gerenciaUsuarios: boolean): string[] {
  const teto = tetoAtribuicao(papelAtor, gerenciaUsuarios);
  return PAPEIS_ORDEM.filter((p) => NIVEL_PAPEL[p] <= teto);
}
