// Готовит seed.sql для клиента Publora из cabinet/data.js и личный код студии.
// Код студии пишется только в ~/.dopa_studio/<slug>.code (в базе лежит хэш).
// Запуск: node cabinet/live/tools/seed.mjs > seed.sql (всё одним SQL)
// или в два шага: --base печатает SQL только клиента и студии,
// --rest входит кодом студии и заливает ролики, вопросы и дайджест через API.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import vm from 'node:vm'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '../../data.js'), 'utf8') + ';this.REELS=REELS;this.WEEKS=WEEKS;this.TH=TH;', ctx);
const { REELS, WEEKS, TH } = ctx;

const SLUG = 'publora';
const MODE = process.argv[2] || '';
const dir = path.join(os.homedir(), '.dopa_studio');
const cidFile = path.join(dir, 'publora.client_id');
const CID = process.env.CID || (MODE === '--rest' && fs.existsSync(cidFile) ? fs.readFileSync(cidFile, 'utf8').trim() : crypto.randomUUID());
const q = v => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const MON = { 'янв':1,'фев':2,'мар':3,'апр':4,'мая':5,'май':5,'июн':6,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12 };
const isoDay = s => { const m = (s || '').match(/(\d+)\s+([а-я]+)/i); if (!m) return null;
  const mo = MON[m[2].slice(0, 3)]; return `2026-${String(mo).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`; };

// у недели храним понедельник
const weeks = WEEKS.map((w, i) => { const d = new Date(Date.UTC(2026, 9, 12 + 7 * i));
  return { ...w, start: d.toISOString().slice(0, 10) }; });

const media = new Set(fs.readdirSync(path.join(here, '../../../presentation/plan_media')).filter(f => f.endsWith('.mp4')).map(f => f.replace('.mp4', '')));
const posters = new Set(fs.readdirSync(path.join(here, '../../posters')).map(f => f.replace('.jpg', '')));

// код студии
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const codeFile = path.join(dir, `${SLUG}.code`);
let code = fs.existsSync(codeFile) ? fs.readFileSync(codeFile, 'utf8').trim() : '';
if (!code) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code = Array.from(crypto.randomBytes(12), b => abc[b % abc.length]).join('');
  fs.writeFileSync(codeFile, code + '\n', { mode: 0o600 });
}
const hash = crypto.createHash('sha256').update(code).digest('hex');
fs.writeFileSync(path.join(dir, `${SLUG}.client_id`), CID + '\n');

const out = [];
out.push('begin;');
out.push(`insert into clients (id, slug, name, handle, season, logo_path, weeks, themes) values (${q(CID)}, ${q(SLUG)}, 'Publora', '@publora_', 'сезон 1', ${q(CID + '/brand/logo.svg')}, ${q(JSON.stringify(weeks))}::jsonb, ${q(JSON.stringify(TH))}::jsonb);`);
out.push(`insert into members (client_id, email, name, role, code_hash) values (${q(CID)}, 'studio@members.dopastudiolab.com', 'Эльвира', 'studio', ${q(hash)});`);

// реальное состояние на 16.10: в Publora ничего не стоит и не вышло, готовые ролики ждут проверки клиента
const reels = REELS.map((r, i) => ({ client_id: CID, code: r.id, week: r.w, day: isoDay(r.day), title: r.t, idea: r.f, caption: r.cap,
  dur: r.dur ?? null, theme: r.th, cta: r.cta, pin: !!r.pin, status: media.has(r.id) ? 'rev' : 'work',
  video_path: media.has(r.id) ? `${CID}/reels/${r.id}.mp4` : null, poster_path: posters.has(r.id) ? `${CID}/posters/${r.id}.jpg` : null, sort: i }));

const tasks = [
  { q: 'Какая обложка для ролика 48 «Works with»?', meta: 'Обложка видна в сетке профиля', kind: 'pick', opts: ['A', 'B', 'C'].map(k => [k, `${CID}/tasks/48${k}.jpg`]) },
  { q: 'Кто пришлёт PDF «Publora за 5 минут» для слова START?', meta: 'Нужен к первой неделе: на него ведут 4 ролика', kind: 'chips', opts: ['Пришлёт команда', 'Сверстает Эльвира по нашему тексту', 'Пока без PDF'] },
  { q: 'Утвердите подпись к ролику 12 «Сколько стоит? Ноль»', meta: 'Откройте ролик, подпись под видео', kind: 'approve', reel: '12' },
];
const taskRows = tasks.map((t, i) => ({ client_id: CID, q: t.q, meta: t.meta, kind: t.kind, opts: t.opts || [], reel_code: t.reel || null, sort: i }));

const dg = [
  ['dec', 'Ролик 48 выходит с хуком-вопросом в начале', '15 окт'],
  ['dec', 'Хайлайт About us заливаем одним куском, без нарезки по 15 секунд', '15 окт'],
  ['dec', 'В текстах только «web app» или «в браузере», никакого «app»', '16 окт'],
  ['todo', 'Эльвира: проверить формулировку «app» в роликах 45, 48 и 49', 'до 18 окт'],
  ['todo', 'Publora: прислать текст для PDF «Publora за 5 минут»', 'до 19 окт'],
  ['q', 'Кто отвечает в директ людям, написавшим START или AGENT?', 'спросила Эльвира, 14 окт'],
];
const dgRows = dg.map(([kind, body, sub], i) => ({ client_id: CID, kind, body, sub, visible: false, sort: i }));

const val = v => v == null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : typeof v === 'object' ? `${q(JSON.stringify(v))}::jsonb` : q(v);
const ins = (t, rows) => rows.forEach(r => out.push(`insert into ${t} (${Object.keys(r).join(', ')}) values (${Object.values(r).map(val).join(', ')});`));

if (MODE === '--rest') {
  const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
  const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
  const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
  r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
  const sess = await r.json(); if (!sess.access_token) throw new Error('verify: ' + JSON.stringify(sess));
  for (const [t, rows] of [['reels', reels], ['tasks', taskRows], ['digest', dgRows]]) {
    r = await fetch(`${URLB}/rest/v1/${t}?on_conflict=${t === 'reels' ? 'client_id,code' : 'id'}`, { method: 'POST',
      headers: { ...h, Authorization: 'Bearer ' + sess.access_token, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    console.error(t, rows.length, r.status, r.ok ? '' : await r.text());
  }
} else {
  if (MODE !== '--base') { ins('reels', reels); ins('tasks', taskRows); ins('digest', dgRows); }
  out.push('commit;');
  process.stdout.write(out.join('\n') + '\n');
}
process.stderr.write(`client_id ${CID}; studio code saved to ${codeFile}\n`);
