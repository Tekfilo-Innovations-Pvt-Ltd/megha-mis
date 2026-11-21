'use client';

import { useEffect, useRef, useState } from 'react';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';

// Show / hide columns of a wide table. Some columns start hidden to keep the
// table narrow; the viewer's choice is remembered on this browser per table.

export interface ColumnDef {
  key: string;
  label: string;
  group: string; // heading the column is listed under in the picker
  hidden?: boolean; // hidden until the viewer turns it on
  note?: string; // shown next to the label in the picker
}

export type HiddenColumns = Set<string>;

const defaults = (defs: ColumnDef[]) => new Set(defs.filter((d) => d.hidden).map((d) => d.key));

export function useHiddenColumns(storageKey: string, defs: ColumnDef[]) {
  const [hidden, setHidden] = useState<HiddenColumns>(() => defaults(defs));
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const known = new Set(defs.map((d) => d.key));
        setHidden(new Set((JSON.parse(saved) as string[]).filter((k) => known.has(k))));
      }
    } catch {}
    // defs are module constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const save = (next: HiddenColumns) => {
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    } catch {}
  };
  return {
    hidden,
    toggle: (key: string) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      save(next);
    },
    setAll: (show: boolean) => save(show ? new Set() : new Set(defs.map((d) => d.key))),
    reset: () => {
      setHidden(defaults(defs));
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    },
  };
}

export function ColumnPicker({ defs, state }: { defs: ColumnDef[]; state: ReturnType<typeof useHiddenColumns> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const groups = Array.from(new Set(defs.map((d) => d.group)));
  const shown = defs.length - defs.filter((d) => state.hidden.has(d.key)).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Choose the columns to show"
        className="px-2.5 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
      >
        <Cog6ToothIcon className="h-4 w-4" /> Columns <span className="text-xs text-slate-500">{shown}/{defs.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(36rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg p-3">
          <div className="flex items-center gap-2 mb-2 text-xs">
            <span className="font-semibold text-slate-700">Columns</span>
            <button onClick={() => state.setAll(true)} className="ml-auto px-2 py-1 rounded hover:bg-slate-100 text-slate-600">Show all</button>
            <button onClick={state.reset} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-600">Default</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
            {groups.map((g) => (
              <fieldset key={g}>
                <legend className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{g}</legend>
                {defs.filter((d) => d.group === g).map((d) => (
                  <label key={d.key} className="flex items-center gap-2 py-0.5 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!state.hidden.has(d.key)} onChange={() => state.toggle(d.key)} className="rounded border-slate-300 text-amber-600 focus:ring-amber-500" />
                    {d.label}
                    {d.note && <span className="text-xs text-slate-400">{d.note}</span>}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
