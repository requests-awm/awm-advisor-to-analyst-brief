-- ───────────────────────────────────────────────────────────────────────────
-- 008 — track an out-of-date-RTQ sign-up request sent for a brief.
-- Touches ONLY the adviser_to_analyst schema. Run once in the SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

alter table adviser_to_analyst.briefs
  add column if not exists rtq_signup_ref text,        -- signup_reference from the intake API
  add column if not exists rtq_state       text,        -- queued | sent_for_signing | signed | with_provider | failed
  add column if not exists rtq_sent_at     timestamptz;

notify pgrst, 'reload schema';
