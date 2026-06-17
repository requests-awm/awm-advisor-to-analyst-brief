import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Save, Send, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import {
  fieldVisible,
  missingRequired,
  RISK_PROFILES,
  transferLabelFromPcode,
  validateAnswers,
  visibleSections,
  type Answers,
  type PcodeInfo,
} from '../lib/briefSchema';

/** Whole-year age from a YYYY-MM-DD date. */
function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
import type { Brief, CurrentUser } from '../lib/types';
import { Field } from './Field';
import { FullScreenLoader } from './BrandedStates';

export function BriefForm({ user }: { user: CurrentUser | null }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const userEditedAge = useRef(false);
  const [rtqBusy, setRtqBusy] = useState(false);
  const [rtqMsg, setRtqMsg] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Answers>(() => {
    const init: Answers = {};
    if (!isEdit && user?.email) init.email = user.email;
    return init;
  });
  const [loading, setLoading] = useState(isEdit);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Brief[]>([]);
  const [pcode, setPcode] = useState<PcodeInfo | null>(null);
  const [pcodeMsg, setPcodeMsg] = useState<string | null>(null);
  const [taskInfo, setTaskInfo] = useState<{ full_name?: string; code?: string; product?: string; platform?: string } | null>(null);

  // Look up the Asana task title (debounced) and pre-fill client name + P-code.
  useEffect(() => {
    const id = (answers.asana_task_id || '').trim();
    if (!/^\d{6,}$/.test(id)) { setTaskInfo(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/asana-task/${encodeURIComponent(id)}`);
        if (cancelled || !res.ok) return;
        const info = await res.json();
        if (!info.full_name && !info.code) return;
        setTaskInfo(info);
        setAnswers((prev) => {
          const next = { ...prev };
          if (info.full_name && !prev.client_name) next.client_name = info.full_name;
          if (info.code && !prev.p_code) next.p_code = info.code;
          if (info.id_number) next.insightly_contact_id = info.id_number; // for RTQ send / CRM

          // Pre-fill DOB / age / risk from the CRM contact (only where empty).
          const c = info.contact;
          if (c) {
            const dob = c.date_of_birth ? String(c.date_of_birth).slice(0, 10) : '';
            if (dob && !prev.client_dob) {
              next.client_dob = dob;
              const age = ageFromDob(dob);
              if (age != null && !prev.client_age) next.client_age = String(age);
            }
            if (c.current_rtq_status && RISK_PROFILES.includes(c.current_rtq_status) && !prev.risk_profile) {
              next.risk_profile = c.current_rtq_status;
            }
          }
          return next;
        });
      } catch { /* advisory only */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [answers.asana_task_id]);

  // When the user TYPES an age, drive the DOB's birth year (keeping any month/day)
  // so the date picker opens at the right year. Gated on a real edit so a CRM-
  // prefilled DOB isn't clobbered on load.
  useEffect(() => {
    if (!userEditedAge.current) return;
    const age = parseInt(answers.client_age || '', 10);
    if (!Number.isInteger(age) || age <= 0 || age >= 120) return;
    const birthYear = new Date().getFullYear() - age;
    setAnswers((prev) => {
      const cur = prev.client_dob || '';
      const mmdd = /^\d{4}(-\d{2}-\d{2})$/.test(cur) ? cur.slice(4) : '-01-01';
      const desired = `${birthYear}${mmdd}`;
      return cur === desired ? prev : { ...prev, client_dob: desired };
    });
  }, [answers.client_age]);

  // Look up the P-code in the read-only catalogue (debounced) and pre-fill the
  // transfer type when it's still empty.
  useEffect(() => {
    const code = (answers.p_code || '').trim();
    if (!code) { setPcode(null); setPcodeMsg(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/pcodes/${encodeURIComponent(code)}`);
        if (cancelled) return;
        if (res.status === 404) { setPcode(null); setPcodeMsg(`P-code "${code}" not found in the catalogue.`); return; }
        if (!res.ok) { setPcode(null); setPcodeMsg(null); return; }
        const info: PcodeInfo = await res.json();
        setPcode(info);
        setPcodeMsg(null);
        const label = transferLabelFromPcode(info);
        if (label) setAnswers((prev) => (prev.transfer_type ? prev : { ...prev, transfer_type: label }));
      } catch { /* advisory only */ }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [answers.p_code]);

  // Load existing briefs once to warn about duplicates (same Asana task / client).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/briefs');
        if (res.ok && !cancelled) setExisting(await res.json());
      } catch { /* non-fatal — duplicate check is advisory */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Edit mode: load the existing brief and prefill.
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/briefs/${id}`);
        if (!res.ok) throw new Error(`Failed to load brief (HTTP ${res.status})`);
        const brief: Brief = await res.json();
        if (!cancelled) setAnswers(brief.answers || {});
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load brief');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isEdit]);

  const sections = useMemo(() => visibleSections(answers), [answers]);
  const noRiskQuestionnaire = answers.risk_questionnaire_on_record === 'No';

  // Advisory: other (non-archived) briefs that share this Asana task or client name.
  const duplicates = useMemo(() => {
    const task = (answers.asana_task_id || '').trim().toLowerCase();
    const name = (answers.client_name || '').trim().toLowerCase();
    if (!task && !name) return [];
    return existing.filter((b) => {
      if (b.id === id) return false; // not itself (edit mode)
      const sameTask = task && (b.asana_task_id || '').trim().toLowerCase() === task;
      const sameName = name && b.client_name.trim().toLowerCase() === name;
      return sameTask || sameName;
    });
  }, [existing, answers.asana_task_id, answers.client_name, id]);

  function onChange(key: string, value: string) {
    if (key === 'client_age') userEditedAge.current = true;
    setAnswers((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // Send an RTQ without leaving the form (not tied to a saved brief yet).
  async function sendRtqInline(deliveryMethod: 'e_sign' | 'send_templates_to_me') {
    if (!answers.insightly_contact_id && !answers.client_name?.trim()) {
      setError('Select the task (or enter a client name) before sending an RTQ.');
      return;
    }
    if (deliveryMethod === 'e_sign' && !confirm('Send a REAL Risk Questionnaire e-sign invite to this client now?')) return;
    setRtqBusy(true);
    setRtqMsg(null);
    setError(null);
    try {
      const res = await apiFetch('/api/rtq/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insightly_contact_id: answers.insightly_contact_id,
          client_name: answers.client_name,
          email: answers.email,
          asana_task_id: answers.asana_task_id,
          adviser_email: answers.adviser_email === 'Other' ? answers.adviser_email_other : answers.adviser_email,
          delivery_method: deliveryMethod,
          templates_email: user?.email,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || 'RTQ send failed');
      setRtqMsg(`RTQ ${deliveryMethod === 'send_templates_to_me' ? 'templates sent to you' : 'sent to the client'} ✓${b.signup_reference ? ` · ref ${b.signup_reference}` : ''} — carry on with the form.`);
    } catch (err: any) {
      setError(err?.message || 'RTQ send failed.');
    } finally {
      setRtqBusy(false);
    }
  }

  async function persist(draft: boolean) {
    setError(null);

    // Draft only needs a client name; a full submit validates required + formats.
    if (!answers.client_name?.trim()) {
      setFieldErrors({ client_name: 'Required.' });
      setError('Client name is required to save.');
      document.getElementById('f-client_name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!draft) {
      const errs: Record<string, string> = {};
      for (const k of missingRequired(answers)) errs[k] = 'Required.';
      Object.assign(errs, validateAnswers(answers));
      if (Object.keys(errs).length) {
        setFieldErrors(errs);
        const n = Object.keys(errs).length;
        setError(`Please fix the ${n} field${n > 1 ? 's' : ''} highlighted below.`);
        document.getElementById(`f-${Object.keys(errs)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await apiFetch(isEdit ? `/api/briefs/${id}` : '/api/briefs', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (HTTP ${res.status})`);
      }
      const brief: Brief = await res.json();
      navigate(`/brief/${brief.id}`, { state: draft ? { justSavedDraft: true } : { justSubmitted: true } });
    } catch (err: any) {
      setError(err?.message || 'Save failed. Please try again.');
      setSubmitting(false);
    }
  }

  if (loading) return <FullScreenLoader message="Loading brief…" />;

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="awm-card mb-6 border-l-4 border-l-[var(--color-gold)] p-6">
        <h1 className="text-2xl font-semibold">
          {isEdit ? 'Edit / complete brief' : 'Adviser to Analyst Pre-Analysis Client Brief'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-text)]">
          Complete this brief before beginning the transfer analysis. It captures the qualitative
          context that won't appear in provider illustrations or the key product questionnaire. You
          can <strong>save a draft</strong> at any point (only a client name is needed) and finish it later.
        </p>
      </div>

      {taskInfo && (taskInfo.full_name || taskInfo.code) && (
        <div className="mb-6 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-100">
          <strong>From the Asana task:</strong>{' '}
          {[taskInfo.full_name, taskInfo.code, taskInfo.product, taskInfo.platform].filter(Boolean).join(' · ')}
          <span className="text-sky-200/80"> — client name &amp; P-code pre-filled where empty.</span>
        </div>
      )}

      {pcodeMsg && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {pcodeMsg}
        </div>
      )}

      {pcode && (() => {
        const label = transferLabelFromPcode(pcode);
        const isTransfer = /transfer|replacement/i.test(pcode.business_type || '');
        return (
          <div className="mb-6 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 shrink-0 text-sky-300" size={18} />
              <div className="text-sm text-sky-100">
                <strong>{pcode.code} — {pcode.name}</strong>
                <div className="mt-1 text-sky-200/90">
                  {[pcode.business_type, pcode.category, pcode.tp_product_name].filter(Boolean).join(' · ')}
                  {!pcode.is_active && ' · (inactive)'}
                </div>
                {label && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sky-200/90">Suggested transfer type: <strong>{label}</strong></span>
                    {answers.transfer_type !== label && (
                      <button
                        type="button"
                        onClick={() => onChange('transfer_type', label)}
                        className="rounded-md border border-sky-400/50 px-2 py-0.5 text-xs font-medium text-sky-100 hover:bg-sky-400/10"
                      >
                        Use {label}
                      </button>
                    )}
                  </div>
                )}
                {!isTransfer && (
                  <div className="mt-2 text-amber-300">
                    Note: this P-code is a “{pcode.business_type}”, not a transfer — A2A briefs are for transfer business.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {duplicates.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={18} />
            <div className="text-sm text-amber-200">
              <strong>Possible duplicate.</strong> A brief already exists for this client / Asana task:
              <ul className="mt-1 space-y-0.5">
                {duplicates.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    <Link to={`/brief/${d.id}`} className="underline hover:text-amber-100">
                      {d.client_name}
                    </Link>
                    {d.asana_task_id ? ` · task ${d.asana_task_id}` : ''} · {d.status}
                  </li>
                ))}
              </ul>
              <span className="mt-1 block text-amber-200/80">You can still continue if this is intentional.</span>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.id} className="awm-card p-6">
            <h2 className="text-lg font-semibold text-[var(--color-gold)]">{section.title}</h2>
            {section.blurb && <p className="mt-1 text-sm text-[var(--color-muted-text)]">{section.blurb}</p>}
            <div className="mt-5 space-y-6">
              {section.fields.filter((f) => fieldVisible(f, answers)).map((f) => (
                <div key={f.key} className="space-y-3">
                  <Field field={f} value={answers[f.key] ?? ''} onChange={onChange} error={fieldErrors[f.key]} />
                  {f.key === 'risk_questionnaire_on_record' && noRiskQuestionnaire && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={16} />
                        <div>
                          <strong>24-hour pause.</strong> No questionnaire on record — send the client a new RTQ now and carry on; on submit the brief is flagged as paused until it's signed.
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => sendRtqInline('e_sign')} disabled={rtqBusy} className="awm-btn-gold flex items-center gap-1.5 !py-1.5 text-sm">
                              <Send size={14} /> {rtqBusy ? 'Sending…' : 'Send RTQ to client'}
                            </button>
                            <button type="button" onClick={() => sendRtqInline('send_templates_to_me')} disabled={rtqBusy} className="awm-btn-ghost !py-1.5 text-sm" title="Sends the templates to your own email — safe for testing">
                              Test: send to me
                            </button>
                          </div>
                          {rtqMsg && <p className="mt-2 text-emerald-300">{rtqMsg}</p>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border-dark)] bg-[#0c1322]/85 py-4 backdrop-blur">
        <button className="awm-btn-ghost" onClick={() => navigate('/')} disabled={submitting}>
          Cancel
        </button>
        <button className="awm-btn-ghost flex items-center gap-2" onClick={() => persist(true)} disabled={submitting}>
          <Save size={16} /> Save draft
        </button>
        <button className="awm-btn-gold flex items-center gap-2" onClick={() => persist(false)} disabled={submitting}>
          <Send size={16} />
          {submitting ? 'Saving…' : 'Submit brief'}
        </button>
      </div>
    </div>
  );
}
