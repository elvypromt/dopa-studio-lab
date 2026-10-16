// Добавляет в комнату уже опубликованные ролики (статус pub): видео, обложка, строка в reels.
// Входит кодом студии из ~/.dopa_studio/publora.code. Запуск: node cabinet/live/tools/add_published.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../..');
const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const dir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(dir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(dir, 'publora.client_id'), 'utf8').trim();

const REELS = [
  { code: '51', title: 'About us: Stop it', dur: '58.8', sort: -2,
    idea: 'Печатается «Still posting by hand?» → «Stop it», знак «?» выпрямляется в линию → Introducing Publora, 6 веток, карта, табло, чек NO CARD NEEDED. Ролик + хайлайт About us целиком.',
    caption: `Still posting by hand? Stop it.

Introducing Publora. One post, ten networks, from your browser or from your AI.

Instagram, TikTok, YouTube, X, Threads, LinkedIn, Facebook, Bluesky, Telegram and Mastodon. Write once, Publora checks it and schedules it everywhere.

Start free, no card needed. Link in bio → publora.com

#publora #socialmediamanager #contentcreator #aiagents #smm` },
  { code: '48', title: 'Works with', dur: '60.0', sort: -1,
    idea: 'Хук-вопрос «Who does Publora work with?» → табло вылетов: Claude, ChatGPT, Cursor, Zapier, n8n, Make → все 10 сетей, все 23 AI-логотипа. Ролик + хайлайт Works with целиком.',
    caption: `Who does Publora work with? Everything you already use.

Write your post in Claude, ChatGPT or Cursor.
Or automate it with Zapier, Make or n8n.
Or just open it in your browser.

One post goes out to 10 networks: Instagram, TikTok, YouTube, X, Threads, LinkedIn, Facebook, Bluesky, Telegram and Mastodon.

No new tool to learn. Just connect yours.

Start free. Link in bio → publora.com

#publora #claudeai #n8n #aiagents #socialmediamanager` },
];

const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify: ' + JSON.stringify(sess));
const auth = { apikey: KEY, Authorization: 'Bearer ' + sess.access_token };

for (const x of REELS) {
  for (const [src, dst, type] of [[`presentation/plan_media/${x.code}.mp4`, `reels/${x.code}.mp4`, 'video/mp4'], [`cabinet/posters/${x.code}.jpg`, `posters/${x.code}.jpg`, 'image/jpeg']]) {
    const res = await fetch(`${URLB}/storage/v1/object/cabinet/${CID}/${dst}`, { method: 'POST', body: fs.readFileSync(path.join(root, src)),
      headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': '3600' } });
    if (!res.ok) throw new Error(`upload ${dst}: ${res.status} ${await res.text()}`);
  }
}
const rows = REELS.map(x => ({ client_id: CID, code: x.code, week: 'w1', day: '2026-10-16', title: x.title, idea: x.idea, caption: x.caption,
  dur: x.dur, theme: 'S', cta: 'START', pin: false, status: 'pub', sort: x.sort,
  video_path: `${CID}/reels/${x.code}.mp4`, poster_path: `${CID}/posters/${x.code}.jpg` }));
r = await fetch(`${URLB}/rest/v1/reels?on_conflict=client_id,code`, { method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
if (!r.ok) throw new Error('reels: ' + r.status + ' ' + await r.text());
console.log('added', REELS.map(x => x.code).join(', '));
