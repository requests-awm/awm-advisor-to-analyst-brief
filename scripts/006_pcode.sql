-- ───────────────────────────────────────────────────────────────────────────
-- 006 — store the P-code on a brief.
--
-- Touches ONLY the adviser_to_analyst schema (the one this app owns).
-- public.pcodes_master is used read-only by the app for lookups and is NEVER
-- modified.
-- Run once in the Supabase SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

alter table adviser_to_analyst.briefs
  add column if not exists p_code text;   -- references public.pcodes_master.code

create index if not exists briefs_pcode_idx on adviser_to_analyst.briefs (p_code);

notify pgrst, 'reload schema';
