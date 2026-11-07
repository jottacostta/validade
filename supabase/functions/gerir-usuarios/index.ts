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

const PAPEIS = ["operador", "assistente", "analista", "admin"];
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
  const { data: perfilCaller } = await admin.from("perfis").select("papel").eq("id", caller.id).single();
  const papelCaller = perfilCaller?.papel || "operador";
  const ehAdmin = papelCaller === "admin";
  const podeCriar = ["assistente", "analista", "admin"].includes(papelCaller);
  const podeEditar = ["analista", "admin"].includes(papelCaller);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida" }, 400); }
  const acao = String(body.acao || "");
  const dominio = String(body.dominio || "loja.validade").trim();

  const audit = async (ac: string, detalhe: unknown) => {
    try {
      await admin.from("auditoria").insert({
        user_id: caller.id, usuario: (caller.email || "").split("@")[0],
        papel: papelCaller, acao: ac, detalhe: detalhe || {},
      });
    } catch { /* auditoria é best-effort */ }
  };
  const lojasPermitidas = async (): Promise<Set<string>> => {
    if (ehAdmin || papelCaller === "analista") {
      const { data } = await admin.from("lojas").select("id");
      return new Set((data || []).map((l: { id: string }) => l.id));
    }
    const { data } = await admin.from("loja_membros").select("loja_id").eq("user_id", caller.id);
    return new Set((data || []).map((m: { loja_id: string }) => m.loja_id));
  };

  try {
    if (acao === "listar") {
      if (!podeCriar) return json({ error: "Sem permissão" }, 403);
      const { data: perfis } = await admin.from("perfis").select("id, nome, papel");
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const emailPorId: Record<string, string> = {};
      for (const u of (lista?.users || [])) emailPorId[u.id] = u.email || "";
      const { data: membros } = await admin.from("loja_membros").select("user_id, loja_id");
      const { data: lojas } = await admin.from("lojas").select("id, nome").order("nome");
      const nomeLoja: Record<string, string> = {};
      for (const l of (lojas || [])) nomeLoja[l.id] = l.nome;
      const porUser: Record<string, { id: string; nome: string }[]> = {};
      for (const m of (membros || [])) (porUser[m.user_id] = porUser[m.user_id] || []).push({ id: m.loja_id, nome: nomeLoja[m.loja_id] || "" });
      const usuarios = (perfis || []).map((p: { id: string; nome: string; papel: string }) => ({
        id: p.id, nome: p.nome || "", papel: p.papel,
        usuario: (emailPorId[p.id] || "").split("@")[0], lojas: porUser[p.id] || [],
      })).sort((a, b) => (a.usuario || "").localeCompare(b.usuario || ""));
      return json({ usuarios, lojas: lojas || [], euPapel: papelCaller });
    }

    if (acao === "criar") {
      if (!podeCriar) return json({ error: "Sem permissão para criar usuários" }, 403);
      const usuario = String(body.usuario || "").trim().toLowerCase();
      const nome = String(body.nome || "").trim();
      const senha = String(body.senha || "");
      const papel = String(body.papel || "operador");
      let lojas = Array.isArray(body.lojas) ? (body.lojas as unknown[]).map(String) : [];
      if (!validarUsuario(usuario)) return json({ error: "Usuário inválido: use 3 a 30 letras minúsculas, números ou . _ -" }, 400);
      if (!nome) return json({ error: "Informe o nome do usuário." }, 400);
      const e1 = validarSenha(senha, usuario); if (e1) return json({ error: e1 }, 400);
      if (!PAPEIS.includes(papel)) return json({ error: "Papel inválido." }, 400);
      if (papel !== "operador" && !ehAdmin) return json({ error: "Somente admin define papéis diferentes de Operador." }, 403);
      const permit = await lojasPermitidas();
      lojas = [...new Set(lojas)].filter((id) => permit.has(id));
      if (!lojas.length) return json({ error: "Escolha pelo menos uma loja (dentre as que você pode atribuir)." }, 400);
      const email = usuario + "@" + dominio;
      const { data: novo, error: cerr } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
      if (cerr || !novo?.user) {
        const dup = /already|exist|registered/i.test(cerr?.message || "");
        return json({ error: dup ? "Já existe um usuário com esse nome." : ("Não foi possível criar o usuário. " + (cerr?.message || "")) }, 400);
      }
      const uid = novo.user.id;
      await admin.from("perfis").upsert({ id: uid, nome, papel }, { onConflict: "id" });
      await admin.from("loja_membros").insert(lojas.map((lid) => ({ user_id: uid, loja_id: lid })));
      await audit("criou_usuario", { usuario, papel, lojas: lojas.length });
      return json({ ok: true, id: uid });
    }

    if (acao === "editar") {
      if (!podeEditar) return json({ error: "Sem permissão para editar usuários" }, 403);
      const id = String(body.id || "");
      if (!id) return json({ error: "Usuário não informado." }, 400);
      const { data: alvo } = await admin.from("perfis").select("papel, nome").eq("id", id).single();
      if (!alvo) return json({ error: "Usuário não encontrado." }, 404);
      const usuarioEmail = (await admin.auth.admin.getUserById(id)).data?.user?.email || "";
      const usuarioNome = usuarioEmail.split("@")[0];
      const nome = body.nome != null ? String(body.nome).trim() : null;
      const senha = body.senha != null && String(body.senha) !== "" ? String(body.senha) : null;
      const papel = body.papel != null ? String(body.papel) : null;
      const lojas = Array.isArray(body.lojas) ? (body.lojas as unknown[]).map(String) : null;

      if ((papel != null || lojas != null) && !ehAdmin) return json({ error: "Somente admin altera papel ou lojas." }, 403);
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
        const { error: serr } = await admin.auth.admin.updateUserById(id, { password: senha });
        if (serr) return json({ error: "Não foi possível trocar a senha. " + serr.message }, 400);
      }
      if (lojas != null) {
        const uniq = [...new Set(lojas)];
        await admin.from("loja_membros").delete().eq("user_id", id);
        if (uniq.length) await admin.from("loja_membros").insert(uniq.map((lid) => ({ user_id: id, loja_id: lid })));
      }
      await audit("editou_usuario", { alvo: usuarioNome, trocou_senha: senha != null, papel: papel || undefined });
      return json({ ok: true });
    }

    if (acao === "excluir") {
      if (!ehAdmin) return json({ error: "Somente admin pode excluir usuários." }, 403);
      const id = String(body.id || "");
      if (!id) return json({ error: "Usuário não informado." }, 400);
      if (id === caller.id) return json({ error: "Você não pode excluir a própria conta." }, 400);
      const { data: alvo } = await admin.from("perfis").select("papel").eq("id", id).single();
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
    return json({ error: "Erro interno: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
