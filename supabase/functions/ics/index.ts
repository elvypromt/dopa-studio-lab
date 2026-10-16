// Календарь роликов для Google Календаря: подписка по ссылке ?t=<ics_token клиента>.
// Только чтение. Вышедшие помечены ✓, запланированные в Publora — «в Publora».
import { createClient } from "jsr:@supabase/supabase-js@2";

const esc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[0-9a-f]{24}$/.test(t)) return new Response("not found", { status: 404 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: c } = await db.from("clients").select("id,name,slug,rhythm").eq("ics_token", t).maybeSingle();
  if (!c) return new Response("not found", { status: 404 });
  const { data: reels } = await db.from("reels").select("id,code,title,idea,day,status,publora_status,publora_at,updated_at").eq("client_id", c.id).not("day", "is", null);
  const now = stamp(new Date());
  const [hh, mm] = String(c.rhythm?.time || "18:00").split(":");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dopa//Reels//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(c.name + " · ролики")}`, "X-WR-TIMEZONE:UTC", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const r of reels || []) {
    const pub = r.status === "pub", sch = r.publora_status === "scheduled";
    const mark = pub ? "✓ " : sch ? "⏱ " : "";
    const d = String(r.day).replace(/-/g, "");
    const ev = ["BEGIN:VEVENT", `UID:${r.id}@dopastudiolab.com`, `DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(new Date(r.updated_at))}`];
    if (sch && r.publora_at) { const a = new Date(r.publora_at); ev.push(`DTSTART:${stamp(a)}`, `DTEND:${stamp(new Date(+a + 15 * 60e3))}`); }
    else ev.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${String(new Date(Date.parse(r.day) + 864e5).toISOString().slice(0, 10)).replace(/-/g, "")}`);
    ev.push(`SUMMARY:${esc(`${mark}${r.code} · ${r.title}`)}`,
      `DESCRIPTION:${esc((pub ? "Вышел. " : sch ? "Запланирован в Publora. " : `По плану, время ${hh}:${mm}. `) + (r.idea || ""))}`,
      `URL:https://${c.slug}.dopastudiolab.com/`, "TRANSP:TRANSPARENT", "END:VEVENT");
    L.push(...ev);
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "max-age=300" } });
});
