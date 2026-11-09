import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
async function authenticatedUser(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}
async function isMember(userId: string, lojaId: string) {
  const { data, error } = await admin.from("loja_membros").select("loja_id")
    .eq("user_id", userId).eq("loja_id", lojaId).maybeSingle();
  return !error && !!data;
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

  if (action === "dispatch") {
    const expected = env("ALERTAS_CRON_SECRET");
    const supplied = req.headers.get("x-alertas-cron-secret") ?? "";
    if (!expected || !constantTimeEqual(supplied, expected)) return json({ error: "Não autorizado" }, 401);
    const publicKey = env("VAPID_PUBLIC_KEY"), privateKey = env("VAPID_PRIVATE_KEY"), subject = env("VAPID_SUBJECT");
    if (!publicKey || !privateKey || !subject) return json({ error: "Credenciais VAPID não configuradas" }, 503);
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const { data: inserted, error: rpcError } = await admin.rpc("gerar_alertas_validade");
    if (rpcError) return json({ error: "Falha ao gerar alertas" }, 500);
    const notifications = Array.isArray(inserted) ? inserted : [];
    let enviados = 0, removidas = 0, falhas = 0;
    for (const notification of notifications) {
      const { data: subscriptions, error } = await admin.from("push_subscriptions")
        .select("id,endpoint,p256dh,auth").eq("owner_id", notification.user_id);
      if (error) { falhas++; continue; }
      const payload = JSON.stringify({ title: notification.titulo, body: notification.mensagem, data: notification.payload });
      for (const sub of subscriptions ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          enviados++;
        } catch (e) {
          const status = Number((e as { statusCode?: number }).statusCode ?? 0);
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
            removidas++;
          } else falhas++;
        }
      }
    }
    return json({ notificacoes: notifications.length, enviados, removidas, falhas });
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
