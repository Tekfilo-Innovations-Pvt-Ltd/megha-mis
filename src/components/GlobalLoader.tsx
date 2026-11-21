'use client';

import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

// Shows that something is loading in the background — any data request
// (filters, tabs, pages, recalculation after a save): an animated bar across
// the top of the window and a "Loading…" pill. It waits a moment before
// showing so quick requests don't flash.

const SHOW_AFTER_MS = 150;

export default function GlobalLoader() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  if (!visible) return null;
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-amber-100" role="progressbar" aria-label="Loading" aria-busy="true">
        <div className="h-full w-1/3 bg-amber-600 animate-[mis-loader_1.1s_ease-in-out_infinite]" />
      </div>
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg" role="status">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        Loading…
      </div>
      <style>{`@keyframes mis-loader { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </>
  );
}
