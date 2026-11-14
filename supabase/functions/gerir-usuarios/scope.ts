// @ts-nocheck

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// UUIDs are used in production; short alphanumeric IDs keep the pure helper usable by tests/mocks.
const SIMPLE_STORE_ID = /^[A-Za-z0-9_]{1,64}$/;

export function resolveListScope(body) {
  const hasStoreId = Object.prototype.hasOwnProperty.call(body, "loja_id");
  const escopo = body.escopo;

  if (escopo !== undefined && escopo !== "todas") {
    return { ok: false, error: "Escopo inválido." };
  }
  if (escopo === "todas" && hasStoreId) {
    return { ok: false, error: "Não informe loja_id quando escopo=todas." };
  }
  if (!hasStoreId) {
    return escopo === "todas"
      ? { ok: true, scope: { kind: "all" } }
      : { ok: true, scope: { kind: "legacy" } };
  }

  const lojaId = body.loja_id;
  if (typeof lojaId !== "string" || (!UUID.test(lojaId) && !SIMPLE_STORE_ID.test(lojaId))) {
    return { ok: false, error: "loja_id inválido." };
  }
  return { ok: true, scope: { kind: "specific", lojaId } };
}

export function buildScopedUserList(input) {
  const { scope, permitidas, perfis, membros, lojas, emailPorId, escopoTotal } = input;
  if (scope.kind === "specific" && !permitidas.has(scope.lojaId)) {
    return { ok: false, status: 403, error: "Loja fora do escopo permitido." };
  }

  const lojasDoEscopo = scope.kind === "specific"
    ? new Set([scope.lojaId])
    : permitidas;
  const membrosPermitidos = membros.filter((m) => permitidas.has(m.loja_id));
  const membrosVisiveis = membrosPermitidos.filter((m) => lojasDoEscopo.has(m.loja_id));
  const usuariosComVinculo = new Set(membrosVisiveis.map((m) => m.user_id));

  // The legacy request intentionally keeps the previous admin behavior: an admin
  // can still see profiles without a store membership. Explicit scopes never do.
  const perfisVisiveis = perfis.filter((p) =>
    scope.kind === "legacy" && escopoTotal ? true : usuariosComVinculo.has(p.id)
  );
  const perfisUnicos = [];
  const idsVistos = new Set();
  for (const perfil of perfisVisiveis) {
    if (!idsVistos.has(perfil.id)) {
      idsVistos.add(perfil.id);
      perfisUnicos.push(perfil);
    }
  }

  const nomeLoja = {};
  for (const loja of lojas) nomeLoja[loja.id] = loja.nome || "";

  const porUsuario = new Map();
  for (const membro of membrosPermitidos) {
    const lojasDoUsuario = porUsuario.get(membro.user_id) || new Map();
    lojasDoUsuario.set(membro.loja_id, {
      id: membro.loja_id,
      nome: nomeLoja[membro.loja_id] || "",
    });
    porUsuario.set(membro.user_id, lojasDoUsuario);
  }

  const usuarios = perfisUnicos.map((perfil) => {
    const lojas = [...(porUsuario.get(perfil.id)?.values() || [])];
    const usuario = {
      id: perfil.id,
      nome: perfil.nome || "",
      papel: perfil.papel,
      ...(perfil.setor ? { setor: perfil.setor } : {}),
      ...(perfil.papel === "promotor" ? { empresa: perfil.empresa } : {}),
      usuario: (emailPorId[perfil.id] || "").split("@")[0],
      // Keep every permitted membership so editing this user cannot erase
      // another allowed store after a filtered listing round-trip.
      lojas,
    };
    if (scope.kind === "specific") {
      usuario.lojas_no_escopo = lojas.filter((loja) => lojasDoEscopo.has(loja.id));
    }
    return usuario;
  }).sort((a, b) => (a.usuario || "").localeCompare(b.usuario || ""));

  // Keep the full permitted store catalog for the edit form; the card can use
  // each user's lojas_no_escopo when a specific store filter is active.
  const lojasVisiveis = lojas.filter((loja) => permitidas.has(loja.id));
  return { ok: true, data: { usuarios, lojas: lojasVisiveis } };
}

// A RPC mantém vínculos externos para não causar perda de dados. Eles nunca
// entram na resposta a um ator com alcance limitado por loja_membros.
export function filtrarResultadoEdicao(cadastro, escopoTotal, permitidas) {
  if (escopoTotal) return cadastro;
  const lojas = Array.isArray(cadastro?.lojas) ? cadastro.lojas : [];
  return {
    ...cadastro,
    lojas: lojas.filter((id) => typeof id === "string" && permitidas && permitidas.has(id)),
  };
}
