// Синхронизация Dopa Room ↔ Google Drive (папка !!!!!!!!Publora).
//  ← Drive: новые ролики из «3 Готовые ролики/NN_name.mp4» попадают в комнату со статусом «На проверке»
//           (видео 720p, обложка из «материалы по роликам/NN_*/обложка*.png» или кадр на 1 с).
//  → Drive: статусы и комментарии менеджера пишутся в «9 Рабочее (не трогать)/ролики/00_комната_статусы.md».
// Ничего на Диске не удаляется и не перезаписывается, кроме этого md-файла.
// Запуск: node cabinet/live/tools/drive_sync.mjs [--dry] [--force 52,53] [--push-only]
// Коды, которые НЕ надо тянуть, лежат в drive_sync.skip.json (можно править руками).
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry'), PUSH_ONLY = args.includes('--push-only');
const FORCE = (args[args.indexOf('--force') + 1] || '').split(',').filter(x => args.includes('--force') && x);
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const sdir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(sdir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(sdir, 'publora.client_id'), 'utf8').trim();

const CS = path.join(os.homedir(), 'Library/CloudStorage');
const gd = fs.existsSync(CS) ? fs.readdirSync(CS).find(d => d.startsWith('GoogleDrive-')) : null;
if (!gd) throw new Error('Google Drive не найден в ~/Library/CloudStorage');
const MY = path.join(CS, gd, 'Мой диск');
const ROOT = path.join(MY, fs.readdirSync(MY).find(d => /Publora/i.test(d) && !/архив/i.test(d)));
const DONE = path.join(ROOT, '3 Готовые ролики');
const WORK = path.join(ROOT, '9 Рабочее (не трогать)', 'ролики');
const MAT = path.join(WORK, 'материалы по роликам');
const OUT_MD = path.join(WORK, '00_комната_статусы.md');
const SKIP_F = path.join(here, 'drive_sync.skip.json');
const SKIP = fs.existsSync(SKIP_F) ? JSON.parse(fs.readFileSync(SKIP_F, 'utf8')) : {};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dopa_sync_'));

// ── вход кодом студии ──
const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const lg = await r.json(); if (!lg.token_hash) throw new Error('login: ' + lg.error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash: lg.token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify: ' + JSON.stringify(sess));
const auth = { apikey: KEY, Authorization: 'Bearer ' + sess.access_token };
const rest = async (p, init = {}) => {
  const res = await fetch(`${URLB}/rest/v1/${p}`, { ...init, headers: { ...auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
  const txt = await res.text(); return txt ? JSON.parse(txt) : null;
};

const reels = await rest(`reels?client_id=eq.${CID}&select=id,code,title,status,day,week,sort,updated_at,caption&order=sort`);
const byCode = Object.fromEntries(reels.map(x => [x.code, x]));

// ── Drive → комната ──
const toTitle = s => { const t = s.replace(/^[0-9]+[a-z]?_/, '').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const probe = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const posterFor = (c, video) => {
  const dir = fs.readdirSync(MAT).find(d => d.startsWith(c + '_'));
  const png = dir && fs.readdirSync(path.join(MAT, dir)).filter(f => /^обложка.*\.(png|jpg|jpeg)$/i.test(f) && !/стар/i.test(f)).sort()[0];
  const out = path.join(TMP, c + '.jpg');
  if (png) execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(MAT, dir, png), '-vf', 'scale=360:640:force_original_aspect_ratio=increase,crop=360:640', '-q:v', '4', out]);
  else execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1', '-i', video, '-frames:v', '1', '-vf', 'scale=360:640', '-q:v', '4', out]);
  return out;
};
const upload = async (file, dst, type) => {
  const res = await fetch(`${URLB}/storage/v1/object/cabinet/${CID}/${dst}`, { method: 'POST', body: fs.readFileSync(file),
    headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': '3600' } });
  if (!res.ok) throw new Error(`upload ${dst}: ${res.status} ${await res.text()}`);
};

if (!PUSH_ONLY) {
  const files = fs.readdirSync(DONE).filter(f => /^[0-9]+[a-z]?_.*\.mp4$/.test(f) && !/CHECK|не_то|стар/i.test(f)).sort();
  let maxSort = Math.max(0, ...reels.map(x => x.sort));
  const added = [];
  for (const f of files) {
    const c = f.match(/^([0-9]+[a-z]?)_/)[1];
    const forced = FORCE.includes(c);
    if (!forced && (byCode[c] || SKIP[c])) continue;
    const src = path.join(DONE, f);
    log((forced ? 'обновляю ' : 'новый ') + f);
    if (DRY) { added.push(c); continue; }
    const mp4 = path.join(TMP, c + '.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=720:1280', '-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', mp4]);
    const jpg = posterFor(c, src);
    await upload(mp4, `reels/${c}.mp4`, 'video/mp4');
    await upload(jpg, `posters/${c}.jpg`, 'image/jpeg');
    const row = { client_id: CID, code: c, title: byCode[c]?.title || toTitle(f.replace(/\.mp4$/, '')), dur: probe(src).toFixed(1),
      status: byCode[c]?.status || 'rev', sort: byCode[c]?.sort ?? ++maxSort, theme: 'S', cta: 'START',
      video_path: `${CID}/reels/${c}.mp4`, poster_path: `${CID}/posters/${c}.jpg`, updated_at: new Date().toISOString() };
    await rest('reels?on_conflict=client_id,code', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
    added.push(c);
  }
  log(added.length ? 'в комнату добавлено: ' + added.join(', ') : 'новых роликов на Диске нет');
}

// ── комната → Drive (статусы + комментарии) ──
const ST = { work: 'В работе', rev: 'На проверке', fix: 'Переделать', hold: 'Сомневаюсь', ok: 'Одобрен', sched: 'Запланирован', pub: 'Опубликован' };
const fresh = await rest(`reels?client_id=eq.${CID}&select=id,code,title,status,day,updated_at&order=sort`);
const comments = await rest(`comments?client_id=eq.${CID}&select=reel_id,t,body,author_name,resolved,created_at&order=created_at`);
const cby = {}; for (const c of comments) (cby[c.reel_id] ||= []).push(c);
const fmt = s => s ? new Date(s).toLocaleString('sv-SE').slice(0, 16) : '';
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const lines = [`# Dopa Room · статусы и комментарии`, `Обновлено ${fmt(new Date().toISOString())} автоматически (drive_sync). Правки делать в комнате: https://publora.dopastudiolab.com`, ``,
  `| Код | Ролик | Статус | Дата в плане | Комментариев |`, `|---|---|---|---|---|`];
for (const x of fresh) lines.push(`| ${x.code} | ${x.title} | ${ST[x.status] || x.status} | ${x.day || ''} | ${(cby[x.id] || []).length} |`);
const withC = fresh.filter(x => cby[x.id]);
if (withC.length) {
  lines.push('', '## Комментарии менеджера');
  for (const x of withC) {
    lines.push('', `### ${x.code} · ${x.title} (${ST[x.status]})`);
    for (const c of cby[x.id]) lines.push(`- ${c.resolved ? '✅' : '🔸'} ${mmss(+c.t)} · ${c.author_name || ''} · ${fmt(c.created_at)}: ${c.body.replace(/\s+/g, ' ')}`);
  }
}
if (!DRY) fs.writeFileSync(OUT_MD, lines.join('\n') + '\n');
log(`статусы записаны: ${path.relative(ROOT, OUT_MD)} (${fresh.length} роликов, ${comments.length} комментариев)`);
fs.rmSync(TMP, { recursive: true, force: true });
