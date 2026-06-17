# Ascot Wealth · Adviser-to-Analyst (A2A) Briefing

Web app that replaces the *Adviser to Analyst Pre-Analysis Client Brief* Google Form.
Support/advisers capture the qualitative transfer context (Pension / ISA / GIA) behind
the firm's SSO; briefs are stored in Supabase and a summary is posted back to the
linked Asana task. Support can **save a draft** and an adviser can **complete it later**.

## Stack

- **Frontend:** React 19 + Vite + Tailwind v4 (`src/`), brand styling in `src/index.css`
- **Backend:** Express (`server.ts`) — serves the SPA and a small JSON API
- **Storage:** Supabase, schema `adviser_to_analyst`, table `briefs` (`scripts/001_init.sql`)
- **Auth:** SSO from the ops app (`ascotwm.com`) → session JWT (`src/lib/serverAuth.ts`)
- **Integration:** Asana — posts the brief summary as a comment on the task

## First-time setup

1. **Install:** `npm install`
2. **Database:** run `scripts/001_init.sql` in the Supabase SQL editor. The table lives
   in the dedicated `adviser_to_analyst` schema, which must be **exposed** to the API.
   If the dashboard *Exposed schemas → Save* doesn't persist, run
   [`scripts/002_expose_schema.sql`](scripts/002_expose_schema.sql) (sets it directly).
   For an existing DB, also run the later migrations in order:
   [`003_drafts_and_ceding_scheme.sql`](scripts/003_drafts_and_ceding_scheme.sql),
   [`004_lifecycle.sql`](scripts/004_lifecycle.sql),
   [`005_audit_log.sql`](scripts/005_audit_log.sql).
3. **Env:** `.env` is already populated (see `.env.example`). Set `SESSION_JWT_SECRET`
   to a strong value and confirm `SSO_AUDIENCE` matches what the ops app issues
   before production.

## Run (local)

```bash
npm run dev     # tsx server.ts — Vite middleware + API on http://localhost:3100
npm run build   # vite build → dist/public
npm run start   # NODE_ENV=production tsx server.ts (serves dist/public)
npm run lint    # tsc --noEmit
```

> **Port:** the app runs on a single port (`PORT`, default **3100**). Vite runs in
> Express middleware mode, so it does **not** open its own dev port. Ports **3000 and
> 3001 are already in use in the hosted/online environment — do not use them.** Change
> the port only via `PORT` in `.env` (e.g. `PORT=3100`), never to 3000/3001.

On localhost, `npm run dev` auto-mints a dev session via `/api/auth/dev-login`
(user from `DEV_USER_EMAIL` / `DEV_USER_NAME`). In production the only way in is an
SSO `?token=` from the ops app.

## Deploy (Google Cloud Run)

Matches the fee-sheet app's setup — a single container running `tsx server.ts`.

```bash
# from the project root
gcloud run deploy a2a-briefing \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \
  --build-env-vars NEXT_PUBLIC_SUPABASE_URL=https://fhuljajygkbgupsqmobd.supabase.co,VITE_PUBLIC_APP_URL=https://a2a.ascotwm.com,VITE_OPS_LOGIN_URL=https://ascotwm.com/admin/operations \
  --set-env-vars NODE_ENV=production,NEXT_PUBLIC_SUPABASE_URL=https://fhuljajygkbgupsqmobd.supabase.co,SUPABASE_SERVICE_ROLE_KEY=…,ASANA_ACCESS_TOKEN=…,ASANA_WORKSPACE_ID=666438144056,SSO_SHARED_SECRET=…,SSO_ISSUER=ascotwm.com,SSO_AUDIENCE=…,SESSION_JWT_SECRET=…
```

- **Build-time (`--build-env-vars`)**: only the `NEXT_PUBLIC_`/`VITE_` values baked into
  the client bundle. The [Dockerfile](Dockerfile) declares these as `ARG`s.
- **Runtime (`--set-env-vars`)**: all server secrets. Prefer **Secret Manager**
  (`--set-secrets`) over plain values for the service-role key, Asana token, and SSO/session secrets.
- `dev-login` is **not** registered when `NODE_ENV=production` — no no-auth path ships.
- Point **`a2a.ascotwm.com`** at the service (Cloud Run → Manage Custom Domains, or a
  load balancer), and register that URL + `SSO_AUDIENCE` with the ops app's SSO.

## Put it on the operations page

Per the requirement, link to it from the ops page (same SSO sign-in — no embedding
needed). The ops app mints an SSO token and redirects with `?token=`:

```html
<!-- Ops-page menu item / button -->
<a href="https://a2a.ascotwm.com?token={{ sso_token_for_a2a_audience }}">
  Adviser-to-Analyst Briefing
</a>
```

If the ops page already links to other SSO apps (e.g. the fee sheet), copy that exact
pattern and swap the audience/URL for this app. Users who arrive without a token are
bounced to `VITE_OPS_LOGIN_URL` to sign in, then back here.

## The form

Defined entirely in [`src/lib/briefSchema.ts`](src/lib/briefSchema.ts) — edit there to
change questions, options, help text, branching, or required rules. Structure:

- **Client Details** (incl. **Ceding scheme**) · **Analysis brief completion** ·
  **Transfer Product selection** (all paths)
- **Branch on transfer type:** Pension / ISA / GIA question sets (a user only ever sees
  one branch — the 48 form questions are the union of all three)
- **Future transfers** (TM58) — all paths
- **Drafts:** *Save draft* persists with only a client name (status `draft`); the brief
  can be reopened and completed/submitted later by support or an adviser.
- **24-hour pause:** if no risk-tolerance questionnaire is on record, submitting saves
  with status `paused_24h` + a `pause_until` timestamp, and the Asana comment is flagged.

## API

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/sso-exchange` | public — SSO JWT → session JWT |
| POST | `/api/auth/dev-login` | dev only |
| GET | `/api/me` | current user |
| GET | `/api/briefs` | dashboard list |
| GET | `/api/briefs/:id` | single brief (full answers, for view/edit) |
| POST | `/api/briefs` | create brief (`{ answers, draft? }`) + Asana summary + notify on submit |
| PATCH | `/api/briefs/:id` | update / finalize a brief (`{ answers, draft? }`) |
| PATCH | `/api/briefs/:id/status` | lifecycle transition (start analysis / complete / un-pause) |
| PATCH | `/api/briefs/:id/assign` | assign analyst (`{ assigned_to }`); reassign is admin-only |
| PATCH | `/api/briefs/:id/archive` | archive / unarchive (admin only) |
| DELETE | `/api/briefs/:id` | delete a draft (admin only) |
| GET | `/api/briefs/:id/events` | change-history / audit log |
| POST | `/api/transcribe` | transcribe an audio clip (OpenAI) for voice dictation |

## Built with the agentic phase in mind

This is the **form** layer. The proposal's later phases — voice-to-text dictation,
the agentic AI interviewer, P-code auto-trigger of the Asana task, fact-find
auto-population, and pre-populated conclusions — are not built yet, but the
schema-driven form and the `answers` JSONB column are structured so they can layer on
without restructuring.
