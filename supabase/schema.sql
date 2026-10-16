-- Dopa Studio Lab: кабинеты клиентов (один проект на всех клиентов).
-- Доступ только через members: вход по личному коду (edge function login),
-- все таблицы закрыты RLS по client_id.

create extension if not exists pgcrypto with schema extensions;

-- ── клиенты и доступ ─────────────────────────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                 -- publora → publora.dopastudiolab.com
  name text not null,
  handle text,                               -- @publora_
  season text,                               -- «сезон 1»
  logo_path text,                            -- путь в bucket cabinet
  weeks jsonb not null default '[]',         -- [{id,lab,dates,name}]
  themes jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  user_id uuid references auth.users on delete set null,
  email text not null,                       -- служебный адрес, писем не шлём
  name text not null,
  role text not null default 'client' check (role in ('client','studio')),
  code_hash text unique,                     -- sha256 личного кода
  active boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.client_id = c and m.user_id = auth.uid() and m.active)
$$;
create or replace function public.is_studio(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.client_id = c and m.user_id = auth.uid() and m.active and m.role = 'studio')
$$;
create or replace function public.my_name(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.name from members m where m.client_id = c and m.user_id = auth.uid() and m.active limit 1
$$;

-- ── контент ──────────────────────────────────────────────────────
create table public.reels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  code text not null,                        -- «12», «23b»
  week text,
  day date,
  title text not null default '',
  idea text,
  caption text,
  dur numeric,
  theme text,
  cta text,
  pin boolean not null default false,
  status text not null default 'work' check (status in ('work','rev','fix','hold','ok','sched','pub')),
  video_path text,
  poster_path text,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (client_id, code)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  reel_id uuid not null references public.reels on delete cascade,
  t numeric not null default 0,              -- секунда видео
  body text not null check (length(body) between 1 and 4000),
  author_id uuid default auth.uid(),
  author_name text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  q text not null,
  meta text,
  kind text not null check (kind in ('pick','chips','approve')),
  opts jsonb not null default '[]',          -- pick: [[«A», путь картинки]], chips: [«текст»]
  reel_code text,
  answer text,
  answered_by text,
  answered_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.digest (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  kind text not null check (kind in ('dec','todo','q')),
  body text not null,
  sub text,
  visible boolean not null default false,    -- клиент видит только после одобрения студии
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index on public.members (user_id);
create index on public.reels (client_id, day);
create index on public.comments (reel_id, t);
create index on public.tasks (client_id);
create index on public.digest (client_id);

-- ── RLS ──────────────────────────────────────────────────────────
alter table public.clients  enable row level security;
alter table public.members  enable row level security;
alter table public.reels    enable row level security;
alter table public.comments enable row level security;
alter table public.tasks    enable row level security;
alter table public.digest   enable row level security;

create policy clients_read on public.clients for select to authenticated using (is_member(id));

create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or is_studio(client_id));

create policy reels_read  on public.reels for select to authenticated using (is_member(client_id));
create policy reels_write on public.reels for all    to authenticated using (is_studio(client_id)) with check (is_studio(client_id));

create policy comments_read   on public.comments for select to authenticated using (is_member(client_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (is_member(client_id) and author_id = auth.uid()
              and exists (select 1 from reels r where r.id = reel_id and r.client_id = comments.client_id));
create policy comments_edit   on public.comments for update to authenticated
  using (author_id = auth.uid() or is_studio(client_id)) with check (is_member(client_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or is_studio(client_id));

create policy tasks_read  on public.tasks for select to authenticated using (is_member(client_id));
create policy tasks_write on public.tasks for all    to authenticated using (is_studio(client_id)) with check (is_studio(client_id));

create policy digest_read  on public.digest for select to authenticated
  using (is_studio(client_id) or (visible and is_member(client_id)));
create policy digest_write on public.digest for all to authenticated using (is_studio(client_id)) with check (is_studio(client_id));

-- имя автора комментария ставит база, а не браузер
create or replace function public.comments_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.author_name := coalesce(my_name(new.client_id), 'Гость');
  return new;
end $$;
create trigger comments_fill before insert on public.comments for each row execute function comments_fill();

create or replace function public.touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger reels_touch before update on public.reels for each row execute function touch();

-- ── действия клиента (без права править таблицы напрямую) ─────────
create or replace function public.approve_reel(r uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid; st text;
begin
  select client_id, status into cid, st from reels where id = r;
  if cid is null or not is_member(cid) then raise exception 'нет доступа'; end if;
  if st in ('work','rev','fix','hold') then update reels set status = 'ok' where id = r; return 'ok'; end if;
  return st;
end $$;

create or replace function public.move_reel(r uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select client_id into cid from reels where id = r;
  if cid is null or not is_member(cid) then raise exception 'нет доступа'; end if;
  update reels set day = d where id = r;
end $$;

create or replace function public.answer_task(tk uuid, a text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select client_id into cid from tasks where id = tk;
  if cid is null or not is_member(cid) then raise exception 'нет доступа'; end if;
  update tasks set answer = a, answered_by = my_name(cid), answered_at = now() where id = tk;
  if a = 'ok' then
    update reels set status = 'ok' where client_id = cid and status in ('work','rev')
      and code = (select reel_code from tasks where id = tk and kind = 'approve');
  end if;
end $$;

-- студия выдаёт личный код; сам код возвращается один раз, в базе только хэш
create or replace function public.studio_invite(c uuid, who text, r text default 'client') returns text
language plpgsql security definer set search_path = public, extensions as $$
declare code text;
begin
  if not is_studio(c) then raise exception 'только студия'; end if;
  code := upper(substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=0O1lI', ''), 1, 10));
  insert into members (client_id, email, name, role, code_hash)
  values (c, 'm-' || replace(gen_random_uuid()::text, '-', '') || '@members.dopastudiolab.com', who, r,
          encode(digest(code, 'sha256'), 'hex'));
  return code;
end $$;

create or replace function public.studio_reset_code(m uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare code text; cid uuid;
begin
  select client_id into cid from members where id = m;
  if cid is null or not is_studio(cid) then raise exception 'только студия'; end if;
  code := upper(substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=0O1lI', ''), 1, 10));
  update members set code_hash = encode(digest(code, 'sha256'), 'hex'), active = true where id = m;
  return code;
end $$;

create or replace function public.studio_set_active(m uuid, on_ boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select client_id into cid from members where id = m;
  if cid is null or not is_studio(cid) then raise exception 'только студия'; end if;
  if (select user_id from members where id = m) = auth.uid() then raise exception 'себя не отключить'; end if;
  update members set active = on_ where id = m;
end $$;

revoke execute on function public.studio_invite, public.studio_reset_code, public.studio_set_active,
  public.approve_reel, public.move_reel, public.answer_task, public.comments_fill from public, anon;
grant execute on function public.studio_invite, public.studio_reset_code, public.studio_set_active,
  public.approve_reel, public.move_reel, public.answer_task to authenticated;
revoke execute on function public.is_member, public.is_studio, public.my_name from public, anon;
grant execute on function public.is_member, public.is_studio, public.my_name to authenticated;

-- ── файлы: приватный bucket, путь начинается с client_id ──────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('cabinet', 'cabinet', false, 209715200)
on conflict (id) do nothing;

create policy cabinet_read on storage.objects for select to authenticated
  using (bucket_id = 'cabinet' and is_member(((storage.foldername(name))[1])::uuid));
create policy cabinet_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cabinet' and is_studio(((storage.foldername(name))[1])::uuid));
create policy cabinet_update on storage.objects for update to authenticated
  using (bucket_id = 'cabinet' and is_studio(((storage.foldername(name))[1])::uuid));
create policy cabinet_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cabinet' and is_studio(((storage.foldername(name))[1])::uuid));

-- ── живые обновления ─────────────────────────────────────────────
alter publication supabase_realtime add table public.reels, public.comments, public.tasks, public.digest;

-- триггерные функции не нужны в API
revoke execute on function public.comments_fill() from authenticated, anon, public;
revoke execute on function public.touch() from authenticated, anon, public;

-- клиент просит правку: ролик уходит на доработку до публикации
create or replace function public.request_fix(r uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cid uuid; st text;
begin
  select client_id, status into cid, st from reels where id = r;
  if cid is null or not is_member(cid) then raise exception 'нет доступа'; end if;
  update reels set status = 'fix' where id = r; return 'fix';
end $$;
revoke execute on function public.request_fix from public, anon;
grant execute on function public.request_fix to authenticated;

-- ── гайды: слово-призыв в конце ролика → что бот присылает в директ (16.10) ──
create table public.guides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword text not null,             -- совпадает с reels.cta
  title text not null,
  note text default '',              -- пояснение для команды
  reply text default '',             -- текст, который бот пишет в директ
  url text,                          -- ссылка
  path text, file_name text,         -- файл в bucket: <client_id>/guides/...
  status text not null default 'draft' check (status in ('draft','ready','live')),
  sort int default 0,
  created_at timestamptz default now(),
  unique (client_id, keyword)
);
alter table public.guides enable row level security;
create policy guides_read  on public.guides for select to authenticated using (is_member(client_id));
create policy guides_write on public.guides for all to authenticated using (is_studio(client_id)) with check (is_studio(client_id));
alter publication supabase_realtime add table public.guides;
