-- ───────────────────────────────────────────────────────────────────────────
-- 004 — brief lifecycle: archiving + analyst assignment + completion stamp.
--
-- `status` (free text) now spans the full lifecycle:
--   'draft' | 'paused_24h' | 'submitted' | 'in_analysis' | 'completed'
-- (no DDL needed for status — it's already a text column).
--
-- New columns support archiving, assignment and a completion timestamp.
-- Run once in the Supabase SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

alter table adviser_to_analyst.briefs
  add column if not exists archived_at  timestamptz,
  add column if not exists assigned_to  text,         -- analyst email handling the brief
  add column if not exists completed_at timestamptz;  -- when analysis was marked complete

create index if not exists briefs_archived_idx on adviser_to_analyst.briefs (archived_at);

notify pgrst, 'reload schema';
