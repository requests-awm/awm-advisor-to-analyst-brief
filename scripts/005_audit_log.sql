-- ───────────────────────────────────────────────────────────────────────────
-- 005 — audit log: a row per action taken on a brief (create, edit, status
-- change, assign, archive, delete). Powers the change-history timeline.
-- Run once in the Supabase SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists adviser_to_analyst.brief_events (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references adviser_to_analyst.briefs(id) on delete cascade,
  action      text not null,            -- created | updated | submitted | status:<from>→<to> | assigned | archived | unarchived | deleted
  actor_email text,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists brief_events_brief_idx on adviser_to_analyst.brief_events (brief_id, created_at desc);

grant all on adviser_to_analyst.brief_events to service_role, anon, authenticated;

notify pgrst, 'reload schema';
