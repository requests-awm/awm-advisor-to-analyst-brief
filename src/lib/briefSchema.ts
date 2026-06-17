/**
 * Adviser-to-Analyst Pre-Analysis Client Brief — form definition.
 *
 * Single source of truth for the form: rendered by BriefForm, validated on
 * submit, summarised for Asana, and shown read-only in BriefDetail. Derived
 * from the "Adviser to Analyst Pre-Analysis Client Brief" Google Form.
 *
 * Branching: Q "transfer_type" (Pension / ISA / GIA) selects which of the
 * three product sections is shown. Everything in "Client Details",
 * "Analysis brief completion" and "Future transfers" is shown for all paths.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'time'
  | 'email'
  | 'radio'
  | 'asana_task';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  options?: string[];
  /** For a radio "Other" choice, the key of the free-text field it reveals. */
  otherKey?: string;
  /** Show only when this predicate over current answers is true. */
  showIf?: (a: Answers) => boolean;
  placeholder?: string;
  /** Format validation for a non-empty value; return an error string or null. */
  validate?: (value: string, a: Answers) => string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmail = (v: string) => (EMAIL_RE.test(v.trim()) ? null : 'Enter a valid email address.');

const isPositiveAmount = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (n < 0) return 'Amount cannot be negative.';
  return null;
};

const isPlausibleAge = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n)) return 'Enter a whole number.';
  if (n < 16 || n > 120) return 'Enter an age between 16 and 120.';
  return null;
};

/** Valid date, not in the future, and within ~1 year of the stated age. */
const isDob = (v: string, a: Answers) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Enter a valid date.';
  const now = new Date();
  if (d > now) return 'Date of birth cannot be in the future.';
  const age = a.client_age ? Number(a.client_age) : null;
  if (age != null && Number.isFinite(age)) {
    let computed = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) computed--;
    if (Math.abs(computed - age) > 1) return `Doesn't match the stated age (${age}). Computed age is ${computed}.`;
  }
  return null;
};

export type SectionDef = {
  id: string;
  title: string;
  blurb?: string;
  /** Product path this section belongs to. Undefined = always shown. */
  transferType?: TransferType;
  fields: FieldDef[];
};

export type TransferType = 'pension' | 'isa' | 'gia';
export type Answers = Record<string, string>;

export const ADVISER_EMAILS = [
  'mark.insley@ascotwm.com',
  'catriona.mccarron@ascotwm.com',
  'greg.armstrong@ascotwm.com',
  'claire.calder@ascotwm.com',
  'steve.coates@ascotwm.com',
];

export const RISK_PROFILES = [
  'Defensive Investor',
  'Cautious Investor',
  'Balanced Investor',
  'Capital Growth Investor',
  'Aggressive Investor',
];

const PLATFORMS = ['Abrdn', 'Ascot Wealth Platform (TP)', 'Fidelity', 'Other'];
const CBAM = ['CBAM R', 'CBAM P'];
const YES_NO = ['Yes', 'No'];

const FEES_HELP =
  "Confirm whether the client is on percentage-based adviser charging, a first-year retainer, or a fixed ongoing fee. Specify the charge amount or percentage. This can be found on Insightly — ensure it aligns with the client's Fee Agreement in their 'Terms of Business' folder.";
const CBAM_HELP =
  'Confirm whether the adviser intends to place the client into a CBAM R or a CBAM P portfolio as part of the transfer.';
const CBAM_REASON_HELP =
  'Specify why the adviser is recommending a CBAM R or P portfolio for the client. For example, a cost-sensitive client may suit a CBAM R portfolio due to its lower DFM charges compared to the P portfolios.';

export const SECTIONS: SectionDef[] = [
  {
    id: 'client',
    title: 'Client Details',
    blurb: 'Please complete the transfer details to follow.',
    fields: [
      { key: 'email', label: 'Email', type: 'email', required: true, validate: isEmail },
      { key: 'client_name', label: 'Client Name', type: 'text', required: true },
      { key: 'p_code', label: 'P-code', type: 'text',
        help: "Optional. Enter the case P-code (e.g. P005) — we'll look it up and pre-fill the transfer type." },
      { key: 'ceding_scheme', label: 'Ceding scheme', type: 'text', required: true,
        help: 'The provider/scheme the client is transferring FROM.' },
      { key: 'asana_task_id', label: 'Asana Task', type: 'asana_task', required: true,
        help: 'Search the transfer-analysis project by client name or P-code and pick the task. The handover (comment, complete-date, PDF) is posted back to it on submit.' },
      { key: 'transfer_value', label: 'Transfer Value (£)', type: 'currency', required: true, validate: isPositiveAmount },
      { key: 'client_age', label: 'Client Age', type: 'number', required: true, validate: isPlausibleAge },
      { key: 'client_dob', label: 'Client Date of Birth', type: 'date', required: true, validate: isDob },
      { key: 'risk_profile', label: 'Risk Profile', type: 'radio', required: true, options: RISK_PROFILES,
        help: "Identify whether the client is a Defensive, Cautious, Balanced, Capital Growth, or Aggressive investor. This can be found in the client's 894 account under FactFind > Client FactFind > True Potential Risk Profile. Also review the client bio for any updates." },
      { key: 'meeting_date', label: 'Meeting Date', type: 'date', required: true },
      { key: 'meeting_time', label: 'Meeting Time', type: 'time', required: true },
    ],
  },
  {
    id: 'completion',
    title: 'Analysis brief completion',
    fields: [
      { key: 'completed_by', label: 'Who completed the analysis client brief?', type: 'radio', required: true,
        options: ['Filled in by Analyst', 'Filled in By Adviser Team', 'Filled in By Both On Zoom', 'Filled in Together F2F'] },
      { key: 'adviser_email', label: 'Adviser Email', type: 'radio', required: true,
        options: [...ADVISER_EMAILS, 'Other'], otherKey: 'adviser_email_other' },
      { key: 'adviser_email_other', label: 'Adviser email (other)', type: 'email',
        showIf: (a) => a.adviser_email === 'Other', required: true, validate: isEmail },
      { key: 'risk_questionnaire_on_record', label: 'Is an up-to-date risk-tolerance questionnaire on record?', type: 'radio',
        required: true, options: YES_NO,
        help: 'If no risk-tolerance questionnaire is on record, a 24-hour pause is enforced until an updated questionnaire is completed before the analysis can proceed.' },
    ],
  },
  {
    id: 'product',
    title: 'Transfer Product selection',
    fields: [
      { key: 'transfer_type', label: 'Specify whether the transfer is for a pension plan, ISA or GIA', type: 'radio',
        required: true, options: ['Pension', 'ISA', 'GIA'] },
    ],
  },

  // ── Pension ────────────────────────────────────────────────────────────────
  {
    id: 'pension',
    title: 'Pension Transfer questions',
    blurb: 'Please complete the following questions with the adviser / adviser team.',
    transferType: 'pension',
    fields: [
      { key: 'p_fees', label: "Please confirm the client's agreed fees — what should we consider for this analysis?", type: 'textarea', required: true, help: FEES_HELP },
      { key: 'p_good_health', label: 'Is the client in good health?', type: 'radio', required: true, options: YES_NO, help: "Found on client factfind or client bio. If left incomplete, default to 'Yes'." },
      { key: 'p_retirement_objectives', label: "What are the client's retirement objectives?", type: 'textarea', required: true },
      { key: 'p_financial_impact', label: 'How will the transfer affect the client financially?', type: 'textarea', required: true, help: "Outline how the client may be affected: whether it reduces costs, impacts Tax-Free Cash (TFC) entitlement, or if any consolidations would offer value." },
      { key: 'p_drawdown', label: 'Has the client specifically stated that they are interested in drawdown?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_pension_assets', label: 'What pension assets does the client and their partner have?', type: 'textarea', required: true },
      { key: 'p_other_provisions', label: 'Do they have any other pension provisions? Are they DB or DC pots? Size of these pots?', type: 'textarea', required: true, help: 'This can be found on factfind.' },
      { key: 'p_moving_other', label: 'Are they moving any other pensions?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_disorganised', label: 'Is the client generally disorganised?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_reasons', label: 'What are your 3 reasons for considering transfer?', type: 'textarea', required: true },
      { key: 'p_children', label: 'Is passing on to children important?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_annuity', label: 'Does the client wish to purchase an annuity in the future?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_income_req', label: 'Does the client have specific income requirements?', type: 'radio', required: true, options: YES_NO },
      { key: 'p_income_plan', label: 'How does the client plan to achieve their income requirements?', type: 'textarea', showIf: (a) => a.p_income_req === 'Yes', required: true, help: "If answered 'Yes' to the previous question." },
      { key: 'p_cbam', label: 'Which CBAM portfolio are we using for the analysis?', type: 'radio', required: true, options: CBAM, help: CBAM_HELP },
      { key: 'p_cbam_reason', label: 'Why are we using the above portfolio for the analysis?', type: 'textarea', required: true, help: CBAM_REASON_HELP },
      { key: 'p_platform', label: 'Which platform would be preferable?', type: 'radio', required: true, options: PLATFORMS, otherKey: 'p_platform_other' },
      { key: 'p_platform_other', label: 'Platform (other)', type: 'text', showIf: (a) => a.p_platform === 'Other', required: true },
    ],
  },

  // ── ISA ──────────────────────────────────────────────────────────────────────
  {
    id: 'isa',
    title: 'ISA Transfer questions',
    blurb: 'Please complete the following questions with the adviser / adviser team.',
    transferType: 'isa',
    fields: [
      { key: 'i_fees', label: "Please confirm the client's agreed fees — what should we consider for this analysis?", type: 'textarea', required: true, help: FEES_HELP },
      { key: 'i_provider', label: 'Who is the current ISA provider?', type: 'text', required: true },
      { key: 'i_partial_full', label: 'Is this a partial or a full transfer?', type: 'radio', required: true, options: ['Partial', 'Full'] },
      { key: 'i_cash_ss', label: 'Is this a Cash ISA or a Stocks & Shares ISA?', type: 'radio', required: true, options: ['Cash ISA', 'Stocks & Shares ISA'] },
      { key: 'i_why', label: 'Why is the client looking to transfer their ISA?', type: 'textarea', required: true },
      { key: 'i_reasons', label: 'What are your 3 reasons for considering transfer?', type: 'textarea', required: true },
      { key: 'i_cbam', label: 'Which CBAM portfolio are we using for the analysis?', type: 'radio', required: true, options: CBAM, help: CBAM_HELP },
      { key: 'i_cbam_reason', label: 'Why are we using the above portfolio for the analysis?', type: 'textarea', required: true, help: CBAM_REASON_HELP },
      { key: 'i_platform', label: 'Which platform would be preferable?', type: 'radio', required: true, options: PLATFORMS, otherKey: 'i_platform_other' },
      { key: 'i_platform_other', label: 'Platform (other)', type: 'text', showIf: (a) => a.i_platform === 'Other', required: true },
    ],
  },

  // ── GIA ──────────────────────────────────────────────────────────────────────
  {
    id: 'gia',
    title: 'GIA Transfer questions',
    blurb: 'Please complete the following questions with the adviser / adviser team.',
    transferType: 'gia',
    fields: [
      { key: 'g_fees', label: "Please confirm the client's agreed fees — what should we consider for this analysis?", type: 'textarea', required: true, help: FEES_HELP },
      { key: 'g_provider', label: 'Who is the current GIA provider?', type: 'text', required: true },
      { key: 'g_why', label: 'Why is the client looking to transfer their GIA?', type: 'textarea', required: true },
      { key: 'g_reasons', label: 'What are your 3 reasons for considering transfer?', type: 'textarea', required: true },
      { key: 'g_cgt_aware', label: 'Has the client been made aware of the CGT implications involved in transferring to a new provider?', type: 'radio', required: true, options: YES_NO },
      { key: 'g_gain_loss', label: 'Will the transfer trigger a capital gain or loss?', type: 'radio', required: true, options: ['Gain', 'Loss'] },
      { key: 'g_cbam', label: 'Which CBAM portfolio are we using for the analysis?', type: 'radio', required: true, options: CBAM, help: CBAM_HELP },
      { key: 'g_cbam_reason', label: 'Why are we using the above portfolio for the analysis?', type: 'textarea', required: true, help: CBAM_REASON_HELP },
      { key: 'g_platform', label: 'Which platform would be preferable?', type: 'radio', required: true, options: PLATFORMS, otherKey: 'g_platform_other' },
      { key: 'g_platform_other', label: 'Platform (other)', type: 'text', showIf: (a) => a.g_platform === 'Other', required: true },
    ],
  },

  // ── Always last ──────────────────────────────────────────────────────────────
  {
    id: 'future',
    title: 'Any possible future transfers?',
    fields: [
      { key: 'future_transfers', label: 'Any known possible future transfers or wider assets held by the client that could be considered for charges and use of TM58?', type: 'textarea', required: true },
    ],
  },
];

export const TRANSFER_TYPE_FROM_LABEL: Record<string, TransferType> = {
  Pension: 'pension',
  ISA: 'isa',
  GIA: 'gia',
};

/** A P-code catalog row (subset) returned by /api/pcodes/:code. */
export type PcodeInfo = {
  code: string;
  name: string;
  business_type: string | null;
  category: string | null;
  tp_product_name: string | null;
  is_active: boolean;
  description?: string | null;
  description_blurb?: string | null;
};

/** Best-effort transfer-type label (Pension/ISA/GIA) from a P-code's metadata. */
export function transferLabelFromPcode(p: PcodeInfo): 'Pension' | 'ISA' | 'GIA' | null {
  const s = `${p.category || ''} ${p.tp_product_name || ''} ${p.name || ''}`.toLowerCase();
  if (/\bisa\b/.test(s)) return 'ISA';
  if (/pension|sipp|drawdown|annuity|ssas|gpp|stakeholder/.test(s)) return 'Pension';
  if (/gia|general investment|personal portfolio|unit trust|oeic|bond|cash/.test(s)) return 'GIA';
  return null;
}

/** Sections visible for the current answers (applies the product branch). */
export function visibleSections(answers: Answers): SectionDef[] {
  const tt = TRANSFER_TYPE_FROM_LABEL[answers.transfer_type];
  return SECTIONS.filter((s) => !s.transferType || s.transferType === tt);
}

/** Whether a field should render given current answers. */
export function fieldVisible(f: FieldDef, answers: Answers): boolean {
  return f.showIf ? f.showIf(answers) : true;
}

/** Format errors for visible, non-empty fields. Returns key → message. */
export function validateAnswers(answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const section of visibleSections(answers)) {
    for (const f of section.fields) {
      if (!f.validate || !fieldVisible(f, answers)) continue;
      const value = String(answers[f.key] ?? '').trim();
      if (!value) continue; // empty handled by missingRequired
      const msg = f.validate(value, answers);
      if (msg) errors[f.key] = msg;
    }
  }
  return errors;
}

/** Required visible fields that are still empty. Returns their keys. */
export function missingRequired(answers: Answers): string[] {
  const missing: string[] = [];
  for (const section of visibleSections(answers)) {
    for (const f of section.fields) {
      if (!f.required || !fieldVisible(f, answers)) continue;
      if (!String(answers[f.key] ?? '').trim()) missing.push(f.key);
    }
  }
  return missing;
}

/** Flatten all defined fields into a key→label map (for read-only views). */
export function fieldLabelMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const s of SECTIONS) for (const f of s.fields) m[f.key] = f.label;
  return m;
}
