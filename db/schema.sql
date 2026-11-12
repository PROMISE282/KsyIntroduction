create table if not exists public.messages (
  id        uuid primary key default gen_random_uuid(),
  vid       uuid not null,
  from_role text not null check (from_role in ('v','o')),
  name      text not null default '방문자' check (char_length(name) <= 20),
  contact   text check (char_length(contact) <= 100),
  text      text not null check (char_length(text) between 1 and 1000),
  ts        timestamptz not null default now()
);
create index if not exists messages_vid_ts_idx on public.messages (vid, ts);

create table if not exists public.owner_login_failures (
  ip text not null,
  ts timestamptz not null default now()
);
create index if not exists owner_login_failures_ip_ts_idx on public.owner_login_failures (ip, ts);
