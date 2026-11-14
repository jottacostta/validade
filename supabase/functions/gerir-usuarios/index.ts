// Edge Function: gestão de usuários (criar/editar/excluir/listar)
// Roda no servidor com a service_role (NUNCA vai para o app). Identifica quem chama
// pelo JWT e aplica as regras de papel:
//   - assistente: cria usuários (Operador ou Promotor da sua loja)
//   - analista/gerente: ações autorizadas por permissão; não administram papéis superiores
//   - gerente: lojas restritas aos vínculos individuais atribuídos pelo Administrador
//   - admin:      faz tudo (papel, lojas, excluir)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildScopedUserList, resolveListScope, filtrarResultadoEdicao } from "./scope.ts";
import { podeAdministrarPapel, podeAtribuirPapel } from "./hierarquia.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAPEIS = ["operador", "promotor", "assistente", "analista", "gerente", "admin"];
const COMUNS = ["123456","1234567","12345678","123456789","senha","password","qwerty","111111","000000","abc123","admin123","guanabara"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const temCampo = (obj, campo) => Object.prototype.hasOwnProperty.call(obj, campo);

const empresaInvalida = "Informe o nome da empresa do promotor (até 120 caracteres).";
function normalizarEmpresa(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const empresa = valor.trim();
  return empresa && empresa.length <= 120 && !/[\u0000-\u001f\u007f]/.test(empresa) ? empresa : null;
}

const validarUsuario = (u: string) => /^[a-z0-9._-]{3,30}$/.test(u);
function validarSenha(s: string, usuario: string): string | null {
  if (!s || s.length < 6) return "A senha precisa de pelo menos 6 caracteres.";
  if (COMUNS.includes(s.toLowerCase())) return "Essa senha é muito comum. Escolha outra.";
  if (s.toLowerCase() === usuario.toLowerCase()) return "A senha não pode ser igual ao usuário.";
  return null;
}

// Mantida pura para que o contrato de entrada seja testável sem Supabase/Auth.
// Regras que dependem do ator, alvo e lojas existentes ficam no bloco `editar` e na RPC.
export function validarEdicaoBase(body) {
  if (typeof body.id !== "string" || !UUID.test(body.id)) {
    return { ok: false, error: "Usuário informado inválido." };
  }
  const nome = temCampo(body, "nome") ? body.nome : null;
  if (nome !== null && (typeof nome !== "string" || !nome.trim() || nome.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(nome))) {
    return { ok: false, error: "O nome deve ter entre 1 e 120 caracteres válidos." };
  }
  const empresa = temCampo(body, "empresa") ? normalizarEmpresa(body.empresa) : null;
  if (temCampo(body, "empresa") && empresa === null) return { ok: false, error: empresaInvalida };
  const papel = temCampo(body, "papel") ? body.papel : null;
  if (papel !== null && (typeof papel !== "string" || !PAPEIS.includes(papel))) {
    return { ok: false, error: "Papel inválido." };
  }
  let lojas = null;
  if (temCampo(body, "lojas")) {
    if (!Array.isArray(body.lojas) || body.lojas.length === 0 || body.lojas.some((id) => typeof id !== "string" || !UUID.test(id))) {
      return { ok: false, error: "A lista de lojas deve conter IDs UUID válidos." };
    }
    lojas = body.lojas;
    if (new Set(lojas).size !== lojas.length) {
      return { ok: false, error: "A lista de lojas não pode conter repetições." };
    }
  }
  let senha = null;
  if (temCampo(body, "senha")) {
    if (typeof body.senha !== "string") return { ok: false, error: "A senha informada é inválida." };
    senha = body.senha === "" ? null : body.senha;
  }
  if (senha !== null && (senha.length < 6 || COMUNS.includes(senha.toLowerCase()))) {
    return { ok: false, error: "A senha não atende às regras mínimas." };
  }
  const exigirTroca = temCampo(body, "exigir_troca_senha") ? body.exigir_troca_senha : false;
  if (typeof exigirTroca !== "boolean") return { ok: false, error: "O indicador de troca de senha é inválido." };
  if (exigirTroca && senha === null) return { ok: false, error: "Exigir troca de senha requer uma nova senha." };
  if (nome === null && papel === null && lojas === null && senha === null && empresa === null) {
    return { ok: false, error: "Informe ao menos uma alteração." };
  }
  return {
    ok: true,
    id: body.id,
    nome: nome === null ? null : nome.trim(),
    papel,
    lojas,
    empresa,
    senha,
    exigirTroca,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

  // Quem está chamando?
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado" }, 401);
  const { data: udata, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !udata?.user) return json({ error: "Sessão inválida" }, 401);
  const caller = udata.user;
  const { data: perfilCaller, error: perfilCallerErr } = await admin.from("perfis").select("papel").eq("id", caller.id).single();
  if (perfilCallerErr || !perfilCaller) return json({ error: "Perfil do usuário não encontrado." }, 403);
  const papelCaller = perfilCaller.papel || "operador";
  const ehAdmin = papelCaller === "admin";
  // Perfis de acesso: "Gerenciar usuários" é definido pelo Administrador em papel_permissoes.
  // Quem tem a permissão (e não é admin) atua como gestor: cria/edita Operador e Assistente.
  let gerenciaUsuarios = ehAdmin;
  if (!ehAdmin) {
    const { data: perm, error: permErr } = await admin.rpc("papel_tem_permissao", { p_papel: papelCaller, p_permissao: "usuarios_gerenciar" });
    if (permErr) return json({ error: "Não foi possível verificar as permissões do perfil." }, 500);
    gerenciaUsuarios = perm === true;
  }
  const ehAnalista = papelCaller === "analista";
  // O papel legado de Analista e o Administrador são globais. A permissão de
  // gestão, inclusive para Gerente, não concede acesso a lojas não atribuídas.
  const escopoTotal = ehAdmin || ehAnalista;
  // Operador e Promotor só executam o operacional: nunca cria, edita ou lista usuários, mesmo com a permissão marcada.
  const ehOperador = papelCaller === "operador" || papelCaller === "promotor";
  const podeCriar = !ehOperador && (ehAdmin || gerenciaUsuarios || papelCaller === "assistente");
  const podeEditar = !ehOperador && (ehAdmin || gerenciaUsuarios);

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Requisição inválida" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "Requisição inválida" }, 400); }
  const acao = String(body.acao || "");
  // Domínio fixo: não confiar em configuração enviada pelo cliente.
  const dominio = "loja.validade";

  const audit = async (ac: string, detalhe: unknown) => {
    try {
      await admin.from("auditoria").insert({
        user_id: caller.id, usuario: (caller.email || "").split("@")[0],
        papel: papelCaller, acao: ac, detalhe: detalhe || {},
      });
    } catch { /* auditoria é best-effort */ }
  };
  const lojasPermitidas = async (): Promise<Set<string>> => {
    if (escopoTotal) {
      const { data, error } = await admin.from("lojas").select("id");
      if (error) throw error;
      return new Set((data || []).map((l: { id: string }) => l.id));
    }
    const { data, error } = await admin.from("loja_membros").select("loja_id").eq("user_id", caller.id);
    if (error) throw error;
    return new Set((data || []).map((m: { loja_id: string }) => m.loja_id));
  };
  // A listagem/criação conserva `escopoTotal` histórico (inclusive a permissão
  // global do Analista). A edição de vínculos do Gerente, porém, é limitada aos
  // memberships do ator; a RPC repete essa defesa e preserva vínculos ocultos.
  const lojasPermitidasEdicao = async (): Promise<{ permitidas: Set<string>; error: unknown }> => {
    if (ehAdmin || papelCaller === "analista") {
      const { data, error } = await admin.from("lojas").select("id");
      return { permitidas: new Set((data || []).map((l: { id: string }) => l.id)), error };
    }
    const { data, error } = await admin.from("loja_membros").select("loja_id").eq("user_id", caller.id);
    return { permitidas: new Set((data || []).map((m: { loja_id: string }) => m.loja_id)), error };
  };

  try {
    if (acao === "listar") {
      if (!podeCriar) return json({ error: "Sem permissão" }, 403);
      const scopeResult = resolveListScope(body);
      if (!scopeResult.ok) return json({ error: scopeResult.error }, 400);
      const { data: perfis, error: perfisErr } = await admin.from("perfis").select("id, nome, papel, empresa");
      if (perfisErr) return json({ error: "Não foi possível consultar perfis." }, 500);
      const { data: lista, error: listaErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listaErr) return json({ error: "Não foi possível consultar usuários." }, 500);
      const emailPorId: Record<string, string> = {};
      for (const u of (lista?.users || [])) emailPorId[u.id] = u.email || "";
      const { data: membros, error: membrosErr } = await admin.from("loja_membros").select("user_id, loja_id");
      const { data: lojas, error: lojasErr } = await admin.from("lojas").select("id, nome").order("nome");
      if (membrosErr || lojasErr) return json({ error: "Falha ao consultar lojas e vínculos." }, 500);
      const permitidas = await lojasPermitidas();
      const scoped = buildScopedUserList({
        scope: scopeResult.scope,
        permitidas,
        perfis: perfis || [],
        membros: membros || [],
        lojas: lojas || [],
        emailPorId,
        escopoTotal,
      });
      if (!scoped.ok) return json({ error: scoped.error }, scoped.status);
      return json({ ...scoped.data, euPapel: papelCaller });
    }

    if (acao === "criar") {
      if (!podeCriar) return json({ error: "Sem permissão para criar usuários" }, 403);
      const usuario = String(body.usuario || "").trim().toLowerCase();
      const nome = String(body.nome || "").trim();
      const senha = String(body.senha || "");
      const exigirTrocaSenha = body.exigir_troca_senha === true;
      const papel = String(body.papel || "operador");
      let lojas = Array.isArray(body.lojas) ? (body.lojas as unknown[]).map(String) : [];
      if (!validarUsuario(usuario)) return json({ error: "Usuário inválido: use 3 a 30 letras minúsculas, números ou . _ -" }, 400);
      if (!nome) return json({ error: "Informe o nome do usuário." }, 400);
      const e1 = validarSenha(senha, usuario); if (e1) return json({ error: e1 }, 400);
      if (!PAPEIS.includes(papel)) return json({ error: "Papel inválido." }, 400);
      if (!podeAtribuirPapel(papelCaller, gerenciaUsuarios, papel)) return json({ error: "Seu perfil não pode criar usuários com esse papel (Gerente até Analista; Analista até Assistente)." }, 403);
      const empresa = papel === "promotor" ? normalizarEmpresa(body.empresa) : null;
      if (papel === "promotor" && empresa === null) return json({ error: empresaInvalida }, 400);
      const permit = await lojasPermitidas();
      lojas = [...new Set(lojas)];
      if (papelCaller === "assistente" && (permit.size !== 1 || lojas.length !== 1 || !permit.has(lojas[0]))) return json({ error: "Assistente só pode cadastrar usuários na sua única loja vinculada." }, 403);
      if (!lojas.length) return json({ error: "Escolha pelo menos uma loja." }, 400);
      if (lojas.some((id) => !permit.has(id))) return json({ error: "Você tentou atribuir loja sem permissão." }, 403);
      const email = usuario + "@" + dominio;
      const { data: novo, error: cerr } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome }, app_metadata: { force_password_change: exigirTrocaSenha } });
      if (cerr || !novo?.user) {
        const dup = /already|exist|registered/i.test(cerr?.message || "");
        return json({ error: dup ? "Já existe um usuário com esse nome." : ("Não foi possível criar o usuário. " + (cerr?.message || "")) }, 400);
      }
      const uid = novo.user.id;
      const { error: perfilErr } = await admin.from("perfis").upsert({ id: uid, nome, papel, ...(empresa !== null ? { empresa } : {}) }, { onConflict: "id" });
      if (perfilErr) { await admin.auth.admin.deleteUser(uid); return json({ error: "Falha ao criar perfil." }, 500); }
      const { error: membroErr } = await admin.from("loja_membros").insert(lojas.map((lid) => ({ user_id: uid, loja_id: lid })));
      if (membroErr) { await admin.auth.admin.deleteUser(uid); return json({ error: "Falha ao vincular usuário às lojas." }, 500); }
      await audit("criou_usuario", { usuario, papel, lojas: lojas.length });
      return json({ ok: true, id: uid });
    }

    if (acao === "trocar_senha_primeiro_acesso") {
      const senha = String(body.senha || "");
      const usuario = (caller.email || "").split("@")[0];
      const appMeta = caller.app_metadata || {};
      if (appMeta.force_password_change !== true) return json({ error: "Esta conta não está marcada para troca obrigatória de senha." }, 403);
      const e1 = validarSenha(senha, usuario); if (e1) return json({ error: e1 }, 400);
      const { error: trocaErr } = await admin.auth.admin.updateUserById(caller.id, { password: senha, app_metadata: { ...appMeta, force_password_change: false } });
      if (trocaErr) return json({ error: "Não foi possível alterar a senha. " + trocaErr.message }, 400);
      await audit("troca_senha_primeiro_acesso", {});
      return json({ ok: true });
    }

    if (acao === "trocar_senha") {
      // Troca voluntária da própria senha: confere a senha atual no Auth e aplica
      // as mesmas regras do primeiro acesso. Nunca altera a conta de outra pessoa.
      const senhaAtual = String(body.senha_atual || "");
      const senha = String(body.senha || "");
      const usuario = (caller.email || "").split("@")[0];
      if (!senhaAtual || !caller.email) return json({ error: "Informe a senha atual." }, 400);
      const e1 = validarSenha(senha, usuario); if (e1) return json({ error: e1 }, 400);
      if (senha === senhaAtual) return json({ error: "A nova senha deve ser diferente da atual." }, 400);
      const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (!anon) return json({ error: "Função sem chave pública configurada." }, 500);
      const conf = await fetch(SB_URL + "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ email: caller.email, password: senhaAtual }),
      });
      if (!conf.ok) return json({ error: "A senha atual não confere." }, 403);
      const { error: trocaErr } = await admin.auth.admin.updateUserById(caller.id, { password: senha });
      if (trocaErr) return json({ error: "Não foi possível alterar a senha. " + trocaErr.message }, 400);
      await audit("trocou_senha", {});
      return json({ ok: true });
    }

    if (acao === "editar") {
      if (!podeEditar) return json({ error: "Sem permissão para editar usuários" }, 403);
      const edit = validarEdicaoBase(body);
      if (!edit.ok) return json({ error: edit.error }, 400);
      const id = edit.id;
      const { data: alvo, error: alvoErr } = await admin.from("perfis").select("papel, nome, empresa").eq("id", id).single();
      if (alvoErr || !alvo) return json({ error: "Usuário não encontrado." }, 404);
      if (!PAPEIS.includes(alvo.papel)) return json({ error: "Papel atual do usuário é inválido." }, 500);
      const alvoAuth = await admin.auth.admin.getUserById(id);
      const alvoUser = alvoAuth.data?.user;
      if (alvoAuth.error || !alvoUser) return json({ error: "Conta de autenticação do usuário não encontrada." }, 404);
      const usuarioEmail = alvoUser?.email || "";
      const usuarioNome = usuarioEmail.split("@")[0];
      const appMeta = (alvoUser?.app_metadata as Record<string, unknown>) || {};
      const nome = edit.nome;
      const senha = edit.senha;
      const exigirTroca = edit.exigirTroca;
      const papel = edit.papel;
      const lojas = edit.lojas;
      const empresa = edit.empresa;

      if ((papel != null || lojas != null) && !gerenciaUsuarios) return json({ error: "Seu perfil não pode alterar papel ou lojas." }, 403);
      // Hierarquia: Gerente administra/promove até Analista; Analista até Assistente (hierarquia.ts).
      if (!ehAdmin && !podeAdministrarPapel(papelCaller, gerenciaUsuarios, alvo.papel)) return json({ error: "Seu perfil não pode administrar usuários com esse papel." }, 403);
      if (papel != null && !podeAtribuirPapel(papelCaller, gerenciaUsuarios, papel)) return json({ error: "Seu perfil não pode atribuir esse papel (Gerente até Analista; Analista até Assistente)." }, 403);
      if (papel != null && alvo.papel === "admin" && papel !== "admin") {
        const { count, error: adminCountErr } = await admin.from("perfis").select("id", { count: "exact", head: true }).eq("papel", "admin");
        if (adminCountErr) return json({ error: "Não foi possível validar os administradores." }, 500);
        if ((count || 0) <= 1) return json({ error: "Não é possível rebaixar o último admin." }, 400);
      }
      const papelFinal = papel ?? alvo.papel;
      if (papelFinal === "promotor" && !empresa && !alvo.empresa) return json({ error: empresaInvalida }, 400);
      if (papelFinal !== "promotor" && empresa !== null) return json({ error: "Empresa é um campo do perfil Promotor." }, 400);
      if (senha != null) {
        if (!validarUsuario(usuarioNome.toLowerCase())) return json({ error: "O usuário alvo não tem um login válido para redefinir a senha." }, 400);
        const e2 = validarSenha(senha, usuarioNome); if (e2) return json({ error: e2 }, 400);
      }
      const escopoEdicaoPorMembership = !escopoTotal;
      let permitidasNaResposta: Set<string> | null = null;
      if (escopoEdicaoPorMembership || lojas != null) {
        const lojasPermitidasResult = await lojasPermitidasEdicao();
        if (lojasPermitidasResult.error) return json({ error: "Não foi possível validar o escopo de lojas." }, 500);
        permitidasNaResposta = lojasPermitidasResult.permitidas;
        if (escopoEdicaoPorMembership && papelCaller === "assistente" && lojasPermitidasResult.permitidas.size !== 1) {
          return json({ error: "Assistente precisa ter exatamente uma loja vinculada." }, 403);
        }
        if (escopoEdicaoPorMembership) {
          const { data: membrosAlvo, error: membrosAlvoErr } = await admin.from("loja_membros").select("loja_id").eq("user_id", id);
          if (membrosAlvoErr) return json({ error: "Não foi possível validar o escopo do usuário alvo." }, 500);
          if (!(membrosAlvo || []).some((m: { loja_id: string }) => lojasPermitidasResult.permitidas.has(m.loja_id))) {
            return json({ error: "Usuário alvo fora do escopo permitido." }, 403);
          }
        }
        if (lojas != null && lojas.some((lid) => !lojasPermitidasResult.permitidas.has(lid))) return json({ error: "Loja inválida ou sem permissão." }, 403);
      }

      // Nome/papel/vínculos e sua auditoria são uma única transação no banco.
      // A senha só é chamada depois do commit porque Auth é um serviço externo.
      const { data: cadastro, error: cadastroErr } = await admin.rpc("editar_usuario_atomico", {
        p_actor_id: caller.id,
        p_target_id: id,
        p_nome: nome,
        p_papel: papel,
        p_lojas: lojas,
        p_senha_solicitada: senha != null,
        p_empresa: empresa,
      });
      if (cadastroErr || !cadastro || cadastro.ok !== true) {
        return json({
          ok: false,
          cadastro_atualizado: false,
          lojas_atualizadas: false,
          senha_atualizada: false,
          parcial: false,
          error: "Não foi possível atualizar o cadastro; nenhuma alteração de cadastro foi confirmada.",
        }, 400);
      }
      const cadastroVisivel = filtrarResultadoEdicao(cadastro, escopoTotal, permitidasNaResposta);
      if (senha == null) return json({ ...cadastroVisivel, senha_atualizada: false, parcial: false }, 200);

      const { error: serr } = await admin.auth.admin.updateUserById(id, {
        password: senha,
        app_metadata: { ...appMeta, force_password_change: exigirTroca },
      });
      if (serr) {
        return json({
          ...cadastroVisivel,
          ok: true,
          cadastro_atualizado: true,
          senha_atualizada: false,
          parcial: true,
          aviso: "Cadastro e lojas atualizados, mas não foi possível alterar a senha. Tente alterar somente a senha novamente.",
        }, 200);
      }
      return json({ ...cadastroVisivel, ok: true, senha_atualizada: true, parcial: false }, 200);
    }

    if (acao === "excluir") {
      if (ehOperador) return json({ error: "Sem permissão para excluir usuários." }, 403);
      let podeExcluir = ehAdmin;
      if (!ehAdmin) {
        const { data: permExcluir, error: permExcluirErr } = await admin.rpc("papel_tem_permissao", { p_papel: papelCaller, p_permissao: "usuarios_excluir" });
        if (permExcluirErr) return json({ error: "Não foi possível verificar as permissões do perfil." }, 500);
        podeExcluir = permExcluir === true;
      }
      if (!podeExcluir) return json({ error: "Seu perfil não tem permissão para excluir usuários." }, 403);
      if (!ehAdmin) {
        const { data: targetStores } = await admin.from("loja_membros").select("loja_id").eq("user_id", String(body.id || ""));
        const allowedStores = await lojasPermitidas();
        if (!targetStores || targetStores.length === 0) return json({ error: "Não é possível excluir usuário sem vínculo de loja; valide o cadastro com Administrador." }, 403);
        if (targetStores.some((m: { loja_id: string }) => !allowedStores.has(m.loja_id))) return json({ error: "Gerente não pode excluir usuário de loja fora do seu escopo." }, 403);
        const { data: targetProfile, error: targetProfileErr } = await admin.from("perfis").select("papel").eq("id", String(body.id || "")).single();
        if (targetProfileErr || !targetProfile) return json({ error: "Perfil do usuário alvo não encontrado." }, 404);
        if (!podeAdministrarPapel(papelCaller, true, targetProfile.papel)) return json({ error: "Seu perfil não pode excluir usuários com esse papel." }, 403);
      }
      const id = String(body.id || "");
      if (!id) return json({ error: "Usuário não informado." }, 400);
      if (id === caller.id) return json({ error: "Você não pode excluir a própria conta." }, 400);
      const { data: alvo, error: alvoErr } = await admin.from("perfis").select("papel").eq("id", id).single();
      if (alvoErr || !alvo) return json({ error: "Usuário não encontrado." }, 404);
      if (alvo?.papel === "admin") {
        const { count } = await admin.from("perfis").select("id", { count: "exact", head: true }).eq("papel", "admin");
        if ((count || 0) <= 1) return json({ error: "Não é possível excluir o último admin." }, 400);
      }
      const nomeAlvo = ((await admin.auth.admin.getUserById(id)).data?.user?.email || "").split("@")[0];
      const { error: derr } = await admin.auth.admin.deleteUser(id);
      if (derr) return json({ error: "Não foi possível excluir. " + derr.message }, 400);
      await audit("excluiu_usuario", { alvo: nomeAlvo });
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    console.error("gerir-usuarios error", e);
    return json({ error: "Erro interno. Consulte os logs da função." }, 500);
  }
});
