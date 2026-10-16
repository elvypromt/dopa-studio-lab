// Заливает видео, обложки, картинки вопросов и логотип Publora в приватный bucket.
// Входит кодом студии из ~/.dopa_studio/publora.code, ключей сервиса не нужно.
// Запуск: node cabinet/live/tools/upload.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../..');
const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const dir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(dir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(dir, 'publora.client_id'), 'utf8').trim();

const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify: ' + JSON.stringify(sess));

const files = [[path.join(root, 'motion/logos/publora/perfect_logo_full.svg'), `${CID}/brand/logo.svg`, 'image/svg+xml']];
for (const f of fs.readdirSync(path.join(root, 'presentation/plan_media')).filter(f => f.endsWith('.mp4')))
  files.push([path.join(root, 'presentation/plan_media', f), `${CID}/reels/${f}`, 'video/mp4']);
for (const f of fs.readdirSync(path.join(root, 'cabinet/posters')).filter(f => f.endsWith('.jpg')))
  files.push([path.join(root, 'cabinet/posters', f), `${CID}/posters/${f}`, 'image/jpeg']);
for (const f of fs.readdirSync(path.join(root, 'cabinet/covers')).filter(f => f.endsWith('.jpg')))
  files.push([path.join(root, 'cabinet/covers', f), `${CID}/tasks/${f}`, 'image/jpeg']);

let ok = 0;
for (const [src, dst, type] of files) {
  const res = await fetch(`${URLB}/storage/v1/object/cabinet/${dst}`, {
    method: 'POST', body: fs.readFileSync(src),
    headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': '3600' },
  });
  if (res.ok) ok++; else console.error('FAIL', dst, res.status, await res.text());
}
console.log(`uploaded ${ok}/${files.length}`);
