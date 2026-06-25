-- Run against your Turso database:
--   turso db shell <db-name> < turso-schema.sql
--
-- SQLite/libSQL has no gen_random_uuid() and no row-level security:
-- ids are generated client-side (crypto.randomUUID) and access is NOT
-- restricted per user at the DB layer. See apps/web/src/lib/turso.ts.

create table if not exists drawings (
  id          text primary key,
  user_id     text not null,
  name        text not null default 'Canvas 1',
  content     text not null default '{"children":[]}',
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Index for fast per-user lookup ordered by recency.
create index if not exists drawings_user_id_updated_at_idx
  on drawings (user_id, updated_at desc);
