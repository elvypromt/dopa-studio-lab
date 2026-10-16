// ИИ внутри комнаты: варианты подписи, хука, хэштегов и чат по ролику. Только студия.
// Ключ — секрет ANTHROPIC_API_KEY, в браузер не уходит. В базу ничего не пишет: что применить, решает человек.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("AI_MODEL") || "claude-sonnet-5-5";

const BRAND = `You write Instagram copy for Publora (publora.com), handle @publoramcp.
Facts you may use:
- Publora = write one post, publish to 10 networks: Instagram, LinkedIn, X, TikTok, YouTube, Threads, Facebook, Bluesky, Telegram, Mastodon. No other networks.
- Main wow: Publora connects to your AI (ChatGPT, Claude, Cursor and any AI with connectors, plus n8n/Zapier/Make). You say "post this" and your AI publishes everywhere. Never say "only ChatGPT and Claude".
- Works in your browser (web app). There is NO native/mobile app: never say "the app", "download", "push notifications".
- Agencies: client workspaces, team roles, approval by one link. Free plan exists. "From $3.99" only with "billed yearly". 100 accounts ≈ $154/mo (as of Oct 2026). "Unlimited" = 5,000 posts per account per month.
- Telegram connects via your own bot.
- Audience: creators, SMM people, agencies; devs mostly on LinkedIn/X.
- Favourite line: "Posting by hand is over."
Never write: Pinterest, API keys/tokens, "in a minute", "AI Editor", "Shorts", push notifications, native app, workspace colour, "Comment X and I'll send you Y" (no comment-to-DM bait), "only/cheapest/first" claims, invented numbers or hours saved (time savings only as an estimate).
Style: short lines, concrete, playful but not cringe, 0–2 emoji, no hashtags inside the caption body.`;

const TASK: Record<string, string> = {
  caption: `Write 3 different Instagram captions in English for this reel (each 300–700 characters: hook line, 2–4 short lines, soft CTA like "Link in bio" or "Try it free"). No hashtags. Return JSON only: {"options":["...","...","..."]}`,
  hook: `Write 6 different hook first-lines in English for this reel (max 70 characters each; curiosity, pain, or bold claim within the facts). Return JSON only: {"options":["..."]}`,
  tags: `Write 3 hashtag sets for this reel, each 5–8 hashtags in one line, mix of broad and niche, English, include #publora. Return JSON only: {"options":["#a #b ...","...","..."]}`,
  cta: `Write 5 call-to-action lines in English for the end of this caption (no comment-to-DM bait). Return JSON only: {"options":["..."]}`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!KEY) return json({ error: "ИИ ещё не подключён: нужен ключ Anthropic в секретах Supabase (ANTHROPIC_API_KEY)" }, 500);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false },
  });
  let body: any = {};
  try { body = await req.json(); } catch { /* пусто */ }
  const cid = String(body.client_id || "");
  const { data: ok } = await user.rpc("is_studio", { c: cid });
  if (!ok) return json({ error: "Только для студии" }, 403);
  const { data: r } = await user.from("reels").select("code,title,idea,caption,cta,theme,dur,status").eq("id", body.reel_id).eq("client_id", cid).maybeSingle();
  const mode = String(body.mode || "chat");
  const about = r ? `Reel ${r.code}: "${r.title}". Idea: ${r.idea || "—"}. Duration: ${r.dur || "?"} s. CTA keyword: ${r.cta || "—"}.\nCurrent caption:\n${r.caption || "(none)"}` : "No reel selected.";
  const note = String(body.note || "").slice(0, 1500);

  let messages: any[];
  let system = BRAND + "\n\n" + about;
  if (mode === "chat") {
    system += `\n\nYou are the studio's copy partner inside the client room. Answer in Russian, briefly, unless asked for English copy. Copy for Instagram itself stays in English.`;
    messages = (Array.isArray(body.messages) ? body.messages : []).slice(-16)
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Пустой вопрос" }, 400);
  } else {
    if (!TASK[mode]) return json({ error: "Неизвестный режим" }, 400);
    messages = [{ role: "user", content: TASK[mode] + (note ? `\nExtra wishes from the studio: ${note}` : "") }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages }),
  });
  const b = await res.json();
  if (!res.ok) return json({ error: "ИИ: " + (b?.error?.message || res.status) }, 502);
  const text = (b.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (mode === "chat") return json({ text });
  try { const m = text.match(/\{[\s\S]*\}/); return json({ options: JSON.parse(m ? m[0] : text).options || [] }); }
  catch { return json({ options: [text] }); }
});
