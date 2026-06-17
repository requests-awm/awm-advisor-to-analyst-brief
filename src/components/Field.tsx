import { useState } from 'react';
import type { FieldDef } from '../lib/briefSchema';
import { MicButton } from './MicButton';
import { AsanaTaskPicker } from './AsanaTaskPicker';

type Props = {
  field: FieldDef;
  value: string;
  onChange: (key: string, value: string) => void;
  error?: string;
};

export function Field({ field, value, onChange, error }: Props) {
  const set = (v: string) => onChange(field.key, v);
  const baseId = `f-${field.key}`;
  const dictatable = field.type === 'text' || field.type === 'textarea';
  const [interim, setInterim] = useState('');

  return (
    <div className="space-y-2" id={baseId}>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={baseId} className="block text-sm font-medium text-slate-100">
          {field.label}
          {field.required && <span className="ml-1 text-[var(--color-gold)]">*</span>}
        </label>
        {dictatable && <MicButton value={value} onChange={set} onInterim={setInterim} />}
      </div>
      {field.help && <p className="text-xs leading-relaxed text-[var(--color-muted-text)]">{field.help}</p>}

      {field.type === 'asana_task' ? (
        <AsanaTaskPicker value={value} onChange={set} />
      ) : field.type === 'radio' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {field.options!.map((opt) => (
            <label key={opt} className="awm-option" data-selected={value === opt}>
              <input
                type="radio"
                name={field.key}
                value={opt}
                checked={value === opt}
                onChange={() => set(opt)}
                className="accent-[var(--color-gold)]"
              />
              <span className="text-sm">{opt}</span>
            </label>
          ))}
        </div>
      ) : field.type === 'textarea' ? (
        <textarea
          id={baseId}
          className="awm-input"
          rows={4}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      ) : field.type === 'currency' ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">£</span>
          <input
            id={baseId}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className="awm-input pl-7"
            value={value}
            placeholder={field.placeholder || '0'}
            onChange={(e) => set(e.target.value)}
          />
        </div>
      ) : (
        <input
          id={baseId}
          type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text'}
          className="awm-input"
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      )}

      {interim && (
        <p className="text-sm italic text-slate-500">
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />
          {interim}
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
