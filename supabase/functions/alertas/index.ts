import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { montarPushValidade } from "./validade-push.mjs";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-alertas-cron-secret",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "content-type": "application/json; charset=utf-8" },
});
const env = (key: string) => Deno.env.get(key) ?? "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a), bb = enc.encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
function cronAuthorized(req: Request): boolean {
  const expected = env("ALERTAS_CRON_SECRET");
  const supplied = req.headers.get("x-alertas-cron-secret") ?? "";
  return !!expected && constantTimeEqual(supplied, expected);
}
async function authenticatedUser(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}
function papelTemEscopoGlobal(papel: string): boolean {
  // O Gerente pode receber avisos de todas as suas lojas atribuídas, nunca da
  // rede inteira, mesmo quando `avisos_todas_lojas` foi habilitado no papel.
  return papel === "admin" || papel === "analista";
}

async function escopoLojasDoUsuario(userId: string): Promise<{ global: boolean; ids: Set<string> } | null> {
  const { data: perfil, error: perfilErr } = await admin.from("perfis").select("papel").eq("id", userId).maybeSingle();
  if (perfilErr || !perfil) return null;
  if (papelTemEscopoGlobal(perfil.papel)) {
    const { data: lojas, error: lojasErr } = await admin.from("lojas").select("id");
    if (lojasErr) return null;
    return { global: true, ids: new Set((lojas || []).map((loja: { id: string }) => loja.id)) };
  }
  const { data: membros, error: membrosErr } = await admin.from("loja_membros").select("loja_id").eq("user_id", userId);
  if (membrosErr) return null;
  return { global: false, ids: new Set((membros || []).map((membro: { loja_id: string }) => membro.loja_id)) };
}

// Vinculado à loja, ou Admin/Analista em uma loja que existe.
async function isMember(userId: string, lojaId: string) {
  const { data, error } = await admin.from("loja_membros").select("loja_id")
    .eq("user_id", userId).eq("loja_id", lojaId).maybeSingle();
  if (!error && data) return true;
  const { data: perfil, error: perfilErr } = await admin.from("perfis").select("papel").eq("id", userId).maybeSingle();
  if (perfilErr || !perfil) return false;
  // Mantém a permissão histórica como uma segunda barreira, mas ela nunca
  // transforma Gerente em global: o papel permitido é validado explicitamente.
  const { data: global, error: permErr } = await admin.rpc("papel_tem_permissao", { p_papel: perfil.papel, p_permissao: "avisos_todas_lojas" });
  if (permErr || global !== true) return false;
  if (!papelTemEscopoGlobal(perfil.papel)) return false;
  const { data: loja, error: lojaErr } = await admin.from("lojas").select("id").eq("id", lojaId).maybeSingle();
  return !lojaErr && !!loja;
}
function validPushEndpoint(value: string): boolean {
  if (!value || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"]
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "public-key") {
    const key = env("VAPID_PUBLIC_KEY");
    return key ? json({ publicKey: key }) : json({ error: "Push não configurado" }, 503);
  }
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const action = body.action;

  if (action === "generate-alerts") {
    if (!cronAuthorized(req)) return json({ error: "Não autorizado" }, 401);
    const { data, error } = await admin.rpc("gerar_alertas_validade");
    if (error) return json({ error: "Falha ao gerar alertas internos" }, 500);
    return json({ ok: true, gerados: Array.isArray(data) ? data.length : 0 });
  }

  if (action === "dispatch") {
    if (!cronAuthorized(req)) return json({ error: "Não autorizado" }, 401);
    const publicKey = env("VAPID_PUBLIC_KEY"), privateKey = env("VAPID_PRIVATE_KEY"), subject = env("VAPID_SUBJECT");
    if (!publicKey || !privateKey || !subject) return json({ error: "Credenciais VAPID não configuradas" }, 503);
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const { error: prepareError } = await admin.rpc("preparar_alertas_push");
    if (prepareError) return json({ error: "Falha ao preparar fila Push" }, 500);
    const { error: internalPrepareError } = await admin.rpc("preparar_alertas_push_internos");
    if (internalPrepareError) return json({ error: "Falha ao preparar Push interno" }, 500);
    const [personalClaim, internalClaim] = await Promise.all([
      admin.rpc("reivindicar_alertas_push", { p_limite: 100 }),
      admin.rpc("reivindicar_alertas_push_internos", { p_limite: 100 }),
    ]);
    if (personalClaim.error || internalClaim.error) return json({ error: "Falha ao reivindicar fila Push" }, 500);
    const notifications = [
      ...(Array.isArray(personalClaim.data) ? personalClaim.data.map((n) => ({ ...n, push_kind: "personal" })) : []),
      ...(Array.isArray(internalClaim.data) ? internalClaim.data.map((n) => ({ ...n, push_kind: "internal" })) : []),
    ];
    let enviados = 0, removidas = 0, falhas = 0;
    for (const notification of notifications) {
      const { data: subscriptions, error } = await admin.from("push_subscriptions")
        .select("id,endpoint,p256dh,auth").eq("owner_id", notification.user_id);
      if (error) {
        falhas++;
        const rpc = notification.push_kind === "internal" ? "registrar_resultado_alerta_push_interno" : "registrar_resultado_alerta_push";
        await admin.rpc(rpc, { p_id: notification.id, p_ok: false, p_erro: "falha ao consultar subscriptions" });
        continue;
      }
      const payload = JSON.stringify(montarPushValidade(notification));
      let eventFailed = false;
      for (const sub of subscriptions ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          enviados++;
        } catch (e) {
          const status = Number((e as { statusCode?: number }).statusCode ?? 0);
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
            removidas++;
          } else { falhas++; eventFailed = true; }
        }
      }
      if (!subscriptions?.length) eventFailed = true;
      const rpc = notification.push_kind === "internal" ? "registrar_resultado_alerta_push_interno" : "registrar_resultado_alerta_push";
      await admin.rpc(rpc, { p_id: notification.id, p_ok: !eventFailed, p_erro: eventFailed ? "uma ou mais entregas Push falharam" : null });
    }
    return json({ notificacoes: notifications.length, enviados, removidas, falhas });
  }

  // Push de um alerta personalizado: só o remetente, só de um envio recente gravado por
  // public.enviar_alerta_personalizado (que já validou a permissão `alertas_enviar`).
  if (action === "custom-push") {
    const user = await authenticatedUser(req);
    if (!user) return json({ error: "JWT inválido" }, 401);
    const envioId = typeof body.envioId === "string" ? body.envioId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envioId)) return json({ error: "Envio inválido" }, 400);
    const publicKey = env("VAPID_PUBLIC_KEY"), privateKey = env("VAPID_PRIVATE_KEY"), subject = env("VAPID_SUBJECT");
    if (!publicKey || !privateKey || !subject) return json({ error: "Credenciais VAPID não configuradas" }, 503);
    const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const escopo = await escopoLojasDoUsuario(user.id);
    if (!escopo) return json({ error: "Não foi possível validar o escopo do usuário" }, 500);
    if (!escopo.global && escopo.ids.size === 0) return json({ error: "Envio não encontrado" }, 404);
    let envioQuery = admin.from("notificacoes").select("user_id,loja_id,titulo,mensagem")
      .eq("tipo", "sistema_personalizado").eq("payload->>envio_id", envioId).eq("payload->>remetente_id", user.id)
      .gte("criado", desde).limit(5000);
    if (!escopo.global) envioQuery = envioQuery.in("loja_id", [...escopo.ids]);
    const { data: rows, error } = await envioQuery;
    if (error) return json({ error: "Falha ao consultar o envio" }, 500);
    if (!rows || rows.length === 0) return json({ error: "Envio não encontrado" }, 404);
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const payload = JSON.stringify({ title: rows[0].titulo, body: rows[0].mensagem, tag: `personalizado-${envioId}`, data: { tipo: "sistema_personalizado" } });
    const ids = [...new Set(rows.map((r: { user_id: string }) => r.user_id))];
    let enviados = 0, removidas = 0, falhas = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data: subs, error: subsErr } = await admin.from("push_subscriptions")
        .select("id,endpoint,p256dh,auth").in("owner_id", ids.slice(i, i + 200));
      if (subsErr) { falhas++; continue; }
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          enviados++;
        } catch (e) {
          const status = Number((e as { statusCode?: number }).statusCode ?? 0);
          if (status === 404 || status === 410) { await admin.from("push_subscriptions").delete().eq("id", sub.id); removidas++; }
          else falhas++;
        }
      }
    }
    return json({ destinatarios: ids.length, enviados, removidas, falhas });
  }

  if (action !== "subscribe" && action !== "unsubscribe") return json({ error: "Ação inválida" }, 400);
  const user = await authenticatedUser(req);
  if (!user) return json({ error: "JWT inválido" }, 401);
  const lojaId = typeof body.lojaId === "string" ? body.lojaId : "";
  if (!lojaId || !await isMember(user.id, lojaId)) return json({ error: "Loja inválida ou sem vínculo" }, 403);

  if (action === "unsubscribe") {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!validPushEndpoint(endpoint)) return json({ error: "Endpoint inválido" }, 400);
    const { error } = await admin.from("push_subscriptions").delete()
      .eq("owner_id", user.id).eq("endpoint", endpoint);
    return error ? json({ error: "Não foi possível remover a inscrição" }, 500) : json({ ok: true });
  }
  const subscription = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
  const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh : "";
  const auth = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth : "";
  if (!validPushEndpoint(endpoint) || !p256dh || p256dh.length > 256 || !auth || auth.length > 256) return json({ error: "Inscrição inválida" }, 400);
  const { data: existing, error: lookupError } = await admin.from("push_subscriptions")
    .select("id,owner_id").eq("endpoint", endpoint).maybeSingle();
  if (lookupError) return json({ error: "Não foi possível validar a inscrição" }, 500);
  if (existing && existing.owner_id !== user.id) return json({ error: "Endpoint já vinculado a outra conta" }, 409);
  const write = existing
    ? await admin.from("push_subscriptions").update({ p256dh, auth }).eq("id", existing.id).eq("owner_id", user.id)
    : await admin.from("push_subscriptions").insert({ owner_id: user.id, endpoint, p256dh, auth });
  const { error } = write;
  return error ? json({ error: "Não foi possível salvar a inscrição" }, 500) : json({ ok: true });
});
