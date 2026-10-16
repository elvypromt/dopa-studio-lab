// Заливает библиотеку новых роликов (motion/catalog/library.json) в комнату: ролик, обложка, хайлайт, тема, призыв, голос.
//   node library.mjs [--dry] [--only x20-01,ai-03]
// Повторный запуск безопасен: ролик ищется по коду, видео перезаливается, только если файл новее загруженного.
// Даты не ставит (в план встают через «Стратегию»), статус новых = «На проверке».
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const motion = path.join(here, '../../../motion');
const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const dir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(dir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(dir, 'publora.client_id'), 'utf8').trim();
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;

const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify failed');
const A = { ...h, Authorization: 'Bearer ' + sess.access_token };
async function rest(p, init = {}) {
  const res = await fetch(`${URLB}/rest/v1/${p}`, { ...init, headers: { ...A, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${t}`); return t ? JSON.parse(t) : null;
}
async function put(src, rel, type) {
  const res = await fetch(`${URLB}/storage/v1/object/cabinet/${CID}/${rel}`, { method: 'POST', body: fs.readFileSync(src),
    headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token, 'Content-Type': type, 'x-upsert': 'true' } });
  if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`); return `${CID}/${rel}`;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib_'));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

const lib = JSON.parse(fs.readFileSync(path.join(motion, 'catalog/library.json'), 'utf8'));
const have = Object.fromEntries((await rest(`reels?client_id=eq.${CID}&select=id,code,video_path,updated_at,sort`)).map(x => [x.code, x]));
let sort = Math.max(1000, ...Object.values(have).map(x => x.sort || 0)) + 10;
const stampF = path.join(motion, 'catalog/.uploaded.json');
const stamps = fs.existsSync(stampF) ? JSON.parse(fs.readFileSync(stampF, 'utf8')) : {};
// сквозные номера: продолжают старые (последний занятый 53), закрепляются навсегда в catalog/numbers.json
const numF = path.join(motion, 'catalog/numbers.json');
const nums = fs.existsSync(numF) ? JSON.parse(fs.readFileSync(numF, 'utf8')) : {};
let next = Math.max(53, ...Object.values(nums)) + 1;
for (const it of lib) if (!nums[it.code]) nums[it.code] = next++;
if (!dry) fs.writeFileSync(numF, JSON.stringify(nums, null, 1));
let n = 0;
for (const it of lib) {
  if (only && !only.includes(it.code)) continue;
  const src = it.video && path.join(motion, it.video);
  const ok = src && fs.existsSync(src);
  const num = String(nums[it.code]);
  const row = { client_id: CID, code: num, lib_id: it.code, title: it.title, idea: it.idea || null, theme: it.theme || null, hl: it.hl || null,
    end_cta: it.end_cta || null, cta_note: it.cta_note || null, voiced: !!it.voiced, batch: it.batch };
  if (ok) row.dur = Math.round(dur(src) * 10) / 10;
  const cur = have[num] || have[it.code];
  const mt = ok ? fs.statSync(src).mtimeMs : 0;
  const needVid = ok && stamps[it.code] !== mt + ':' + it.video;
  console.log(`${num} ${it.code.padEnd(14)} ${ok ? (needVid ? 'видео ↑' : 'видео =') : 'нет видео'} · ${it.hl || '—'} · ${it.end_cta || '?'}${it.voiced ? '' : ' · без голоса'}`);
  if (dry) continue;
  if (needVid) {
    let up = src;
    if (fs.statSync(src).size > 45e6) { up = path.join(tmp, it.code + '.mp4'); ff('-i', src, '-vf', 'scale=-2:1280', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', up); }
    row.video_path = await put(up, `reels/${num}_${it.code}.mp4`, 'video/mp4');
    const jpg = path.join(tmp, it.code + '.jpg');
    ff('-ss', String(Math.max(0.5, row.dur * 0.42)), '-i', src, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', jpg);
    row.poster_path = await put(jpg, `posters/${num}_${it.code}.jpg`, 'image/jpeg');
    stamps[it.code] = mt + ':' + it.video;
  }
  if (cur) await rest(`reels?id=eq.${cur.id}`, { method: 'PATCH', body: JSON.stringify(row) });
  else await rest('reels', { method: 'POST', body: JSON.stringify({ ...row, status: 'rev', stage: ok ? 'review' : 'anim', sort: sort += 10 }) });
  fs.writeFileSync(stampF, JSON.stringify(stamps, null, 1)); n++;
}
console.log(dry ? 'dry run' : `ok · ${n} роликов`);
