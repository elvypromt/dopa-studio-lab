// Кладёт один файл в приватный bucket комнаты (вход кодом студии).
// node put.mjs <файл> <путь_внутри_клиента> [mime]   пример: node put.mjs a.pdf guides/a.pdf
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = fs.readFileSync(path.join(here, '../config.js'), 'utf8');
const URLB = cfg.match(/url:\s*'([^']+)'/)[1], KEY = cfg.match(/key:\s*'([^']+)'/)[1];
const dir = path.join(os.homedir(), '.dopa_studio');
const code = fs.readFileSync(path.join(dir, 'publora.code'), 'utf8').trim();
const CID = fs.readFileSync(path.join(dir, 'publora.client_id'), 'utf8').trim();
const [src, rel, mime] = process.argv.slice(2);
const types = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.zip': 'application/zip' };
const h = { apikey: KEY, 'Content-Type': 'application/json' };
let r = await fetch(`${URLB}/functions/v1/login`, { method: 'POST', headers: { ...h, Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ code }) });
const { token_hash, error } = await r.json(); if (!token_hash) throw new Error('login: ' + error);
r = await fetch(`${URLB}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', token_hash }) });
const sess = await r.json(); if (!sess.access_token) throw new Error('verify failed');
const res = await fetch(`${URLB}/storage/v1/object/cabinet/${CID}/${rel}`, { method: 'POST', body: fs.readFileSync(src),
  headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token, 'Content-Type': mime || types[path.extname(src).toLowerCase()] || 'application/octet-stream', 'x-upsert': 'true' } });
console.log(res.ok ? `ok ${CID}/${rel}` : `FAIL ${res.status} ${await res.text()}`);
