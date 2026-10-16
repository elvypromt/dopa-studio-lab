# Кабинет клиента, живая версия (Dopa Studio Lab)

- `src.html` исходник, стили берутся из прототипа `../index.html`. Сборка: `python3 build.py` → `index.html`.
- `config.js` адрес проекта Supabase и publishable-ключ (публичные).
- `supabase/schema.sql` таблицы, RLS, функции клиента и студии, приватный bucket `cabinet`.
- `supabase/functions/login` вход по личному коду, без писем.
- `tools/seed.mjs` заливает план Publora в базу (код студии кладёт в `~/.dopa_studio/publora.code`, в базе только хэш).
- `tools/upload.mjs` грузит видео, обложки, логотип в bucket под кодом студии.

Доступ: студия во вкладке «Доступ» выдаёт личный код, код показывается один раз. Ссылка `…/#k=КОД` входит сама.
На сайте только код. Данные клиента и видео лежат в Supabase за входом.
