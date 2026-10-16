// Мост «комната → Publora». Ключ лежит только в секрете PUBLORA_API_KEY, в браузер не уходит.
// Действия: ping (какие соцсети подключены), draft (черновик с видео и обложкой),
// schedule (назначить время — только по явной кнопке), status (что с постом в Publora).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://api.publora.com/api/v1";
const KEY = Deno.env.get("PUBLORA_API_KEY") || "";

async function pub(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { "x-publora-key": KEY, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers || {}) },
  });
  let b: any = null;
  try { b = await r.json(); } catch { /* пусто */ }
  if (!r.ok) throw new Error(`${r.status} ${b?.code || b?.error || b?.message || ""}`.trim());
  return b;
}

async function instagram() {
  const b = await pub("/platform-connections");
  const list = (b.connections || b.platformConnections || b.data || b || []) as any[];
  return list.filter((c) => String(c.platformId || c.id || "").startsWith("instagram-"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!KEY) return json({ error: "Нет ключа Publora в секретах" }, 500);

  const auth = req.headers.get("Authorization") || "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try { body = await req.json(); } catch { /* пусто */ }
  const action = String(body.action || "");

  // только студия; клиент через эту функцию ничего не отправит
  const cid = String(body.client_id || "");
  const { data: ok } = await user.rpc("is_studio", { c: cid });
  if (!ok) return json({ error: "Только для студии" }, 403);

  try {
    if (action === "ping") {
      const ig = await instagram();
      return json({ instagram: ig.map((c) => ({ id: c.platformId || c.id, name: c.username || c.name || c.displayName || "" })) });
    }

    const { data: r } = await admin.from("reels").select("*").eq("id", body.reel_id).eq("client_id", cid).maybeSingle();
    if (!r) return json({ error: "Ролик не найден" }, 404);

    if (action === "status") {
      if (!r.publora_id) return json({ status: null });
      const g = await pub(`/get-post/${r.publora_id}`);
      const st = g.postGroup?.status || g.status || null;
      await admin.from("reels").update({ publora_status: st, publora_err: null }).eq("id", r.id);
      return json({ status: st });
    }

    if (action === "draft") {
      if (r.publora_id) return json({ error: "Черновик уже есть в Publora", publora_id: r.publora_id }, 409);
      if (!r.video_path) return json({ error: "У ролика нет видео" }, 400);
      const ig = await instagram();
      if (ig.length !== 1) return json({ error: `Instagram в Publora: ${ig.length}, нужен ровно один` }, 400);
      const platform = ig[0].platformId || ig[0].id;

      const created = await pub("/create-post", {
        method: "POST",
        body: JSON.stringify({ content: r.caption || r.title || "", platforms: [platform], platformSettings: { instagram: { videoType: "REELS", shareToFeed: true } } }),
      });
      const gid = created.postGroupId || created.postGroup?._id || created._id;
      await admin.from("reels").update({ publora_id: gid, publora_status: "draft", publora_err: null }).eq("id", r.id);

      const { data: s } = await admin.storage.from("cabinet").createSignedUrl(r.video_path, 3600);
      await pub(`/attach-media/${gid}`, {
        method: "POST",
        headers: { "Idempotency-Key": `dopa-${r.id}-video` },
        body: JSON.stringify({ file: { download_url: s!.signedUrl, file_id: `dopa-${r.id}`, mime_type: "video/mp4" }, fileName: `reel_${r.code || "x"}.mp4` }),
      });

      if (r.poster_path) {
        const { data: img } = await admin.storage.from("cabinet").download(r.poster_path);
        if (img) {
          const fd = new FormData();
          fd.append("cover", img, `cover_${r.code || "x"}.` + (r.poster_path.split(".").pop() || "jpg"));
          fd.append("postGroupId", gid);
          const c = await pub("/upload-instagram-cover", { method: "POST", body: fd });
          await pub(`/update-post/${gid}`, { method: "PUT", body: JSON.stringify({ platformSettings: { instagram: { coverUrl: c.cover.url } } }) });
        }
      }
      return json({ publora_id: gid, status: "draft" });
    }

    if (action === "schedule") {
      if (!r.publora_id) return json({ error: "Сначала черновик" }, 400);
      const when = new Date(String(body.when || ""));
      if (isNaN(+when) || +when < Date.now() + 5 * 60e3) return json({ error: "Время должно быть в будущем" }, 400);
      const t = when.toISOString();
      await pub(`/update-post/${r.publora_id}`, {
        method: "PUT",
        headers: { "Idempotency-Key": `dopa-${r.id}-sched-${t}` },
        body: JSON.stringify({ status: "scheduled", scheduledTime: t }),
      });
      await admin.from("reels").update({ publora_status: "scheduled", publora_at: t, status: "sched", publora_err: null }).eq("id", r.id);
      return json({ status: "scheduled", at: t });
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (body.reel_id) await admin.from("reels").update({ publora_err: msg }).eq("id", body.reel_id);
    return json({ error: "Publora: " + msg }, 502);
  }
});
