// ИИ внутри комнаты: варианты подписи, хука, хэштегов, ответов, обложки (видит эталонную серию и соседние обложки) и чат по ролику. Только студия.
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
  guide: `The reel ends with "comment KEYWORD". Everyone who comments gets an automatic Instagram DM with a free guide. Using the guide brief from the studio below, write:
1) "reply": the DM text (English, 250–450 characters, friendly, thanks them, 1 line on what's inside, then the placeholder [LINK] on its own line, then one soft line about trying Publora free in the browser). No hashtags.
2) "body": the guide itself in Markdown (English, 350–700 words): title, 1-line promise, numbered practical steps with concrete examples (e.g. exact prompts to say to your AI), a short "Common mistakes" list, and a final line "Start free at publora.com". Only facts from the brand notes; no invented numbers, no time promises anywhere (no "in 2 minutes", "in seconds", "in a minute"), no headline about speed.
Return JSON only: {"reply":"...","body":"..."}`,
  dm: `People comment the keyword under the reel and get an automatic Instagram DM with the guide. Using the brief below, write 3 different DM texts (English, 200–450 characters each; variant 1 warm and simple, variant 2 playful, variant 3 short and to the point). Each: thanks them, 1 line on what's inside, the placeholder [LINK] on its own line, one soft line about trying Publora free in the browser. No hashtags. Return JSON only: {"options":["...","...","..."]}`,
  reply: `Someone wrote to @publoramcp (the message and where it came from are below). Write 5 different replies in English, as the Publora team: human, warm, a bit playful, never salesy. Comment replies: max 150 characters, no links (say "link in bio" or "check your DMs" only if it fits). DM replies: max 400 characters, may end with a soft question. If they ask something not covered by the facts, answer honestly and offer to check with the team; never invent features, prices or numbers. Always reply in English. Return JSON only: {"options":["..."]}`,
  broadcast: `Write 3 different broadcast messages in English for Publora's followers (Instagram broadcast channel / DM to subscribers / Telegram channel), about the topic below. Each 250–600 characters: hook first line, 2–4 short lines of value, one clear soft call to action (e.g. "Try it free in your browser: publora.com"). Variant 1 news-style, variant 2 friendly story, variant 3 ultra short. 0–2 emoji. Return JSON only: {"options":["...","...","..."]}`,
  cover: `Design 3 different Instagram Reels covers for THIS reel, in the house cover series shown in the images (labelled). Study them closely: near-black background #070708 with faint grid, small pill tag in mono caps with a green dot, a big white heavy headline (often a question or a punchy statement), green #2FD27A used sparingly as the only accent (one word, a slab, a dot or a giant number), small mono lines starting with "→", official Publora logo + publora.com at the bottom. Black/white/green only, no lime, no colored logos, no emoji on the cover.
Hard rules: covers next to each other in the feed must differ in COMPOSITION, not just text (look at the neighbour covers and the already posted ones and choose a different layout and accent). Headline max ~6 words, readable as a thumbnail. Use only facts from the brand notes. If a frame from the video is attached, say whether it is worth using as the background.
Layouts the room can draw: "top" (tag + headline at the top, mono lines below, frame/grid shows in the lower part), "low" (visual/frame on top, text block low), "big" (giant short word or number in the centre, 1–4 characters like "$0" or "10", small mono question above it, headline under it).
For each option return: layout, tag (1–2 words, caps), h (headline, use \n for line breaks), accent (one word or short phrase from h to colour green, or ""), slab (2–3 words on a green tilted slab, or ""; use slab rarely), big (only for layout "big", else ""), lines (0–3 short mono lines without the arrow), frame (true if the video frame should be the background), why (one sentence in Russian: idea and how it differs from the neighbours).
Return JSON only: {"options":[{"layout":"top","tag":"","h":"","accent":"","slab":"","big":"","lines":[],"frame":false,"why":""}]}`,
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
  } else if (mode === "cover") {
    const content: any[] = [];
    const img = (label: string, b64: string) => { content.push({ type: "text", text: label }); content.push({ type: "image", source: { type: "base64", media_type: b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("UklG") ? "image/webp" : "image/jpeg", data: b64 } }); };
    const b64 = async (p: string) => { const { data } = await user.storage.from("cabinet").download(p); if (!data) return null; const u = new Uint8Array(await data.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    for (const [n, t] of [["about_stop", "About us (posted)"], ["works_low", "Works with (posted)"], ["price_zero", "Pricing"], ["howto_route", "How to use"], ["ig_formats", "IG formats"]]) {
      const d = await b64(`${cid}/brand/covers/${n}.jpg`); if (d) img(`House series reference: ${t}`, d);
    }
    const { data: all } = await user.from("reels").select("id,code,title,day,status,poster_path").eq("client_id", cid).not("poster_path", "is", null);
    const xs = (all || []).filter((x: any) => x.id !== body.reel_id);
    const pubd = xs.filter((x: any) => x.status === "pub").sort((a: any, b: any) => String(b.day).localeCompare(String(a.day))).slice(0, 3);
    const rd = (all || []).find((x: any) => x.id === body.reel_id)?.day;
    const near = rd ? xs.filter((x: any) => x.day && x.status !== "pub").sort((a: any, b: any) => Math.abs(+new Date(a.day) - +new Date(rd)) - Math.abs(+new Date(b.day) - +new Date(rd))).slice(0, 3) : [];
    for (const x of [...pubd, ...near]) { const d = await b64(x.poster_path); if (d) img(`${x.status === "pub" ? "Already posted" : "Neighbour in the plan"} (${x.day}): reel ${x.code} "${x.title}" current cover`, d); }
    if (typeof body.frame === "string" && body.frame.length < 1_500_000) img("Frame from THIS reel's video (possible background):", body.frame.replace(/^data:image\/jpeg;base64,/, ""));
    content.push({ type: "text", text: TASK.cover + (note ? `\nExtra wishes from the studio: ${note}` : "") });
    messages = [{ role: "user", content }];
  } else {
    if (!TASK[mode]) return json({ error: "Неизвестный режим" }, 400);
    messages = [{ role: "user", content: TASK[mode] + (note ? `\nExtra wishes from the studio: ${note}` : "") }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: mode === "guide" ? 3500 : mode === "cover" ? 2500 : 1500, system, messages }),
  });
  const b = await res.json();
  if (!res.ok) return json({ error: "ИИ: " + (b?.error?.message || res.status) }, 502);
  const text = (b.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (mode === "chat") return json({ text });
  if (mode === "guide") { try { const m = text.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : text); return json({ reply: o.reply || "", body: o.body || "" }); } catch { return json({ reply: "", body: text }); } }
  try { const m = text.match(/\{[\s\S]*\}/); return json({ options: JSON.parse(m ? m[0] : text).options || [] }); }
  catch { return json({ options: [text] }); }
});
