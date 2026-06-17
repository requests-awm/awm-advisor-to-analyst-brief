/**
 * Adviser-to-Analyst (A2A) Briefing — Express backend.
 *
 * Serves the Vite React app and a small JSON API:
 *   POST /api/auth/sso-exchange   — swap an ops-app SSO JWT for a session JWT
 *   POST /api/auth/dev-login      — dev-only fake session (never in prod)
 *   GET  /api/me                  — current session user
 *   GET  /api/briefs              — list briefs (dashboard)
 *   GET  /api/briefs/:id          — one brief
 *   POST /api/briefs              — create a brief (+ post summary to Asana)
 *
 * Storage: Supabase, schema `adviser_to_analyst`, table `briefs`
 * (see scripts/001_init.sql).
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { google } from 'googleapis';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import {
  verifySSOToken,
  signSessionToken,
  requireSession,
  SESSION_TTL_SECONDS,
} from './src/lib/serverAuth.js';
import {
  SECTIONS,
  fieldVisible,
  TRANSFER_TYPE_FROM_LABEL,
  type Answers,
  type TransferType,
} from './src/lib/briefSchema.js';
import { canTransition, type BriefStatus } from './src/lib/lifecycle.js';
import { buildBriefPdf, pdfFileName } from './src/lib/briefPdf.js';
import { buildRtqPayload, isTimestampFresh } from './src/lib/rtqSignup.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3100);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';

// Service-role client scoped to the dedicated `adviser_to_analyst` schema
// (bypasses RLS).
const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'adviser_to_analyst' },
});

const app = express();
// Capture the raw body so inbound webhooks can be HMAC-verified byte-exactly.
app.use(express.json({
  limit: '5mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));

// ─── Roles ────────────────────────────────────────────────────────────────────
const ADMIN_EMAILS = new Set(
  (process.env.A2A_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const isAdmin = (email?: string) => !!email && ADMIN_EMAILS.has(email.toLowerCase());
function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (isAdmin(req.user?.email)) return true;
  res.status(403).json({ error: 'This action requires an admin.' });
  return false;
}

// ─── Audit log ──────────────────────────────────────────────────────────────
async function logEvent(briefId: string, action: string, actor?: string, detail?: string) {
  try {
    await supabase.from('brief_events').insert({ brief_id: briefId, action, actor_email: actor || null, detail: detail || null });
  } catch (err: any) {
    console.warn('⚠️ audit log failed:', err?.message);
  }
}

// ─── Email notifications (reuses fee-sheet Gmail credentials) ─────────────────
const NOTIFY_EMAIL = process.env.A2A_NOTIFY_EMAIL || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const APP_URL = process.env.VITE_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3100';
let mailer: nodemailer.Transporter | null = null;
function getMailer(): nodemailer.Transporter | null {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!mailer) mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  return mailer;
}

/** Email the analyst team inbox when a brief becomes Outstanding (non-fatal). */
async function notifyOutstanding(brief: any) {
  const m = getMailer();
  if (!m || !NOTIFY_EMAIL) return;
  try {
    const link = `${APP_URL.replace(/\/$/, '')}/brief/${brief.id}`;
    await m.sendMail({
      from: `Ascot A2A Briefing <${GMAIL_USER}>`,
      to: NOTIFY_EMAIL,
      subject: `A2A brief ready: ${brief.client_name} (${(brief.transfer_type || '').toUpperCase()})`,
      text:
        `A new Adviser-to-Analyst brief is ready for analysis.\n\n` +
        `Client: ${brief.client_name}\n` +
        `Ceding scheme: ${brief.ceding_scheme || '—'}\n` +
        `Transfer: ${(brief.transfer_type || '').toUpperCase()} · ${brief.transfer_value ? '£' + brief.transfer_value : '—'}\n` +
        `Adviser: ${brief.adviser_email || '—'}\n` +
        `Asana task: ${brief.asana_task_id || '—'}\n\n` +
        `Open it: ${link}\n`,
    });
  } catch (err: any) {
    console.warn('⚠️ notify email failed:', err?.message);
  }
}

// ─── Auth: SSO handoff (public — this is *how* auth happens) ──────────────────
app.post('/api/auth/sso-exchange', async (req, res) => {
  const { ssoToken } = req.body || {};
  if (!ssoToken || typeof ssoToken !== 'string') {
    return res.status(400).json({ error: 'Missing ssoToken in body' });
  }
  try {
    const ssoUser = await verifySSOToken(ssoToken);
    const sessionToken = await signSessionToken(ssoUser);
    return res.json({ session_token: sessionToken, expires_in: SESSION_TTL_SECONDS, user: { ...ssoUser, admin: isAdmin(ssoUser.email) } });
  } catch (err: any) {
    let decoded: any = null;
    try {
      const b64 = String(ssoToken).split('.')[1] || '';
      decoded = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    } catch { /* malformed */ }
    console.warn('⚠️  SSO exchange failed:', err?.message, {
      expected_iss: process.env.SSO_ISSUER,
      expected_aud: process.env.SSO_AUDIENCE,
      received_iss: decoded?.iss,
      received_aud: decoded?.aud,
    });
    return res.status(401).json({ error: 'Invalid SSO token', details: err?.message });
  }
});

// ─── Auth: dev-only bypass ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/auth/dev-login', async (_req, res) => {
    const devUser = {
      sub: process.env.DEV_USER_SUB || 'dev-user-local',
      email: process.env.DEV_USER_EMAIL || 'dev@ascotwm.com',
      name: process.env.DEV_USER_NAME || 'Local Dev',
    };
    const sessionToken = await signSessionToken(devUser);
    return res.json({ session_token: sessionToken, expires_in: SESSION_TTL_SECONDS, user: { ...devUser, admin: isAdmin(devUser.email) } });
  });
  console.warn(
    `⚠️  Dev auth bypass active (NODE_ENV=${process.env.NODE_ENV || 'unset'}). ` +
      'POST /api/auth/dev-login is open. Production deploys never expose this.',
  );
}

// ─── Session guard for everything else under /api ─────────────────────────────
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/sso-exchange') return next();
  if (req.path === '/auth/dev-login') return next();
  if (req.path === '/signup-events') return next(); // webhook: authenticated by HMAC, not a session
  return requireSession(req, res, next);
});

app.get('/api/me', (req, res) => {
  res.json({ user: { ...req.user, admin: isAdmin(req.user?.email) } });
});

// ─── Voice dictation: transcribe an uploaded audio clip via OpenAI ────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/transcribe', audioUpload.single('audio'), async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Transcription is not configured (no OPENAI_API_KEY).' });
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });
  try {
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer as unknown as BlobPart], { type: req.file.mimetype || 'audio/webm' }), req.file.originalname || 'audio.webm');
    form.append('model', TRANSCRIBE_MODEL);
    form.append('response_format', 'json');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body?.error?.message || `Transcription failed (HTTP ${r.status})`;
      console.warn('⚠️ transcription failed:', msg);
      return res.status(502).json({ error: msg });
    }
    res.json({ text: String(body?.text || '').trim() });
  } catch (err: any) {
    console.error('transcribe error:', err?.message);
    res.status(500).json({ error: err?.message || 'Transcription error.' });
  }
});

// ─── Asana ────────────────────────────────────────────────────────────────────
const ASANA_TOKEN = process.env.ASANA_ACCESS_TOKEN || '';
const ASANA_WORKSPACE_ID = process.env.ASANA_WORKSPACE_ID || '';
const A2A_PROJECT_ID = process.env.ASANA_A2A_PROJECT_ID || '';
const A2A_SECTION_ID = process.env.ASANA_A2A_SECTION_ID || '';
const A2A_COMPLETE_FIELD_ID = process.env.ASANA_A2A_COMPLETE_DATE_FIELD_ID || '';
const GOOGLE_DRIVE_CREDS = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

async function asanaFetch(path: string, init: RequestInit) {
  const r = await fetch(`https://app.asana.com/api/1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${ASANA_TOKEN}`, ...(init.headers || {}) },
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.errors?.[0]?.message || `Asana HTTP ${r.status}`);
  return body;
}

/** Post a brief summary as a comment (story) on the given Asana task. */
async function postAsanaSummary(taskId: string, text: string): Promise<string> {
  const body = await asanaFetch(`/tasks/${encodeURIComponent(taskId)}/stories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { text } }),
  });
  return String(body?.data?.gid || '');
}

/** Mark the A2A briefing complete: set the complete-date custom field + move to the brief section. */
async function markTaskComplete(taskId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (A2A_COMPLETE_FIELD_ID) {
    await asanaFetch(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      // Asana date custom field expects a { date } object (matches the Zap's __date).
      body: JSON.stringify({ data: { custom_fields: { [A2A_COMPLETE_FIELD_ID]: { date: today } } } }),
    });
  }
  if (A2A_SECTION_ID) {
    await asanaFetch(`/sections/${encodeURIComponent(A2A_SECTION_ID)}/addTask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { task: taskId } }),
    });
  }
}

/** Attach a PDF to an Asana task. */
async function attachPdfToTask(taskId: string, pdf: Buffer, filename: string): Promise<void> {
  const fd = new FormData();
  fd.append('file', new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' }), filename);
  const r = await fetch(`https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${ASANA_TOKEN}` }, body: fd,
  });
  if (!r.ok) {
    const b: any = await r.json().catch(() => ({}));
    throw new Error(b?.errors?.[0]?.message || `Asana attach HTTP ${r.status}`);
  }
}

/** Parse an A2A Asana task title, e.g. "##PL - Gill Doodson - 370719183 - P008 - ISA S&S Transfer - Transact". */
function parseTaskName(name: string) {
  const parts = String(name).split(' - ').map((s) => s.trim());
  if (parts.length < 4) return { name };
  return {
    name,
    prefix: parts[0],
    full_name: parts[1],
    id_number: parts[2],
    code: parts[3],
    product: parts.slice(4, -1).join(' - '),
    platform: parts[parts.length - 1],
  };
}

const DRIVE_SHARE_DOMAIN = process.env.GOOGLE_DRIVE_DOMAIN || 'ascotwm.com';
const DRIVE_PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

/** Lazily-built Drive client from the service-account JSON (or null if unconfigured).
 *  If GOOGLE_IMPERSONATE_SUBJECT is set, uses domain-wide delegation to act as
 *  that user (needed to file into a My Drive folder; otherwise the destination
 *  should be a Shared Drive). */
const DRIVE_IMPERSONATE = process.env.GOOGLE_IMPERSONATE_SUBJECT || '';
let _drive: ReturnType<typeof google.drive> | null = null;
function getDrive() {
  if (_drive) return _drive;
  if (!GOOGLE_DRIVE_CREDS) return null;
  const creds = JSON.parse(GOOGLE_DRIVE_CREDS);
  const scopes = ['https://www.googleapis.com/auth/drive'];
  const auth = DRIVE_IMPERSONATE
    ? new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes, subject: DRIVE_IMPERSONATE })
    : new google.auth.GoogleAuth({ credentials: creds, scopes });
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

/** Find a folder whose name contains `folderName`, optionally within a parent. */
/**
 * File the handover PDF in Google Drive. STRICTLY ADD-ONLY: the only Drive
 * operations are (1) create a new PDF inside the configured folder and (2) share
 * that newly-created PDF. It never lists, reads, modifies, moves, or deletes any
 * existing Drive content. Returns {skipped} if Drive isn't configured.
 *
 * `_folderName` (the "{P-code} - {Name}" label) is intentionally unused — every
 * PDF goes into GOOGLE_DRIVE_FOLDER_ID, the single folder you authorised.
 */
async function uploadHandoverToDrive(pdf: Buffer, _folderName: string, filename: string): Promise<{ skipped: boolean; url?: string }> {
  const drive = getDrive();
  if (!drive) return { skipped: true };
  if (!DRIVE_PARENT_FOLDER_ID) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set');

  // (1) Create the new PDF inside the authorised folder.
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [DRIVE_PARENT_FOLDER_ID] },
    media: { mimeType: 'application/pdf', body: Readable.from(pdf) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  // (2) Share that newly-created file org-wide (best-effort; never touches other files).
  try {
    await drive.permissions.create({
      fileId: created.data.id!,
      requestBody: { type: 'domain', role: 'writer', domain: DRIVE_SHARE_DOMAIN },
      supportsAllDrives: true,
    });
  } catch { /* sharing is best-effort; the file is filed regardless */ }
  return { skipped: false, url: created.data.webViewLink || undefined };
}

/** Human-readable summary of a brief for the Asana comment. */
function buildAsanaSummary(answers: Answers, meta: { by: string; status: string; updated?: boolean }): string {
  const tt = TRANSFER_TYPE_FROM_LABEL[answers.transfer_type];
  const lines: string[] = [];
  lines.push(meta.updated ? 'A2A Pre-Analysis Client Brief UPDATED' : 'A2A Pre-Analysis Client Brief submitted');
  lines.push(`Completed by: ${meta.by}`);
  if (meta.status === 'paused_24h') {
    lines.push('⚠️ 24-HOUR PAUSE: no risk-tolerance questionnaire on record.');
  }
  lines.push('');
  for (const section of SECTIONS) {
    if (section.transferType && section.transferType !== tt) continue;
    const fields = section.fields.filter((f) => fieldVisible(f, answers) && String(answers[f.key] ?? '').trim());
    if (!fields.length) continue;
    lines.push(`— ${section.title} —`);
    for (const f of fields) lines.push(`${f.label}: ${answers[f.key]}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ─── AI: chat helper + interviewer + draft conclusions (OpenAI) ───────────────
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
async function openaiChat(messages: ChatMsg[], json = false): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.3, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `OpenAI HTTP ${r.status}`);
  return body?.choices?.[0]?.message?.content || '';
}

/** "Label: value" lines for the visible fields of a brief (for AI prompts). */
function briefFieldsText(answers: Answers): string {
  const tt = TRANSFER_TYPE_FROM_LABEL[answers.transfer_type];
  const lines: string[] = [];
  for (const section of SECTIONS) {
    if (section.transferType && section.transferType !== tt) continue;
    for (const f of section.fields) {
      if (!fieldVisible(f, answers)) continue;
      const v = String(answers[f.key] ?? '').trim();
      if (v) lines.push(`${f.label}: ${v}`);
    }
  }
  return lines.join('\n');
}

// READ-ONLY client context from public.insightly_contacts so the LLM gets the
// name spelling right (and can pre-fill DOB / risk profile). Never written to.
function nameTokens(text: string): string[] {
  return (text.match(/[A-Za-z'’-]{2,}/g) || []).slice(0, 6);
}
async function searchContacts(hint: string) {
  const tokens = nameTokens(hint);
  if (!tokens.length) return [] as any[];
  const ors = tokens.flatMap((t) => [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`]).join(',');
  const { data, error } = await supabase.schema('public').from('insightly_contacts')
    .select('first_name, last_name, date_of_birth, current_rtq_status, appointed_adviser, email')
    .or(ors).limit(8);
  if (error) { console.warn('⚠️ contact lookup failed:', error.message); return []; }
  return data || [];
}
/** Format CRM matches as a context block for the LLM (or '' if none). */
function contactContextBlock(matches: any[]): string {
  if (!matches.length) return '';
  const lines = matches.map((c) => {
    const dob = c.date_of_birth ? ` · DOB ${String(c.date_of_birth).slice(0, 10)}` : '';
    const risk = c.current_rtq_status ? ` · risk: ${c.current_rtq_status}` : ' · risk: (none on file)';
    const adv = c.appointed_adviser && c.appointed_adviser !== '-' ? ` · adviser: ${c.appointed_adviser}` : '';
    return `- ${c.first_name || ''} ${c.last_name || ''}`.trimEnd() + `${dob}${risk}${adv}`;
  });
  return (
    `\n\nON-FILE CLIENT MATCHES (from the CRM, read-only). If the client is clearly one of these, ` +
    `use the EXACT name spelling shown. You may also set client_dob and risk_profile from the match, ` +
    `and infer risk_questionnaire_on_record = "No" when the matched contact has no risk profile on file:\n` +
    lines.join('\n')
  );
}

// Compact spec of every field, for the interviewer to map answers onto.
const FIELD_SPEC = SECTIONS.flatMap((s) =>
  s.fields.map((f) =>
    `- ${f.key}: ${f.label}` +
    (f.options ? ` [one of exactly: ${f.options.join(' | ')}]` : '') +
    (s.transferType ? ` (only when transfer is ${s.transferType})` : '')),
).join('\n');

const INTERVIEW_SYS =
  `You are an AI interviewer helping a support member / adviser at Ascot Wealth Management (a UK wealth manager) complete a pre-analysis transfer brief. ` +
  `Ask ONE short, friendly question at a time. First establish the client's name and the transfer type (Pension, ISA or GIA), then ask the questions relevant to that type. ` +
  `If a free-text answer is thin or vague, ask a brief follow-up for depth (the goal is rich context, not one-word answers). Do not invent answers. ` +
  `When you have enough to populate the brief, set done=true with a short closing message.\n\n` +
  `Respond ONLY as strict JSON: {"reply": string, "answers": object, "done": boolean}. ` +
  `In "answers", map ONLY fields you can confidently fill from the latest exchange, using the exact field keys below; for option fields use one of the allowed values exactly. ` +
  `Do not repeat questions for fields already captured.\n\nFIELDS:\n${FIELD_SPEC}`;

const SUGGEST_SYS =
  `You are assisting a qualified analyst at Ascot Wealth Management who is about to perform a UK pension/ISA/GIA transfer analysis. ` +
  `Using ONLY the captured pre-analysis brief provided, draft concise PRELIMINARY observations to orient the analyst. ` +
  `Where the data allows, cover: consolidation value, likely cost impact, Tax-Free Cash (TFC) implications for pensions, CGT implications for GIAs, suitability flags/risks, and what the analyst should verify before relying on anything. ` +
  `Use short bullet points under clear headings. If key information is missing, say what's needed rather than assuming. ` +
  `This is a NON-BINDING DRAFT to assist a qualified human analyst — it is not advice and not a final recommendation.`;

// Conversational interviewer turn. { messages: [{role,content}], answers } → { reply, answers, done }
app.post('/api/interview', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'AI is not configured (no OPENAI_API_KEY).' });
  const turns: ChatMsg[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const answers = req.body?.answers || {};
  const lastUser = [...turns].reverse().find((m) => m.role === 'user')?.content || '';
  const matches = await searchContacts(`${answers.client_name || ''} ${lastUser}`.trim());
  const system = `${INTERVIEW_SYS}\n\nAlready captured (do not re-ask): ${JSON.stringify(answers)}${contactContextBlock(matches)}`;
  try {
    const out = await openaiChat([{ role: 'system', content: system }, ...turns], true);
    let parsed: any;
    try { parsed = JSON.parse(out); } catch { parsed = { reply: out, answers: {}, done: false }; }
    res.json({ reply: String(parsed.reply || ''), answers: parsed.answers || {}, done: !!parsed.done });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'AI request failed.' });
  }
});

// Generate (and store) draft conclusions for a brief.
app.post('/api/briefs/:id/suggest', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'AI is not configured (no OPENAI_API_KEY).' });
  const { data: brief, error: e1 } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  try {
    const text = briefFieldsText(brief.answers || {});
    const matches = await searchContacts(brief.client_name || '');
    const out = await openaiChat([
      { role: 'system', content: SUGGEST_SYS },
      { role: 'user', content: `Transfer type: ${(brief.transfer_type || 'unknown').toUpperCase()}\n\n${text}${contactContextBlock(matches)}` },
    ]);
    const { data, error } = await supabase.from('briefs')
      .update({ ai_suggestions: out, ai_suggestions_at: new Date().toISOString() })
      .eq('id', req.params.id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    await logEvent(req.params.id, 'AI suggestions generated', req.user?.email);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'AI request failed.' });
  }
});

// READ-ONLY: search tasks in the A2A project by free text (for the task picker).
app.get('/api/asana-tasks', async (req, res) => {
  if (!ASANA_TOKEN) return res.status(503).json({ error: 'Asana is not configured.' });
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const map = (body: any) => (body?.data || []).map((t: any) => ({ gid: t.gid, name: t.name }));
  try {
    // Advanced search, scoped to the A2A project (Asana premium).
    const body = await asanaFetch(
      `/workspaces/${ASANA_WORKSPACE_ID}/tasks/search?text=${encodeURIComponent(q)}` +
      `${A2A_PROJECT_ID ? `&projects.any=${A2A_PROJECT_ID}` : ''}&opt_fields=name&limit=25`,
      { method: 'GET' },
    );
    res.json(map(body));
  } catch {
    // Fallback: workspace-wide typeahead (works on all tiers).
    try {
      const body = await asanaFetch(
        `/workspaces/${ASANA_WORKSPACE_ID}/typeahead?resource_type=task&query=${encodeURIComponent(q)}&count=25&opt_fields=name`,
        { method: 'GET' },
      );
      res.json(map(body));
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Asana search failed.' });
    }
  }
});

// READ-ONLY: fetch an Asana task title and parse the encoded fields (client / P-code / product / platform).
app.get('/api/asana-task/:id', async (req, res) => {
  if (!ASANA_TOKEN) return res.status(503).json({ error: 'Asana is not configured.' });
  try {
    const body = await asanaFetch(`/tasks/${encodeURIComponent(req.params.id)}?opt_fields=name`, { method: 'GET' });
    const parsed: any = parseTaskName(body?.data?.name || '');
    // Enrich with the CRM contact (read-only) so the form can pre-fill DOB / risk.
    if (parsed.id_number) {
      try {
        const { data } = await supabase.schema('public').from('insightly_contacts')
          .select('first_name, last_name, date_of_birth, current_rtq_status')
          .eq('client_id', parsed.id_number).maybeSingle();
        parsed.contact = data || null;
      } catch { parsed.contact = null; }
    }
    res.json(parsed);
  } catch (err: any) {
    res.status(/404/.test(err?.message || '') ? 404 : 502).json({ error: err?.message || 'Asana lookup failed.' });
  }
});

// READ-ONLY client search (CRM). Used for name context / future autocomplete.
app.get('/api/contacts', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const matches = await searchContacts(q);
  res.json(matches);
});

// ─── P-codes (READ-ONLY lookups against public.pcodes_master) ─────────────────
// This app never writes to pcodes_master — only SELECTs to interpret a code.
const PCODE_COLS = 'code, name, business_type, category, tp_product_name, is_active, description, description_blurb';

// Search active codes (for a picker / autocomplete).
app.get('/api/pcodes', async (req, res) => {
  const q = String(req.query.q || '').trim();
  let query = supabase.schema('public').from('pcodes_master')
    .select('code, name, business_type, category, tp_product_name')
    .eq('is_active', true).order('code').limit(25);
  if (q) query = query.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Look up a single code.
app.get('/api/pcodes/:code', async (req, res) => {
  const { data, error } = await supabase.schema('public').from('pcodes_master')
    .select(PCODE_COLS).ilike('code', req.params.code).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'P-code not found' });
  res.json(data);
});

// ─── RTQ: send a Risk Questionnaire via the external Sign-Up Intake API ───────
// Mechanics mirror Shema's proven HNW rail. Sends are REAL (no sandbox) — gate
// testing on a safe contact / send_templates_to_me. Open question to confirm
// with Shema: whether a dedicated /rtq-intake varies the email by flag_type.
const SIGNUP_API_URL = (process.env.AWM_SIGNUP_API_URL || '').replace(/\/$/, '');
const SIGNUP_API_KEY = process.env.AWM_SIGNUP_API_KEY || '';
const WEBHOOK_SECRET = process.env.AWM_WEBHOOK_SECRET || '';
const WEBHOOK_URL = process.env.AWM_WEBHOOK_URL || '';

type RtqResult = { ok: boolean; status: number; body: any; error?: string };

/** POST /__signup-intake. Never throws — returns a structured result. 30s timeout. */
async function sendRtq(brief: any, opts: { deliveryMethod?: any; templatesEmail?: string; by?: string }): Promise<RtqResult> {
  if (!SIGNUP_API_URL || !SIGNUP_API_KEY) {
    return { ok: false, status: 0, body: null, error: 'RTQ sign-up API not configured (AWM_SIGNUP_API_URL / AWM_SIGNUP_API_KEY).' };
  }
  const a = brief.answers || {};
  const requestId = crypto.randomUUID();
  const payload = buildRtqPayload({
    requestId,
    insightlyContactId: a.insightly_contact_id || null,
    clientName: brief.client_name,
    email: a.email || brief.submitted_by_email || null,
    documents: ['Risk Questionnaire'],
    deliveryMethod: opts.deliveryMethod || 'e_sign',
    asanaTaskId: brief.asana_task_id || null,
    adviserEmail: brief.adviser_email || null,
    requestedBy: { name: opts.by || 'A2A Briefing', email: brief.submitted_by_email || undefined },
    callbackUrl: WEBHOOK_URL || null,
    templatesEmail: opts.templatesEmail || null,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${SIGNUP_API_URL}/__signup-intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': SIGNUP_API_KEY, 'Idempotency-Key': requestId },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body };
  } catch (err: any) {
    return { ok: false, status: 0, body: null, error: err?.name === 'AbortError' ? 'Sign-up API timed out (30s).' : (err?.message || 'Sign-up API request failed.') };
  } finally {
    clearTimeout(timer);
  }
}

/** Constant-time HMAC verify over the raw request bytes (Shema contract §2). */
function verifyShemaSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !rawBody?.length) return false;
  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Trigger an RTQ for a brief (manual). { deliveryMethod?, templatesEmail? }
app.post('/api/briefs/:id/send-rtq', async (req, res) => {
  const { data: brief, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  const result = await sendRtq(brief, {
    deliveryMethod: req.body?.delivery_method,
    templatesEmail: req.body?.templates_email,
    by: req.user?.name || req.user?.email,
  });

  if (!result.ok) {
    await logEvent(brief.id, 'RTQ send failed', req.user?.email, result.error || `HTTP ${result.status}`);
    return res.status(result.status === 0 ? 502 : result.status).json({ error: result.error || result.body?.detail || 'RTQ send failed', body: result.body });
  }
  const ref = result.body?.signup_reference || null;
  const state = result.body?.state || 'queued';
  const { data: updated } = await supabase.from('briefs')
    .update({ rtq_signup_ref: ref, rtq_state: state, rtq_sent_at: new Date().toISOString() })
    .eq('id', brief.id).select('*').single();
  await logEvent(brief.id, `RTQ sent (${state})`, req.user?.email, ref || undefined);
  res.status(result.status).json(updated || result.body);
});

// Standalone RTQ send (not tied to a saved brief) — lets the form fire an RTQ
// and keep going. Body: { insightly_contact_id?, client_name?, email?, asana_task_id?, adviser_email?, delivery_method?, templates_email? }
app.post('/api/rtq/send', async (req, res) => {
  const b = req.body || {};
  const pseudoBrief = {
    answers: { insightly_contact_id: b.insightly_contact_id, email: b.email },
    client_name: b.client_name,
    adviser_email: b.adviser_email,
    asana_task_id: b.asana_task_id,
    submitted_by_email: req.user?.email,
  };
  const result = await sendRtq(pseudoBrief, {
    deliveryMethod: b.delivery_method,
    templatesEmail: b.templates_email,
    by: req.user?.name || req.user?.email,
  });
  if (!result.ok) {
    return res.status(result.status === 0 ? 502 : result.status).json({ error: result.error || result.body?.detail || 'RTQ send failed' });
  }
  res.status(result.status).json({ signup_reference: result.body?.signup_reference, state: result.body?.state || 'queued' });
});

// Webhook from Shema on every state change. Public route: HMAC + timestamp guarded.
app.post('/api/signup-events', async (req: any, res) => {
  const sigOk = verifyShemaSignature(req.rawBody, req.headers['x-awm-signature'], WEBHOOK_SECRET);
  const tsOk = isTimestampFresh(req.headers['x-awm-timestamp']);
  if (!sigOk || !tsOk) return res.status(401).json({ error: 'invalid signature' });

  const evt = req.body || {};
  const ref = evt.signup_reference;
  try {
    if (ref) {
      const { data: brief } = await supabase.from('briefs').select('id,status').eq('rtq_signup_ref', ref).maybeSingle();
      if (brief) {
        const patch: Record<string, unknown> = { rtq_state: evt.state || evt.event };
        // RTQ signed → questionnaire now on record; lift the 24h pause.
        if (evt.state === 'signed' || evt.event === 'signed') {
          patch.risk_questionnaire_on_record = true;
          if (brief.status === 'paused_24h') { patch.status = 'submitted'; patch.pause_until = null; }
        }
        await supabase.from('briefs').update(patch).eq('id', brief.id);
        await logEvent(brief.id, `RTQ webhook: ${evt.event || evt.state}`, 'shema', evt.detail || undefined);
      }
    }
  } catch (err: any) {
    console.warn('⚠️ signup webhook handling error:', err?.message);
  }
  // Always 200 once authenticated, so Shema stops retrying (handler is idempotent).
  res.status(200).json({ success: true, request_id: evt.request_id });
});

// ─── Briefs API ────────────────────────────────────────────────────────────────
const DASHBOARD_COLS =
  'id, client_name, ceding_scheme, asana_task_id, transfer_type, transfer_value, risk_profile, adviser_email, status, pause_until, assigned_to, completed_at, archived_at, submitted_by_email, created_at';

/** Map the form answers onto the briefs table columns. `draft` relaxes the
 *  product/pause rules so a partially-complete brief can be saved. */
function rowFromAnswers(answers: Answers, draft: boolean) {
  const transferType = (TRANSFER_TYPE_FROM_LABEL[answers.transfer_type] as TransferType) || null;
  const adviserEmail = answers.adviser_email === 'Other' ? answers.adviser_email_other : answers.adviser_email;
  const noQuestionnaire = answers.risk_questionnaire_on_record === 'No';
  const transferValue = answers.transfer_value ? Number(answers.transfer_value) : null;

  let status: 'draft' | 'submitted' | 'paused_24h';
  let pauseUntil: string | null = null;
  if (draft) {
    status = 'draft';
  } else if (noQuestionnaire) {
    status = 'paused_24h';
    pauseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  } else {
    status = 'submitted';
  }

  return {
    client_name: (answers.client_name || '').trim(),
    ceding_scheme: answers.ceding_scheme?.trim() || null,
    p_code: answers.p_code?.trim() || null,
    asana_task_id: answers.asana_task_id?.trim() || null,
    transfer_type: transferType,
    transfer_value: Number.isFinite(transferValue as number) ? transferValue : null,
    client_age: answers.client_age ? parseInt(answers.client_age, 10) || null : null,
    client_dob: answers.client_dob || null,
    risk_profile: answers.risk_profile || null,
    adviser_email: adviserEmail || null,
    meeting_date: answers.meeting_date || null,
    meeting_time: answers.meeting_time || null,
    completed_by: answers.completed_by || null,
    risk_questionnaire_on_record: !noQuestionnaire,
    status,
    pause_until: pauseUntil,
    answers,
  };
}

/** Post the brief summary to Asana (non-fatal) and persist gid / error.
 *  Returns the refreshed row. Only call when not a draft. */
/**
 * On submit: replicate the old Zap's handover pipeline against the EXISTING
 * Asana task — comment, mark complete (date field + section), generate the
 * branded PDF, attach it, and (when creds exist) upload to Drive. Every step is
 * non-fatal; failures are aggregated into asana_sync_error for visibility.
 */
async function handover(brief: any, answers: Answers, by: string, updated = false) {
  const taskId: string = brief.asana_task_id;
  const errs: string[] = [];
  let commentGid: string | null = brief.asana_comment_gid || null;

  if (taskId && ASANA_TOKEN) {
    try { commentGid = await postAsanaSummary(taskId, buildAsanaSummary(answers, { by, status: brief.status, updated })); }
    catch (e: any) { errs.push(`comment: ${e?.message}`); }

    try { await markTaskComplete(taskId); } catch (e: any) { errs.push(`task-update: ${e?.message}`); }

    try {
      const pdf = await buildBriefPdf(brief);
      const fname = pdfFileName(brief);
      try { await attachPdfToTask(taskId, pdf, fname); } catch (e: any) { errs.push(`attach: ${e?.message}`); }
      const folder = `${brief.p_code || ''} - ${brief.client_name}`.replace(/^[\s-]+/, '');
      try {
        const r = await uploadHandoverToDrive(pdf, folder, fname);
        if (r.skipped) console.log('ℹ️ Drive upload skipped (not configured)');
        else console.log(`✅ Drive: filed "${fname}" → ${r.url || folder}`);
      } catch (e: any) { errs.push(`drive: ${e?.message}`); }
    } catch (e: any) { errs.push(`pdf: ${e?.message}`); }
  }

  if (errs.length) console.warn(`⚠️ handover issues for task ${taskId}:`, errs.join(' | '));
  const { data } = await supabase.from('briefs')
    .update({ asana_comment_gid: commentGid, asana_sync_error: errs.length ? errs.join(' | ') : null })
    .eq('id', brief.id).select('*').single();
  return data;
}

// List briefs. Excludes archived by default; ?archived=1 returns only archived.
app.get('/api/briefs', async (req, res) => {
  let query = supabase
    .from('briefs')
    .select(DASHBOARD_COLS)
    .order('created_at', { ascending: false })
    .limit(500);
  query = req.query.archived === '1'
    ? query.not('archived_at', 'is', null)
    : query.is('archived_at', null);
  const { data, error } = await query;
  if (error) {
    console.error('briefs list failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data || []);
});

app.get('/api/briefs/:id', async (req, res) => {
  const { data, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Brief not found' });
  res.json(data);
});

// Branded PDF handover document for a brief.
app.get('/api/briefs/:id/pdf', async (req, res) => {
  const { data: brief, error } = await supabase.from('briefs').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  try {
    const pdf = await buildBriefPdf(brief);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfFileName(brief)}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'PDF generation failed.' });
  }
});

// Create a brief. { answers, draft? } — draft:true saves a partial brief
// (status 'draft', no Asana, product optional); otherwise it's a full submit.
app.post('/api/briefs', async (req, res) => {
  const answers: Answers = (req.body?.answers || {}) as Answers;
  const draft = req.body?.draft === true;

  if (!answers.client_name?.trim()) {
    return res.status(400).json({ error: 'Client name is required to save.' });
  }
  if (!draft && !TRANSFER_TYPE_FROM_LABEL[answers.transfer_type]) {
    return res.status(400).json({ error: 'A transfer type is required to submit.' });
  }

  const row = {
    ...rowFromAnswers(answers, draft),
    submitted_by_email: req.user?.email || null,
    submitted_by_name: req.user?.name || null,
  };

  const { data, error } = await supabase.from('briefs').insert(row).select('*').single();
  if (error) {
    console.error('brief insert failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const actor = req.user?.email;
  await logEvent(data.id, draft ? 'created (draft)' : 'submitted', actor);
  if (data.status === 'submitted') await notifyOutstanding(data);

  if (!draft && data.asana_task_id && ASANA_TOKEN) {
    const updated = await handover(data, answers, req.user?.name || req.user?.email || 'Unknown');
    return res.status(201).json(updated || data);
  }
  res.status(201).json(data);
});

// Update / finalize a brief. { answers, draft? }. Preserves the original
// submitter. On final submit, posts to Asana once (if not already posted).
app.patch('/api/briefs/:id', async (req, res) => {
  const answers: Answers = (req.body?.answers || {}) as Answers;
  const draft = req.body?.draft === true;

  if (!answers.client_name?.trim()) {
    return res.status(400).json({ error: 'Client name is required to save.' });
  }
  if (!draft && !TRANSFER_TYPE_FROM_LABEL[answers.transfer_type]) {
    return res.status(400).json({ error: 'A transfer type is required to submit.' });
  }

  const { data: prior } = await supabase.from('briefs').select('status').eq('id', req.params.id).maybeSingle();

  const { data, error } = await supabase
    .from('briefs').update(rowFromAnswers(answers, draft))
    .eq('id', req.params.id).select('*').maybeSingle();
  if (error) {
    console.error('brief update failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Brief not found' });

  await logEvent(data.id, draft ? 'saved (draft)' : 'updated', req.user?.email);
  // Notify only when a brief first becomes Outstanding (draft/paused → submitted).
  if (data.status === 'submitted' && prior?.status !== 'submitted') await notifyOutstanding(data);

  // On a full submit, sync Asana — fresh comment, or an "updated" one if a
  // summary was already posted.
  if (!draft && data.asana_task_id && ASANA_TOKEN) {
    const updated = await handover(
      data, answers, req.user?.name || req.user?.email || 'Unknown', !!data.asana_comment_gid,
    );
    return res.json(updated || data);
  }
  res.json(data);
});

// Move a brief along its lifecycle (start analysis, complete, resolve pause).
app.patch('/api/briefs/:id/status', async (req, res) => {
  const target = req.body?.status as BriefStatus;
  if (!target) return res.status(400).json({ error: 'Missing target status.' });

  const { data: current, error: e1 } = await supabase
    .from('briefs').select('status').eq('id', req.params.id).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!current) return res.status(404).json({ error: 'Brief not found' });

  if (!canTransition(current.status as BriefStatus, target)) {
    return res.status(409).json({ error: `Cannot move from "${current.status}" to "${target}".` });
  }

  const patch: Record<string, unknown> = { status: target };
  if (target === 'submitted') patch.pause_until = null;                       // un-pause
  if (target === 'in_analysis') patch.assigned_to = req.user?.email || null;  // analyst picks it up
  if (target === 'completed') patch.completed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('briefs').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  await logEvent(data.id, `status: ${current.status} → ${target}`, req.user?.email);
  if (target === 'submitted') await notifyOutstanding(data); // un-paused → Outstanding
  res.json(data);
});

// Assign an analyst. Anyone may claim an UNassigned brief; only an admin may
// reassign one that's already assigned. { assigned_to: <email> | null }
app.patch('/api/briefs/:id/assign', async (req, res) => {
  const assignee = (req.body?.assigned_to ?? '').toString().trim() || null;
  const { data: current, error: e1 } = await supabase
    .from('briefs').select('assigned_to').eq('id', req.params.id).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!current) return res.status(404).json({ error: 'Brief not found' });
  if (current.assigned_to && current.assigned_to !== assignee && !isAdmin(req.user?.email)) {
    return res.status(403).json({ error: 'Only an admin can reassign a brief that already has an analyst.' });
  }
  const { data, error } = await supabase
    .from('briefs').update({ assigned_to: assignee }).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  await logEvent(data.id, assignee ? `assigned → ${assignee}` : 'unassigned', req.user?.email);
  res.json(data);
});

// Change history for a brief.
app.get('/api/briefs/:id/events', async (req, res) => {
  const { data, error } = await supabase
    .from('brief_events').select('*').eq('brief_id', req.params.id)
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Archive / unarchive (soft hide). Admin only. { archived?: boolean }.
app.patch('/api/briefs/:id/archive', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const archived = req.body?.archived !== false;
  const { data, error } = await supabase
    .from('briefs')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Brief not found' });
  await logEvent(data.id, archived ? 'archived' : 'unarchived', req.user?.email);
  res.json(data);
});

// Hard-delete — admin only, drafts only. Submitted/analysed briefs are archived.
app.delete('/api/briefs/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { data: current, error: e1 } = await supabase
    .from('briefs').select('status').eq('id', req.params.id).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!current) return res.status(404).json({ error: 'Brief not found' });
  if (current.status !== 'draft') {
    return res.status(400).json({ error: 'Only drafts can be deleted — archive submitted briefs instead.' });
  }
  const { error } = await supabase.from('briefs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// ─── Production static serving vs. dev Vite middleware ────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve('dist/public');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }
} else {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 A2A Briefing server live on port ${PORT}`);
});
