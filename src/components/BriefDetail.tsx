import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, ArrowLeft, CheckCircle2, CheckCheck, Clock, Download,
  ExternalLink, FileEdit, History, Pencil, Play, Printer, Send, ShieldAlert, Sparkles, Trash2, UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { SECTIONS, fieldVisible, type Answers } from '../lib/briefSchema';
import { NEXT_ACTIONS, STATUS_LABEL, type BriefStatus } from '../lib/lifecycle';
import type { Brief, BriefEvent, CurrentUser } from '../lib/types';
import { FullScreenError, FullScreenLoader } from './BrandedStates';

function sectionsForType(answers: Answers) {
  const tt = (answers.transfer_type || '').toLowerCase();
  return SECTIONS.filter((s) => !s.transferType || s.transferType === tt);
}

const STATUS_STYLE: Record<BriefStatus, string> = {
  draft: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  paused_24h: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  submitted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  in_analysis: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  completed: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

const ACTION_ICON: Record<BriefStatus, typeof Play> = {
  submitted: CheckCircle2,
  in_analysis: Play,
  completed: CheckCheck,
  draft: FileEdit,
  paused_24h: Clock,
};

function asanaUrl(taskId: string): string {
  return `https://app.asana.com/0/0/${encodeURIComponent(taskId)}`;
}

export function BriefDetail({ user }: { user: CurrentUser | null }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const justSubmitted = (location.state as any)?.justSubmitted === true;
  const justSavedDraft = (location.state as any)?.justSavedDraft === true;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [events, setEvents] = useState<BriefEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isAdmin = !!user?.admin;

  async function loadEvents() {
    try {
      const res = await apiFetch(`/api/briefs/${id}/events`);
      if (res.ok) setEvents(await res.json());
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/briefs/${id}`);
        if (!res.ok) throw new Error(`Failed to load brief (HTTP ${res.status})`);
        const data: Brief = await res.json();
        if (!cancelled) setBrief(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load brief');
      }
    })();
    loadEvents();
    return () => { cancelled = true; };
  }, [id]);

  async function act(path: string, method: string, body?: unknown) {
    setActionError(null);
    setBusy(true);
    try {
      const res = await apiFetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (method === 'DELETE') {
        if (!res.ok && res.status !== 204) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b?.error || `Failed (HTTP ${res.status})`);
        }
        navigate('/');
        return;
      }
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b?.error || `Failed (HTTP ${res.status})`);
      setBrief(b as Brief);
      loadEvents();
    } catch (err: any) {
      setActionError(err?.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function assign() {
    const who = prompt('Assign to (email):', user?.email || '');
    if (who === null) return;
    act(`/api/briefs/${brief!.id}/assign`, 'PATCH', { assigned_to: who.trim() });
  }

  async function downloadPdf() {
    setActionError(null);
    try {
      const res = await apiFetch(`/api/briefs/${brief!.id}/pdf`);
      if (!res.ok) throw new Error(`PDF failed (HTTP ${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setActionError(err?.message || 'Could not generate PDF.');
    }
  }

  if (error) return <FullScreenError message={error} />;
  if (!brief) return <FullScreenLoader message="Loading brief…" />;

  const answers = brief.answers || {};
  const nextActions = NEXT_ACTIONS[brief.status] || [];
  const canReassign = isAdmin || !brief.assigned_to; // non-admins can only claim unassigned

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <Link to="/" className="no-print mb-4 inline-flex items-center gap-2 text-sm text-[var(--color-muted-text)] hover:text-slate-200">
        <ArrowLeft size={15} /> Back to dashboard
      </Link>

      {justSubmitted && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={18} />
          <div className="text-sm text-emerald-200">
            <strong>Brief submitted.</strong>{' '}
            {brief.asana_comment_gid
              ? 'A summary has been posted to the Asana task.'
              : brief.asana_sync_error
                ? `Saved, but the Asana summary could not be posted: ${brief.asana_sync_error}`
                : 'Saved.'}
          </div>
        </div>
      )}

      {justSavedDraft && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-slate-500/40 bg-slate-500/10 p-4">
          <FileEdit className="mt-0.5 shrink-0 text-slate-300" size={18} />
          <div className="text-sm text-slate-200">
            <strong>Draft saved.</strong> It's on the dashboard for you or an adviser to complete and submit later.
          </div>
        </div>
      )}

      <div className="awm-card mb-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{brief.client_name}</h1>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[brief.status]}`}>
                {STATUS_LABEL[brief.status]}
              </span>
              {brief.archived_at && (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/50 bg-slate-700/20 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                  <Archive size={12} /> Archived
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted-text)]">
              {brief.transfer_type ? `${brief.transfer_type.toUpperCase()} transfer · ` : ''}
              captured {new Date(brief.created_at).toLocaleString('en-GB')}
              {brief.submitted_by_name ? ` by ${brief.submitted_by_name}` : ''}
            </p>
            {(brief.assigned_to || brief.completed_at) && (
              <p className="mt-1 text-xs text-[var(--color-muted-text)]">
                {brief.assigned_to ? `Analyst: ${brief.assigned_to}` : ''}
                {brief.assigned_to && brief.completed_at ? ' · ' : ''}
                {brief.completed_at ? `Completed ${new Date(brief.completed_at).toLocaleString('en-GB')}` : ''}
              </p>
            )}
          </div>
        </div>

        {brief.status === 'paused_24h' && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
            No risk-tolerance questionnaire was on record at submission. A 24-hour pause applies until an updated
            questionnaire is completed{brief.pause_until ? ` (until ${new Date(brief.pause_until).toLocaleString('en-GB')})` : ''}.
            Once it's on record, use <strong>"{NEXT_ACTIONS.paused_24h[0]?.label}"</strong> below.
          </p>
        )}

        {/* Actions toolbar */}
        <div className="no-print mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-dark)] pt-4">
          {nextActions.map((a) => {
            const Icon = ACTION_ICON[a.to];
            return (
              <button
                key={a.to}
                onClick={() => act(`/api/briefs/${brief.id}/status`, 'PATCH', { status: a.to })}
                disabled={busy}
                className="awm-btn-gold flex items-center gap-1.5 !py-1.5 text-sm"
              >
                <Icon size={14} /> {a.label}
              </button>
            );
          })}

          <button
            onClick={() => navigate(`/brief/${brief.id}/edit`)}
            disabled={busy}
            className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
          >
            <Pencil size={14} /> {brief.status === 'draft' ? 'Continue' : 'Edit'}
          </button>

          {canReassign && (
            <button
              onClick={assign}
              disabled={busy}
              className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
            >
              <UserPlus size={14} /> {brief.assigned_to ? 'Reassign' : 'Assign'}
            </button>
          )}

          {brief.asana_task_id && (
            <a
              href={asanaUrl(brief.asana_task_id)}
              target="_blank"
              rel="noreferrer"
              className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
            >
              <ExternalLink size={14} /> Open Asana task
            </a>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={downloadPdf}
              className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
            >
              <Download size={14} /> PDF handover
            </button>
            <button
              onClick={() => window.print()}
              className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
            >
              <Printer size={14} /> Print
            </button>
            {isAdmin && brief.archived_at && (
              <button
                onClick={() => act(`/api/briefs/${brief.id}/archive`, 'PATCH', { archived: false })}
                disabled={busy}
                className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
              >
                <ArchiveRestore size={14} /> Unarchive
              </button>
            )}
            {isAdmin && !brief.archived_at && brief.status !== 'draft' && (
              <button
                onClick={() => act(`/api/briefs/${brief.id}/archive`, 'PATCH', { archived: true })}
                disabled={busy}
                className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
              >
                <Archive size={14} /> Archive
              </button>
            )}

            {isAdmin && brief.status === 'draft' && (
              <button
                onClick={() => { if (confirm('Delete this draft? This cannot be undone.')) act(`/api/briefs/${brief.id}`, 'DELETE'); }}
                disabled={busy}
                className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm !text-red-300 hover:!border-red-500/40"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>

        {actionError && <p className="mt-3 text-sm text-red-400">{actionError}</p>}
      </div>

      {/* RTQ — send a Risk Questionnaire when it's out of date / not on record */}
      {(!brief.risk_questionnaire_on_record || brief.rtq_state) && (
        <section className="awm-card no-print mb-6 p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-amber-300">
            <ShieldAlert size={16} /> Risk-tolerance questionnaire
          </h2>
          {brief.rtq_state ? (
            <p className="mt-2 text-sm text-slate-200">
              RTQ status: <strong>{brief.rtq_state}</strong>
              {brief.rtq_sent_at ? ` · sent ${new Date(brief.rtq_sent_at).toLocaleString('en-GB')}` : ''}
              {brief.rtq_signup_ref ? ` · ref ${brief.rtq_signup_ref}` : ''}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-muted-text)]">
              No up-to-date questionnaire on record. Send the client a new RTQ to e-sign — when signed, the 24-hour pause lifts automatically.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => { if (confirm('Send a REAL Risk Questionnaire e-sign invite to this client?')) act(`/api/briefs/${brief.id}/send-rtq`, 'POST', { delivery_method: 'e_sign' }); }}
              disabled={busy}
              className="awm-btn-gold flex items-center gap-1.5 !py-1.5 text-sm"
            >
              <Send size={14} /> Send RTQ to client
            </button>
            <button
              onClick={() => act(`/api/briefs/${brief.id}/send-rtq`, 'POST', { delivery_method: 'send_templates_to_me' })}
              disabled={busy}
              className="awm-btn-ghost flex items-center gap-1.5 !py-1.5 text-sm"
              title="Sends the templates to your own email — safe for testing"
            >
              Test: send to me
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-300/80">⚠️ Sends are real — no sandbox. "Send to client" emails a SignNow invite to the client's address on file.</p>
        </section>
      )}

      <div className="space-y-6">
        {sectionsForType(answers).map((section) => {
          const fields = section.fields.filter((f) => fieldVisible(f, answers) && String(answers[f.key] ?? '').trim());
          if (fields.length === 0) return null;
          return (
            <section key={section.id} className="awm-card p-6">
              <h2 className="mb-4 text-base font-semibold text-[var(--color-gold)]">{section.title}</h2>
              <dl className="space-y-4">
                {fields.map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs uppercase tracking-wide text-[var(--color-muted-text)]">{f.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{answers[f.key]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>

      <section className="awm-card mt-6 p-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-gold)]">
            <Sparkles size={16} /> AI draft conclusions
          </h2>
          <button
            onClick={() => act(`/api/briefs/${brief.id}/suggest`, 'POST')}
            disabled={busy}
            className="awm-btn-ghost no-print flex items-center gap-1.5 !py-1.5 text-sm"
          >
            <Sparkles size={14} /> {busy ? 'Generating…' : brief.ai_suggestions ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        <p className="mb-3 text-xs text-amber-300/90">
          AI-generated draft to orient the analyst — <strong>not advice and not final</strong>. A qualified analyst must review and verify everything.
        </p>
        {brief.ai_suggestions ? (
          <>
            <div className="whitespace-pre-wrap text-sm text-slate-100">{brief.ai_suggestions}</div>
            {brief.ai_suggestions_at && (
              <p className="mt-3 text-xs text-[var(--color-muted-text)]">Generated {new Date(brief.ai_suggestions_at).toLocaleString('en-GB')}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted-text)]">No draft yet — click <em>Generate</em> to produce preliminary observations from this brief.</p>
        )}
      </section>

      {events.length > 0 && (
        <section className="awm-card no-print mt-6 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-[var(--color-gold)]">
            <History size={16} /> Change history
          </h2>
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-gold)]" />
                <div>
                  <span className="text-slate-100">{ev.action}</span>
                  <span className="text-[var(--color-muted-text)]">
                    {ev.actor_email ? ` · ${ev.actor_email}` : ''} · {new Date(ev.created_at).toLocaleString('en-GB')}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
