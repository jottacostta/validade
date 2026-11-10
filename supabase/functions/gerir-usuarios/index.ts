// Edge Function: gestão de usuários (criar/editar/excluir/listar)
// Roda no servidor com a service_role (NUNCA vai para o app). Identifica quem chama
// pelo JWT e aplica as regras de papel:
//   - assistente: cria usuários (sempre como operador)
//   - analista:   cria + edita cadastro (nome) e senha (não mexe em papel/lojas)
//   - admin:      faz tudo (papel, lojas, excluir)
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAPEIS = ["operador", "assistente", "analista", "gerente", "admin"];
const COMUNS = ["123456","1234567","12345678","123456789","senha","password","qwerty","111111","000000","abc123","admin123","guanabara"];

const validarUsuario = (u: string) => /^[a-z0-9._-]{3,30}$/.test(u);
function validarSenha(s: string, usuario: string): string | null {
  if (!s || s.length < 6) return "A senha precisa de pelo menos 6 caracteres.";
  if (COMUNS.includes(s.toLowerCase())) return "Essa senha é muito comum. Escolha outra.";
  if (s.toLowerCase() === usuario.toLowerCase()) return "A senha não pode ser igual ao usuário.";
  return null;
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
  const ehGerente = papelCaller === "gerente";
  const ehAnalista = papelCaller === "analista";
  const podeCriar = ["assistente", "analista", "gerente", "admin"].includes(papelCaller);
  const podeEditar = ["analista", "gerente", "admin"].includes(papelCaller);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida" }, 400); }
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
    if (["admin", "gerente", "analista"].includes(papelCaller)) {
      const { data } = await admin.from("lojas").select("id");
      return new Set((data || []).map((l: { id: string }) => l.id));
    }
    const { data } = await admin.from("loja_membros").select("loja_id").eq("user_id", caller.id);
    return new Set((data || []).map((m: { loja_id: string }) => m.loja_id));
  };

  try {
    if (acao === "listar") {
      if (!podeCriar) return json({ error: "Sem permissão" }, 403);
      const { data: perfis, error: perfisErr } = await admin.from("perfis").select("id, nome, papel");
      if (perfisErr) return json({ error: "Não foi possível consultar perfis." }, 500);
      const { data: lista, error: listaErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listaErr) return json({ error: "Não foi possível consultar usuários." }, 500);
      const emailPorId: Record<string, string> = {};
      for (const u of (lista?.users || [])) emailPorId[u.id] = u.email || "";
      const { data: membros, error: membrosErr } = await admin.from("loja_membros").select("user_id, loja_id");
      const { data: lojas, error: lojasErr } = await admin.from("lojas").select("id, nome").order("nome");
      if (membrosErr || lojasErr) return json({ error: "Falha ao consultar lojas e vínculos." }, 500);
      const permitidas = await lojasPermitidas();
      const perfisVisiveis = ["admin", "gerente", "analista"].includes(papelCaller) ? (perfis || []) : (perfis || []).filter((p: { id: string }) => (membros || []).some((m: { user_id: string; loja_id: string }) => m.user_id === p.id && permitidas.has(m.loja_id)));
      const nomeLoja: Record<string, string> = {};
      for (const l of (lojas || [])) nomeLoja[l.id] = l.nome;
      const porUser: Record<string, { id: string; nome: string }[]> = {};
      for (const m of (membros || [])) (porUser[m.user_id] = porUser[m.user_id] || []).push({ id: m.loja_id, nome: nomeLoja[m.loja_id] || "" });
      const usuarios = perfisVisiveis.map((p: { id: string; nome: string; papel: string }) => ({
        id: p.id, nome: p.nome || "", papel: p.papel,
        usuario: (emailPorId[p.id] || "").split("@")[0],
        lojas: (porUser[p.id] || []).filter((l) => ["admin", "gerente", "analista"].includes(papelCaller) || permitidas.has(l.id)),
      })).sort((a, b) => (a.usuario || "").localeCompare(b.usuario || ""));
      return json({ usuarios, lojas: (lojas || []).filter((l: { id: string }) => permitidas.has(l.id)), euPapel: papelCaller });
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
      if (papel !== "operador" && !(ehAdmin || ehGerente || ehAnalista)) return json({ error: "Seu perfil só pode criar operadores." }, 403);
      if ((ehAnalista || ehGerente) && !["operador", "assistente"].includes(papel)) return json({ error: "Analista/Gerente só pode criar operadores e assistentes." }, 403);
      const permit = await lojasPermitidas();
      lojas = [...new Set(lojas)];
      if (papelCaller === "assistente" && (permit.size !== 1 || lojas.length !== 1 || !permit.has(lojas[0]))) return json({ error: "Assistente só pode cadastrar operador na sua única loja vinculada." }, 403);
      if (!lojas.length) return json({ error: "Escolha pelo menos uma loja." }, 400);
      if (lojas.some((id) => !permit.has(id))) return json({ error: "Você tentou atribuir loja sem permissão." }, 403);
      const email = usuario + "@" + dominio;
      const { data: novo, error: cerr } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome }, app_metadata: { force_password_change: exigirTrocaSenha } });
      if (cerr || !novo?.user) {
        const dup = /already|exist|registered/i.test(cerr?.message || "");
        return json({ error: dup ? "Já existe um usuário com esse nome." : ("Não foi possível criar o usuário. " + (cerr?.message || "")) }, 400);
      }
      const uid = novo.user.id;
      const { error: perfilErr } = await admin.from("perfis").upsert({ id: uid, nome, papel }, { onConflict: "id" });
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
      const id = String(body.id || "");
      if (!id) return json({ error: "Usuário não informado." }, 400);
      const { data: alvo, error: alvoErr } = await admin.from("perfis").select("papel, nome").eq("id", id).single();
      if (alvoErr || !alvo) return json({ error: "Usuário não encontrado." }, 404);
      const alvoUser = (await admin.auth.admin.getUserById(id)).data?.user;
      const usuarioEmail = alvoUser?.email || "";
      const usuarioNome = usuarioEmail.split("@")[0];
      const appMeta = (alvoUser?.app_metadata as Record<string, unknown>) || {};
      const nome = body.nome != null ? String(body.nome).trim() : null;
      const senha = body.senha != null && String(body.senha) !== "" ? String(body.senha) : null;
      const exigirTroca = body.exigir_troca_senha === true;
      const papel = body.papel != null ? String(body.papel) : null;
      const lojas = Array.isArray(body.lojas) ? (body.lojas as unknown[]).map(String) : null;

      if ((papel != null || lojas != null) && !(ehAdmin || ehAnalista || ehGerente)) return json({ error: "Seu perfil não pode alterar papel ou lojas." }, 403);
      if ((ehAnalista || ehGerente) && papel != null && !["operador", "assistente"].includes(papel)) return json({ error: "Analista/Gerente só pode atribuir Operador ou Assistente." }, 403);
      if ((ehAnalista || ehGerente) && ["analista", "gerente", "admin"].includes(alvo.papel)) return json({ error: "Não pode administrar usuários com papel igual ou superior." }, 403);
      if (papel != null && !PAPEIS.includes(papel)) return json({ error: "Papel inválido." }, 400);
      if (papel != null && alvo.papel === "admin" && papel !== "admin") {
        const { count } = await admin.from("perfis").select("id", { count: "exact", head: true }).eq("papel", "admin");
        if ((count || 0) <= 1) return json({ error: "Não é possível rebaixar o último admin." }, 400);
      }
      if (senha != null) { const e2 = validarSenha(senha, usuarioNome); if (e2) return json({ error: e2 }, 400); }
      if (nome != null && !nome) return json({ error: "O nome não pode ficar vazio." }, 400);

      const upd: Record<string, unknown> = {};
      if (nome != null) upd.nome = nome;
      if (papel != null) upd.papel = papel;
      if (Object.keys(upd).length) {
        const { error: perr } = await admin.from("perfis").update(upd).eq("id", id);
        if (perr) return json({ error: "Não foi possível atualizar o cadastro. " + perr.message }, 400);
      }
      if (senha != null) {
        // Admin redefine a senha; opcionalmente exige que o usuário troque no próximo acesso.
        const { error: serr } = await admin.auth.admin.updateUserById(id, { password: senha, app_metadata: { ...appMeta, force_password_change: exigirTroca } });
        if (serr) return json({ error: "Não foi possível trocar a senha. " + serr.message }, 400);
      }
      if (lojas != null) {
        const uniq = [...new Set(lojas)];
        if (!uniq.length) return json({ error: "O usuário precisa ter ao menos uma loja." }, 400);
        const permit = await lojasPermitidas();
        if (uniq.some((lid) => !permit.has(lid))) return json({ error: "Loja inválida ou sem permissão." }, 400);
        const { error: delErr } = await admin.from("loja_membros").delete().eq("user_id", id);
        if (delErr) return json({ error: "Falha ao remover vínculos anteriores." }, 500);
        const { error: insErr } = await admin.from("loja_membros").insert(uniq.map((lid) => ({ user_id: id, loja_id: lid })));
        if (insErr) return json({ error: "Falha ao salvar vínculos." }, 500);
      }
      await audit("editou_usuario", { alvo: usuarioNome, trocou_senha: senha != null, exigir_troca_senha: senha != null ? exigirTroca : undefined, papel: papel || undefined });
      return json({ ok: true });
    }

    if (acao === "excluir") {
      if (!(ehAdmin || ehGerente)) return json({ error: "Somente Gerente ou Administrador pode excluir usuários." }, 403);
      if (ehGerente) {
        const { data: targetStores } = await admin.from("loja_membros").select("loja_id").eq("user_id", String(body.id || ""));
        const allowedStores = await lojasPermitidas();
        if (!targetStores || targetStores.length === 0) return json({ error: "Não é possível excluir usuário sem vínculo de loja; valide o cadastro com Administrador." }, 403);
        if (targetStores.some((m: { loja_id: string }) => !allowedStores.has(m.loja_id))) return json({ error: "Gerente não pode excluir usuário de loja fora do seu escopo." }, 403);
        const { data: targetProfile, error: targetProfileErr } = await admin.from("perfis").select("papel").eq("id", String(body.id || "")).single();
        if (targetProfileErr || !targetProfile) return json({ error: "Perfil do usuário alvo não encontrado." }, 404);
        if (["admin", "gerente"].includes(targetProfile.papel)) return json({ error: "Gerente não pode excluir Administrador ou outro Gerente." }, 403);
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
