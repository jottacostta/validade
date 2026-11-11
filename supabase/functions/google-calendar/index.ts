import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classificarFalhaToken, reconciliarEventoCalendar } from "./sync-logic.mjs";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const RETURN_URL = "https://jottacostta.github.io/validade/";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const env = (key: string) => Deno.env.get(key) ?? "";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const redirect = (state: "connected" | "error", code?: string) => Response.redirect(`${RETURN_URL}?calendar_oauth=${state}${code ? `&error=${encodeURIComponent(code)}` : ""}`, 302);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const hex = (bytes: Uint8Array) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
async function key() {
  const raw = unb64(env("GOOGLE_CALENDAR_TOKEN_KEY"));
  if (raw.length !== 32) throw new Error("token_key_invalid");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  return { refresh_token_ciphertext: b64(new Uint8Array(data)), refresh_token_iv: b64(iv) };
}
async function decrypt(row: { refresh_token_ciphertext: string; refresh_token_iv: string }) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.refresh_token_iv) }, await key(), unb64(row.refresh_token_ciphertext));
  return new TextDecoder().decode(data);
}
async function userFromRequest(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}
async function googleToken(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(classificarFalhaToken(body.grant_type, data?.error));
  return data;
}
async function accessToken(connection: { refresh_token_ciphertext: string; refresh_token_iv: string }) {
  const refresh = await decrypt(connection);
  const token = await googleToken({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: refresh, grant_type: "refresh_token" });
  return token.access_token as string;
}
async function api(token: string, method: string, url: string, body?: unknown) {
  return fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function dateTime(iso: string, timeZone: string) { return { dateTime: iso, timeZone }; }
async function limited<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, async () => { while (next < items.length) { const i = next++; await worker(items[i]); } }));
}

// Deploy: supabase functions deploy google-calendar --no-verify-jwt para permitir o callback GET público.
// A opção não substitui a autenticação: todas as ações POST validam o Bearer com admin.auth.getUser.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "callback") {
    const error = url.searchParams.get("error");
    if (error) return redirect("error", "google_denied");
    const code = url.searchParams.get("code") ?? "", state = url.searchParams.get("state") ?? "";
    if (!code || !state || code.length > 4096 || state.length > 256) return redirect("error", "invalid_callback");
    try {
      const { data: uid, error: stateError } = await admin.rpc("consumir_google_calendar_state", { p_hash: await sha(state) });
      if (stateError || !uid) return redirect("error", "invalid_or_expired_state");
      const token = await googleToken({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: env("GOOGLE_CALENDAR_REDIRECT_URI"), grant_type: "authorization_code" });
      if (!token.refresh_token) return redirect("error", "offline_consent_required");
      const encrypted = await encrypt(token.refresh_token);
      const { error: saveError } = await admin.from("google_calendar_connections").upsert({ user_id: uid, ...encrypted, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (saveError) return redirect("error", "connection_save_failed");
      return redirect("connected");
    } catch { return redirect("error", "oauth_failed"); }
  }
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Não autorizado" }, 401);
  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const action = body.action;
  if (!["status", "authorize", "sync", "disconnect"].includes(action ?? "")) return json({ error: "Ação inválida" }, 400);
  try {
    const { data: connection, error: connectionError } = await admin.from("google_calendar_connections").select("user_id,last_synced_at,refresh_token_ciphertext,refresh_token_iv").eq("user_id", user.id).maybeSingle();
    if (connectionError) return json({ error: "Falha ao consultar Calendar" }, 500);
    if (action === "status") return json({ connected: !!connection, last_synced_at: connection?.last_synced_at ?? null });
    if (action === "authorize") {
      const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "GOOGLE_CALENDAR_TOKEN_KEY"];
      if (required.some((k) => !env(k))) return json({ error: "Google Calendar não configurado" }, 503);
      try { if (new URL(env("GOOGLE_CALENDAR_REDIRECT_URI")).protocol !== "https:") return json({ error: "Callback HTTPS obrigatório" }, 503); } catch { return json({ error: "Callback inválido" }, 503); }
      const state = b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const { error } = await admin.from("google_calendar_oauth_states").insert({ state_hash: await sha(state), user_id: user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (error) return json({ error: "Falha ao iniciar OAuth" }, 500);
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: env("GOOGLE_CALENDAR_REDIRECT_URI"), response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state }).toString();
      return json({ url: auth.toString() });
    }
    if (action === "disconnect") {
      if (connection) {
        try { const refresh = await decrypt(connection); await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }) }); } catch { /* revogação remota best-effort; remoção local prevalece */ }
        await admin.from("google_calendar_event_map").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "active");
        const { error } = await admin.from("google_calendar_connections").delete().eq("user_id", user.id);
        if (error) return json({ error: "Falha ao remover conexão" }, 500);
      }
      return json({ ok: true });
    }
    if (!connection) return json({ created: 0, updated: 0, deleted: 0, failed: 0, skipped: 0, connected: false });
    let token: string;
    try { token = await accessToken(connection); }
    catch (error) {
      if (error instanceof Error && error.message === "refresh_token_revoked") {
        await admin.from("google_calendar_connections").delete().eq("user_id", user.id);
        return json({ error: "refresh_token_revoked", code: "refresh_token_revoked", connected: false }, 409);
      }
      return json({ error: "google_token_refresh_failed", connected: true }, 502);
    }
    const { data: desired, error: projectionError } = await admin.rpc("projetar_google_calendar", { p_user: user.id });
    if (projectionError || !Array.isArray(desired)) return json({ error: "Falha ao projetar alertas" }, 500);
    const { data: existing, error: mapError } = await admin.from("google_calendar_event_map").select("dedupe_key,event_id,payload_hash,start_at,status").eq("user_id", user.id);
    if (mapError) return json({ error: "Falha ao consultar mapeamentos" }, 500);
    const old = new Map((existing ?? []).map((row) => [row.dedupe_key, row]));
    const desiredKeys = new Set(desired.map((row: any) => row.dedupe_key));
    const counts = { created: 0, updated: 0, deleted: 0, failed: 0, skipped: 0, connected: true };
    const tasks: Array<() => Promise<void>> = [];
    for (const row of desired) {
      const canonical = JSON.stringify({ start: row.start_at, end: row.end_at, title: row.title, description: row.description });
      const payloadHash = await sha(canonical);
      const prior = old.get(row.dedupe_key);
      const activePrior = prior?.status === "active" ? prior : null;
      tasks.push(async () => {
        const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${row.event_id}`;
        const event = { summary: row.title, description: row.description, start: dateTime(row.start_at, row.time_zone), end: dateTime(row.end_at, row.time_zone) };
        const result = await reconciliarEventoCalendar({
          priorAtivo: !!activePrior,
          payloadIgual: activePrior?.payload_hash === payloadHash,
          consultar: () => api(token, "GET", eventUrl),
          inserir: () => api(token, "POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events", { id: row.event_id, ...event }),
          atualizar: () => api(token, "PATCH", eventUrl, event),
        });
        if (result.tipo === "failed") { counts.failed++; return; }
        if (result.tipo === "skipped") { counts.skipped++; return; }
        const { error } = await admin.from("google_calendar_event_map").upsert({ user_id: user.id, dedupe_key: row.dedupe_key, event_id: row.event_id, payload_hash: payloadHash, start_at: row.start_at, status: "active", updated_at: new Date().toISOString() }, { onConflict: "user_id,dedupe_key" });
        if (error) counts.failed++; else if (result.tipo === "updated") counts.updated++; else counts.created++;
      });
    }
    for (const [key, prior] of old) if (prior.status === "active" && !desiredKeys.has(key) && new Date(prior.start_at).getTime() > Date.now()) tasks.push(async () => {
      const response = await api(token, "DELETE", `https://www.googleapis.com/calendar/v3/calendars/primary/events/${prior.event_id}`);
      if (response.ok || response.status === 404 || response.status === 410) {
        const { error } = await admin.from("google_calendar_event_map").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("dedupe_key", key);
        if (error) counts.failed++; else counts.deleted++;
      } else counts.failed++;
    });
    await limited(tasks, async (task) => { try { await task(); } catch { counts.failed++; } });
    await admin.from("google_calendar_connections").update({ last_synced_at: new Date().toISOString() }).eq("user_id", user.id);
    return json(counts);
  } catch { return json({ error: "Falha na operação Calendar" }, 500); }
});
