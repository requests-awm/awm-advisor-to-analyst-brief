import { AlertTriangle, Loader2 } from 'lucide-react';
import logo from '../images/ascot-logo.png';

export function FullScreenLoader({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <img src={logo} alt="Ascot Wealth Management" className="h-12 w-auto opacity-90" />
      <div className="flex items-center gap-2 text-[var(--color-muted-text)]">
        <Loader2 className="animate-spin" size={18} /> {message}
      </div>
    </div>
  );
}

export function FullScreenError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src={logo} alt="Ascot Wealth Management" className="h-12 w-auto opacity-90" />
      <div className="awm-card max-w-md p-6">
        <AlertTriangle className="mx-auto mb-3 text-[var(--color-gold)]" size={28} />
        <h1 className="mb-1 text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-[var(--color-muted-text)]">{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="awm-card flex flex-col items-center justify-center gap-2 p-12 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {subtitle && <p className="max-w-sm text-sm text-[var(--color-muted-text)]">{subtitle}</p>}
    </div>
  );
}
