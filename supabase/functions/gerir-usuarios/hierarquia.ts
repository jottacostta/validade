// Hierarquia de promoção (decisão do proprietário, 12/11/2026):
//   - Administrador: atribui e administra qualquer papel.
//   - Gerente: promove e administra até Analista.
//   - Analista: promove e administra até Assistente.
//   - Assistente: não promove; só cria (e, com "Gerenciar usuários", administra) Operador e Promotor.
//   - Operador e Promotor: só executa o operacional; nunca gerencia usuários, mesmo com a permissão marcada.
// Gerente e Analista dependem da permissão "Gerenciar usuários". Arquivo sem dependências para teste em Node.
const PAPEIS_ORDEM = ["operador", "promotor", "assistente", "analista", "gerente", "admin"];
const NIVEL_PAPEL: Record<string, number> = { operador: 1, promotor: 1, assistente: 2, analista: 3, gerente: 4, admin: 5 };

export function tetoAtribuicao(papelAtor: string, gerenciaUsuarios: boolean): number {
  if (papelAtor === "admin") return 5;
  if (papelAtor === "assistente") return 1;
  if (!gerenciaUsuarios) return 0;
  if (papelAtor === "gerente") return 3;
  if (papelAtor === "analista") return 2;
  return 0;
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
