// Вход по личному коду: код → участник → одноразовый токен Supabase Auth.
// Писем не шлём: generateLink только создаёт токен, браузер сам обменивает его на сессию.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let code = "";
  try { code = String((await req.json()).code || ""); } catch { /* пусто */ }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 8 || code.length > 32) return json({ error: "Код не подошёл" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: m } = await admin.from("members")
    .select("id, email, user_id, active").eq("code_hash", await sha256(code)).maybeSingle();
  if (!m || !m.active) {
    await new Promise((r) => setTimeout(r, 800)); // притормаживаем перебор
    return json({ error: "Код не подошёл" }, 401);
  }

  let userId = m.user_id as string | null;
  if (!userId) {
    const { data: u, error } = await admin.auth.admin.createUser({ email: m.email, email_confirm: true });
    if (error) return json({ error: "Не получилось создать вход" }, 500);
    userId = u.user.id;
  }

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: m.email });
  if (le || !link?.properties?.hashed_token) return json({ error: "Не получилось войти" }, 500);

  await admin.from("members").update({ user_id: userId, last_login: new Date().toISOString() }).eq("id", m.id);
  return json({ token_hash: link.properties.hashed_token });
});
