// Claude ведёт комнату сам: каждый законченный шаг работы → запись в «Процесс» (таблица activity).
//   node room.mjs step <код|-> "что сделано" [--stage board] [--file кадр.png] [--show]
//   node room.mjs version <код> <файл.mp4> ["что поменялось"]   новая версия → «На проверке», старая остаётся в истории
//   node room.mjs list [N]
// Этапы: idea script board anim voice edit review ready publora note.
// --show = клиент тоже видит запись (по умолчанию только студия). Версии клиент видит всегда.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const dir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(dir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(dir, 'publora.client_id'), 'utf8').trim();
const STAGES = ['idea', 'script', 'board', 'anim', 'voice', 'edit', 'review', 'ready', 'publora', 'note'];
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
const stageArg = flag('stage'), fileArg = flag('file'), show = !!flag('show');
const [cmd, ...rest] = argv;

const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify failed');
const A = { ...h, Authorization: 'Bearer ' + sess.access_token };

async function rest_(p, init = {}) {
  const res = await fetch(`${URLB}/rest/v1/${p}`, { ...init, headers: { ...A, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${t}`); return t ? JSON.parse(t) : null;
}
async function put(src, rel) {
  const res = await fetch(`${URLB}/storage/v1/object/cabinet/${CID}/${rel}`, { method: 'POST', body: fs.readFileSync(src),
    headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token, 'Content-Type': TYPES[path.extname(src).toLowerCase()] || 'application/octet-stream', 'x-upsert': 'true' } });
  if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`); return `${CID}/${rel}`;
}
const safe = (s) => path.basename(s).normalize('NFKD').replace(/[^\w.-]+/g, '_');
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
async function reelBy(c) {
  if (!c || c === '-') return null;
  const [x] = await rest_(`reels?client_id=eq.${CID}&code=eq.${encodeURIComponent(c)}&select=id,code,title,video_path,status`);
  if (!x) throw new Error('нет ролика ' + c); return x;
}
// видео тяжелее 45 МБ ужимаем до 720p, как drive_sync
function slim(src) {
  if (fs.statSync(src).size < 45e6) return src;
  const out = path.join(os.tmpdir(), 'room_' + stamp() + '.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=-2:1280', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  return out;
}

if (cmd === 'step') {
  const [c, body] = rest; if (!body) throw new Error('нужен текст шага');
  const stage = stageArg || 'note'; if (!STAGES.includes(stage)) throw new Error('этап: ' + STAGES.join(' '));
  const reel = await reelBy(c);
  let fp = null, kind = null;
  if (fileArg) { const src = fileArg.endsWith('.mp4') ? slim(fileArg) : fileArg; fp = await put(src, `process/${stamp()}_${safe(fileArg)}`); kind = fileArg.endsWith('.mp4') ? 'video' : 'image'; }
  const [a] = await rest_('activity', { method: 'POST', body: JSON.stringify({ client_id: CID, reel_id: reel?.id || null, stage, body, file_path: fp, kind, visible: show }) });
  if (reel && stage !== 'note') await rest_(`reels?id=eq.${reel.id}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
  console.log(`ok · ${reel ? reel.code + ' · ' : ''}${stage} · ${show ? 'видит клиент' : 'только студия'}${fp ? ' · файл' : ''} · ${a.id}`);
} else if (cmd === 'version') {
  const [c, file, note] = rest; const reel = await reelBy(c); if (!file) throw new Error('нужен mp4');
  const fp = await put(slim(file), `reels/${reel.code}_${stamp()}.mp4`);
  if (reel.video_path) await rest_('activity', { method: 'POST', body: JSON.stringify({ client_id: CID, reel_id: reel.id, stage: 'review', kind: 'old', file_path: reel.video_path, body: 'Предыдущая версия', visible: true }) });
  await rest_(`reels?id=eq.${reel.id}`, { method: 'PATCH', body: JSON.stringify({ video_path: fp, status: 'rev', stage: 'review' }) });
  await rest_('activity', { method: 'POST', body: JSON.stringify({ client_id: CID, reel_id: reel.id, stage: 'review', kind: 'version', file_path: fp, body: note || 'Новая версия на проверку', visible: true }) });
  console.log(`ok · ${reel.code} · новая версия на проверке`);
} else if (cmd === 'list') {
  const n = Number(rest[0] || 15);
  const xs = await rest_(`activity?client_id=eq.${CID}&order=created_at.desc&limit=${n}&select=created_at,stage,body,visible,kind,reels(code)`);
  for (const x of xs) console.log(x.created_at.slice(5, 16).replace('T', ' '), (x.reels?.code || '—').padEnd(4), x.stage.padEnd(7), x.visible ? '👁' : '  ', x.body);
} else {
  console.log('команды: step | version | list');
}
