/**
 * RTQ / Sign-Up Intake — pure helpers (no I/O, no crypto), per Shema's contract.
 * The HTTP send + HMAC verification live in server.ts; this module holds the
 * payload builder, RTQ decision logic, and timestamp-freshness check so they
 * can be unit-reasoned in isolation.
 *
 * ⚠️ Sends are REAL (no sandbox) — a 202 emails a SignNow invite to the contact.
 * Test only with a known-safe dummy contact, or delivery_method
 * 'send_templates_to_me' to an internal address.
 */

export type RtqOnRecord = 'initial' | 'reassessment' | 'confirmation';

/** Normalise the CRM risk-status: '', '-', 'No RTQ', 'none', 'n/a' all mean NOT on record. */
export function rtqIsOnRecord(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return !(s === '' || s === '-' || s === 'no rtq' || s === 'none' || s === 'n/a');
}

/**
 * Three-state RTQ flag (Shema contract §3):
 *  - no record           → 'initial'
 *  - on record + stale >12mo (or contradicted) → 'reassessment'
 *  - on record + fresh + clean → 'confirmation'
 * lastAssessedIso / contradicted are optional; when unknown, on-record → 'confirmation'.
 */
export function rtqFlag(
  status: string | null | undefined,
  opts: { lastAssessedIso?: string | null; contradicted?: boolean; now?: number } = {},
): RtqOnRecord {
  if (!rtqIsOnRecord(status)) return 'initial';
  if (opts.contradicted) return 'reassessment';
  if (opts.lastAssessedIso) {
    const t = new Date(opts.lastAssessedIso).getTime();
    if (Number.isFinite(t)) {
      const months = ((opts.now ?? Date.now()) - t) / (30.44 * 24 * 3600 * 1000);
      if (months > 12) return 'reassessment';
    }
  }
  return 'confirmation';
}

/** Unit-tolerant freshness check (unix seconds OR ms), default ±5 minutes. */
export function isTimestampFresh(header: string | undefined, maxSkewSec = 300, now = Date.now()): boolean {
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n < 1e12 ? n * 1000 : n; // < 1e12 → seconds, else already ms
  return Math.abs(now - ms) <= maxSkewSec * 1000;
}

export type RtqSendInput = {
  requestId: string;
  insightlyContactId?: string | null;
  clientName?: string | null;
  email?: string | null;
  documents?: string[];
  deliveryMethod?: 'e_sign' | 'email' | 'send_templates_to_me';
  asanaTaskId?: string | null;
  adviserEmail?: string | null;
  requestedBy?: { name?: string; email?: string };
  callbackUrl?: string | null;
  templatesEmail?: string | null;
};

/** Build the /__signup-intake body. Prefers the Insightly id; else a client block. */
export function buildRtqPayload(i: RtqSendInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    request_id: i.requestId,
    documents: i.documents && i.documents.length ? i.documents : ['Risk Questionnaire'],
    delivery_method: i.deliveryMethod || 'e_sign',
  };
  if (i.insightlyContactId) {
    body.insightly_contact_id = String(i.insightlyContactId);
  } else {
    const [first, ...rest] = String(i.clientName ?? '').trim().split(/\s+/);
    body.client = { first_name: first || 'Client', last_name: rest.join(' ') || '-', email: i.email || undefined };
  }
  if (i.asanaTaskId) body.asana_task_id = i.asanaTaskId;
  if (i.adviserEmail) body.target_team_email = i.adviserEmail;
  if (i.requestedBy) body.requested_by = i.requestedBy;
  if (i.callbackUrl) body.callback_url = i.callbackUrl;
  if (i.deliveryMethod === 'send_templates_to_me') body.templates_email = i.templatesEmail || i.email || undefined;
  return body;
}
