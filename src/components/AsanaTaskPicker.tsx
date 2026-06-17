import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

type TaskHit = { gid: string; name: string };

/**
 * Search the A2A Asana project by free text and pick a task — fills the
 * asana_task_id (gid). Falls back to pasting an ID manually.
 */
export function AsanaTaskPicker({ value, onChange }: { value: string; onChange: (gid: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TaskHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/asana-tasks?q=${encodeURIComponent(q.trim())}`);
        if (!cancelled && res.ok) setResults(await res.json());
      } catch { /* ignore */ } finally { if (!cancelled) setLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(t: TaskHit) {
    onChange(t.gid);
    setSelectedName(t.name);
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
        <input
          className="awm-input pl-9"
          placeholder="Search tasks by client name or P-code…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" size={15} />}
      </div>

      {open && (results.length > 0 || (q.trim().length >= 2 && !loading)) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--color-border-dark)] bg-[#101a2e] shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--color-muted-text)]">No matching tasks.</li>
          ) : results.map((t) => (
            <li key={t.gid}>
              <button type="button" onClick={() => pick(t)} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5">
                <span className="text-slate-100">{t.name}</span>
                <span className="block text-xs text-[var(--color-muted-text)]">ID {t.gid}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {value && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <span className="truncate">
            <strong>Selected:</strong> {selectedName ? `${selectedName} · ` : ''}ID {value}
          </span>
          <button type="button" onClick={() => { onChange(''); setSelectedName(''); }} className="ml-auto text-emerald-300/80 hover:text-emerald-100" title="Clear">
            <X size={14} />
          </button>
        </div>
      )}

      <input
        className="awm-input mt-2 text-xs"
        placeholder="…or paste a task ID directly"
        value={value}
        onChange={(e) => { onChange(e.target.value.trim()); setSelectedName(''); }}
      />
    </div>
  );
}
