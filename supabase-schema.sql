-- Run this in the Supabase SQL Editor for project MindMap

create table if not exists drawings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null default 'Canvas 1',
  content     jsonb not null default '{"children":[]}',
  updated_at  timestamptz not null default now()
);

-- Row-level security: each user can only access their own drawings
alter table drawings enable row level security;

create policy "owner access"
  on drawings for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast lookup and ordering by user
create index if not exists drawings_user_id_updated_at_idx on drawings (user_id, updated_at desc);

-- Migration: if you ran the old schema that had unique(user_id, name), drop it:
-- alter table drawings drop constraint if exists drawings_user_id_name_key;
