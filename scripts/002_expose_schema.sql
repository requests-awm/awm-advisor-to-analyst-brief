-- ───────────────────────────────────────────────────────────────────────────
-- Expose the `adviser_to_analyst` schema to the Supabase Data API (PostgREST)
-- directly via SQL — use this when the dashboard "Exposed schemas → Save" is
-- not persisting (e.g. role/permission issue in the dashboard).
--
-- "Exposed schemas" is the `pgrst.db_schemas` setting on the `authenticator`
-- role. The list below is the EXACT set the API currently serves, with
-- `adviser_to_analyst` appended — so no existing app loses access.
--
-- Run in the Supabase SQL Editor (runs as a privileged role), then the two
-- NOTIFY lines tell PostgREST to reload immediately.
-- ───────────────────────────────────────────────────────────────────────────

alter role authenticator set pgrst.db_schemas =
  'public, graphql_public, mip_handovers, revenue_engine, awm_psa_drafts, awm_staff_portal, summerwood_place, awm_pcode_generator, burwood_suitability, burwood_exceptions, client_bio, awm_project_zero2, awm_asset_summaries, awm_lead_routing, adviser_team_oversight, meeting_reminders, awm_submission_checklist, adviser_to_analyst';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
