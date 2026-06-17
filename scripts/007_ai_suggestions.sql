-- ───────────────────────────────────────────────────────────────────────────
-- 007 — store AI-generated draft conclusions ("suggestions") on a brief.
-- Touches ONLY the adviser_to_analyst schema. Run once in the SQL Editor.
-- ───────────────────────────────────────────────────────────────────────────

alter table adviser_to_analyst.briefs
  add column if not exists ai_suggestions    text,
  add column if not exists ai_suggestions_at timestamptz;

notify pgrst, 'reload schema';
