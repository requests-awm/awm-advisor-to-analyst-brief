 import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArrowDown, ArrowUp, FilePlus2, Pencil, Search, UserRound } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { STATUS_LABEL, type BriefStatus } from '../lib/lifecycle';
import type { Brief, CurrentUser } from '../lib/types';
import { EmptyState } from './BrandedStates';

// A brief still awaiting analysis (Outstanding) longer than this is "overdue".
const OVERDUE_DAYS = 3;
const ACTIVE_STATUSES: BriefStatus[] = ['draft', 'paused_24h', 'submitted', 'in_analysis'];

function typeLabel(t: Brief['transfer_type']): string {
  return t === 'pension' ? 'Pension' : t === 'isa' ? 'ISA' : t === 'gia' ? 'GIA' : '—';
}

function fmtMoney(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** Age label + overdue flag for still-active briefs. */
function ageInfo(b: Brief): { label: string; overdue: boolean } {
  if (!ACTIVE_STATUSES.includes(b.status)) return { label: '—', overdue: false };
  const d = daysSince(b.created_at);
  const label = d <= 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
  return { label, overdue: b.status === 'submitted' && d >= OVERDUE_DAYS };
}

type SortCol = 'client_name' | 'transfer_value' | 'status' | 'created_at';
type SortState = { col: SortCol; dir: 'asc' | 'desc' };

function Th({ col, sort, onSort, children }: { col: SortCol; sort: SortState; onSort: (c: SortCol) => void; children: ReactNode }) {
  const active = sort.col === col;
  return (
    <th className="px-4 py-3 font-medium">
      <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-200">
        {children}
        {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

const STATUS_STYLE: Record<BriefStatus, string> = {
  draft: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  paused_24h: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  submitted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  in_analysis: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  completed: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

function StatusPill({ status }: { status: BriefStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

type StatusFilter = 'all' | BriefStatus;
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Outstanding' },
  { key: 'in_analysis', label: 'In analysis' },
  { key: 'paused_24h', label: 'Paused' },
  { key: 'draft', label: 'Drafts' },
  { key: 'completed', label: 'Completed' },
];

export function Dashboard({ user }: { user: CurrentUser | null }) {
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: 'created_at', dir: 'desc' });
  const myEmail = (user?.email || '').toLowerCase();

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'client_name' ? 'asc' : 'desc' }));
  }

  useEffect(() => {
    let cancelled = false;
    setBriefs(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/briefs${showArchived ? '?archived=1' : ''}`);
        if (!res.ok) throw new Error(`Failed to load briefs (HTTP ${res.status})`);
        const data: Brief[] = await res.json();
        if (!cancelled) setBriefs(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load briefs');
      }
    })();
    return () => { cancelled = true; };
  }, [showArchived]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of briefs || []) c[b.status] = (c[b.status] || 0) + 1;
    return c;
  }, [briefs]);

  const filtered = useMemo(() => {
    if (!briefs) return [];
    const needle = q.trim().toLowerCase();
    return briefs.filter((b) => {
      if (filter !== 'all' && b.status !== filter) return false;
      if (mineOnly && myEmail) {
        const mine = (b.assigned_to || '').toLowerCase() === myEmail ||
          (b.submitted_by_email || '').toLowerCase() === myEmail;
        if (!mine) return false;
      }
      if (!needle) return true;
      return (
        b.client_name.toLowerCase().includes(needle) ||
        (b.ceding_scheme || '').toLowerCase().includes(needle) ||
        (b.asana_task_id || '').toLowerCase().includes(needle) ||
        (b.adviser_email || '').toLowerCase().includes(needle)
      );
    });
  }, [briefs, q, filter, mineOnly, myEmail]);

  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (b: Brief) => {
      switch (sort.col) {
        case 'client_name': return b.client_name.toLowerCase();
        case 'transfer_value': return b.transfer_value ?? -1;
        case 'status': return b.status;
        default: return b.created_at;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [filtered, sort]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{showArchived ? 'Archived briefs' : 'Adviser-to-Analyst briefs'}</h1>
          <p className="text-sm text-[var(--color-muted-text)]">
            Track every pre-analysis brief through its lifecycle: outstanding → in analysis → completed.
          </p>
        </div>
        <Link to="/new" className="awm-btn-gold flex items-center gap-2">
          <FilePlus2 size={16} /> New Brief
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            className="awm-input pl-9"
            placeholder="Search client, ceding scheme, Asana task ID, adviser…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {myEmail && (
          <button
            className={`awm-btn-ghost flex items-center gap-1.5 ${mineOnly ? '!border-[var(--color-gold)] !text-[var(--color-gold)]' : ''}`}
            onClick={() => setMineOnly((v) => !v)}
          >
            <UserRound size={15} /> My briefs
          </button>
        )}
        <button
          className={`awm-btn-ghost flex items-center gap-1.5 ${showArchived ? '!border-[var(--color-gold)] !text-[var(--color-gold)]' : ''}`}
          onClick={() => { setShowArchived((v) => !v); setFilter('all'); }}
        >
          <Archive size={15} /> {showArchived ? 'Back to active' : 'Archived'}
        </button>
      </div>

      {!showArchived && (
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`${filter === f.key ? 'awm-btn-gold' : 'awm-btn-ghost'} !py-1.5 text-sm`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] ? ` (${counts[f.key]})` : ''}
              {f.key === 'all' && briefs ? ` (${briefs.length})` : ''}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      ) : !briefs ? (
        <div className="awm-card p-8 text-center text-sm text-[var(--color-muted-text)]">Loading briefs…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={showArchived ? 'No archived briefs' : q || filter !== 'all' ? 'No briefs match your filter' : 'No briefs captured yet'}
          subtitle={q || filter !== 'all' ? 'Try clearing the search or filter.' : showArchived ? '' : 'Create the first brief to get started.'}
        />
      ) : (
        <div className="awm-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-dark)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-text)]">
                <Th col="client_name" sort={sort} onSort={toggleSort}>Client</Th>
                <th className="px-4 py-3 font-medium">Ceding scheme</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <Th col="transfer_value" sort={sort} onSort={toggleSort}>Value</Th>
                <th className="px-4 py-3 font-medium">Adviser</th>
                <Th col="status" sort={sort} onSort={toggleSort}>Status</Th>
                <th className="px-4 py-3 font-medium">Age</th>
                <Th col="created_at" sort={sort} onSort={toggleSort}>Captured</Th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const age = ageInfo(b);
                return (
                  <tr key={b.id} className="border-b border-[var(--color-border-dark)]/60 transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <Link to={`/brief/${b.id}`} className="font-medium text-slate-100 hover:text-[var(--color-gold)]">
                        {b.client_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{b.ceding_scheme || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{typeLabel(b.transfer_type)}</td>
                    <td className="px-4 py-3 text-slate-300">{fmtMoney(b.transfer_value)}</td>
                    <td className="px-4 py-3 text-slate-400">{b.adviser_email || '—'}</td>
                    <td className="px-4 py-3"><StatusPill status={b.status} /></td>
                    <td className="px-4 py-3">
                      {age.overdue
                        ? <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-300">{age.label} · overdue</span>
                        : <span className="text-slate-400">{age.label}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{fmtDate(b.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/brief/${b.id}/edit`}
                        title={b.status === 'draft' ? 'Continue' : 'Edit'}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-[var(--color-gold)]"
                      >
                        <Pencil size={14} /> {b.status === 'draft' ? 'Continue' : 'Edit'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
