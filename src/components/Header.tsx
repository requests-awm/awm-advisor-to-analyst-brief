import { Link, useLocation } from 'react-router-dom';
import { FilePlus2, LayoutDashboard, LogOut, Sparkles } from 'lucide-react';
import logo from '../images/ascot-logo.png';
import type { CurrentUser } from '../lib/types';

function initials(user: CurrentUser): string {
  const base = (user.name || user.email || '?').trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function Header({ user, onSignOut }: { user: CurrentUser | null; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const navItem = (to: string, label: string, Icon: typeof FilePlus2, active: boolean) => (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition
        ${active ? 'bg-[rgba(212,160,23,0.12)] text-[var(--color-gold)]' : 'text-slate-300 hover:bg-white/5'}`}
    >
      <Icon size={16} /> {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border-dark)] bg-[#0c1322]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Ascot Wealth Management" className="h-9 w-auto" />
          <div className="hidden sm:block">
            <div className="text-sm font-semibold leading-tight">Adviser-to-Analyst Briefing</div>
            <div className="text-xs text-[var(--color-muted-text)]">Pre-Analysis Client Brief</div>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {navItem('/', 'Dashboard', LayoutDashboard, pathname === '/')}
          {navItem('/new', 'New Brief', FilePlus2, pathname.startsWith('/new'))}
          {navItem('/interview', 'AI Interview', Sparkles, pathname.startsWith('/interview'))}
        </nav>

        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <div className="text-sm font-medium leading-tight">{user.name || user.email}</div>
              <div className="text-xs text-[var(--color-muted-text)]">{user.email}</div>
            </div>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-navy-light)] text-xs font-semibold text-[var(--color-gold)]">
                {initials(user)}
              </div>
            )}
            <button onClick={onSignOut} title="Sign out" className="text-slate-400 hover:text-slate-200">
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
