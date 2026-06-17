-- ───────────────────────────────────────────────────────────────────────────
-- Ascot Wealth · Adviser-to-Analyst (A2A) Briefing
-- 001_init.sql — creates the dedicated `adviser_to_analyst` schema and the
-- `briefs` table.
--
-- Run once against the Supabase project (SQL editor or psql). After running,
-- you MUST expose the schema to the API:
--   Supabase Dashboard → Project Settings → API → "Exposed schemas"
--   → add `adviser_to_analyst` to the list and save.
-- (PostgREST only serves schemas on that list, even for the service-role key.)
-- ───────────────────────────────────────────────────────────────────────────

create schema if not exists adviser_to_analyst;

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

create table if not exists adviser_to_analyst.briefs (
  id                            uuid primary key default gen_random_uuid(),

  -- ── Promoted columns (used by the dashboard for listing/filtering) ──────────
  client_name                   text        not null,
  ceding_scheme                 text,                    -- provider being transferred FROM
  p_code                        text,                    -- references public.pcodes_master.code (read-only lookup)
  asana_task_id                 text,
  transfer_type                 text,                    -- 'pension' | 'isa' | 'gia' (null while draft)
  transfer_value                numeric,
  client_age                    integer,
  client_dob                    date,
  risk_profile                  text,                    -- Defensive | Cautious | Balanced | Capital Growth | Aggressive
  adviser_email                 text,
  meeting_date                  date,
  meeting_time                  text,
  completed_by                  text,

  -- ── 24-hour pause rule ──────────────────────────────────────────────────────
  -- If no risk-tolerance questionnaire is on record, a 24h pause is enforced
  -- before the analyst can proceed.
  risk_questionnaire_on_record  boolean     not null default true,
  -- lifecycle: 'draft' | 'paused_24h' | 'submitted' | 'in_analysis' | 'completed'
  status                        text        not null default 'submitted',
  pause_until                   timestamptz,
  assigned_to                   text,                    -- analyst email handling the brief
  completed_at                  timestamptz,             -- when analysis was marked complete
  archived_at                   timestamptz,             -- soft-delete / hide from default views

  -- ── Full answer payload (resilient to form changes) ─────────────────────────
  answers                       jsonb       not null default '{}'::jsonb,

  -- ── Audit / integration ─────────────────────────────────────────────────────
  submitted_by_email            text,
  submitted_by_name             text,
  asana_comment_gid             text,        -- gid of the summary story posted to Asana, if any
  asana_sync_error              text,        -- non-fatal Asana failure captured for visibility
  ai_suggestions                text,        -- AI-drafted preliminary conclusions (assistive, non-binding)
  ai_suggestions_at             timestamptz,
  rtq_signup_ref                text,        -- external sign-up reference when an RTQ was sent
  rtq_state                     text,        -- queued | sent_for_signing | signed | with_provider | failed
  rtq_sent_at                   timestamptz,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists briefs_created_at_idx on adviser_to_analyst.briefs (created_at desc);
create index if not exists briefs_asana_task_idx on adviser_to_analyst.briefs (asana_task_id);
create index if not exists briefs_status_idx     on adviser_to_analyst.briefs (status);

-- Audit log: a row per action taken on a brief (see scripts/005_audit_log.sql).
create table if not exists adviser_to_analyst.brief_events (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references adviser_to_analyst.briefs(id) on delete cascade,
  action      text not null,
  actor_email text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists brief_events_brief_idx on adviser_to_analyst.brief_events (brief_id, created_at desc);

-- keep updated_at fresh
create or replace function adviser_to_analyst.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists briefs_set_updated_at on adviser_to_analyst.briefs;
create trigger briefs_set_updated_at
  before update on adviser_to_analyst.briefs
  for each row execute function adviser_to_analyst.set_updated_at();

-- ── Grants ──────────────────────────────────────────────────────────────────
-- The server uses the service_role key (bypasses RLS). Grants below also let
-- the schema be queried via PostgREST once it's added to "Exposed schemas".
grant usage on schema adviser_to_analyst to anon, authenticated, service_role;
grant all on all tables in schema adviser_to_analyst to anon, authenticated, service_role;
grant all on all sequences in schema adviser_to_analyst to anon, authenticated, service_role;
alter default privileges in schema adviser_to_analyst grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema adviser_to_analyst grant all on sequences to anon, authenticated, service_role;
