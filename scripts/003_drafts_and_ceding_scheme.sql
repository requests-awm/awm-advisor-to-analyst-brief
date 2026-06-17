-- ───────────────────────────────────────────────────────────────────────────
-- 003 — add ceding-scheme + draft support.
--
--  • ceding_scheme: headline field (client name + ceding scheme + amount) the
--    "simpler process" request asked support to capture up front.
--  • transfer_type becomes nullable so a brief can be SAVED AS A DRAFT before
--    the product (Pension/ISA/GIA) is chosen. It's re-required on final submit
--    (enforced in the API, not the DB).
--
-- status now takes one of: 'draft' | 'submitted' | 'paused_24h'.
--
-- Run once in the Supabase SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

alter table adviser_to_analyst.briefs
  add column if not exists ceding_scheme text;

alter table adviser_to_analyst.briefs
  alter column transfer_type drop not null;

-- Refresh PostgREST's schema cache so the new column is visible to the API.
notify pgrst, 'reload schema';
