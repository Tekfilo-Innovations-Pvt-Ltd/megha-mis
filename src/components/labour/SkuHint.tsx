'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { ArrowsRightLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { skuKey } from '@/lib/skuBase';
import SkuOtherCompanies, { type SkuContext } from '@/components/labour/SkuOtherCompanies';

// A small icon beside a SKU that is also invoiced in another company the user
// can open (an "-A" clone counts as the same SKU), for cross-checking labour.
// Hover: which companies and how many lines. Click: the same-SKU comparison.

type Index = Record<string, { companyId: number; company: string; lines: number }[]>;

// One request per company, shared by every hint on the page.
export function useSkuIndex() {
  const companyId = useSession().data?.user?.companyId ?? null;
  return useQuery({
    queryKey: ['sku-index', companyId],
    queryFn: async () => {
      const res = await fetch('/api/reports/labour-vs-chart/sku-index');
      if (!res.ok) throw new Error('Could not load the SKU index');
      return ((await res.json()) as { skus: Index }).skus;
    },
    enabled: companyId != null,
    staleTime: 10 * 60 * 1000,
  });
}

export default function SkuHint({ context, currency }: { context: SkuContext | undefined; currency?: string }) {
  const index = useSkuIndex();
  const [open, setOpen] = useState(false);
  const hits = context ? index.data?.[skuKey(context.skuNo)] : undefined;
  if (!context || !hits?.length) return null;
  const title = `Also invoiced at ${hits.map((h) => `${h.company} (${h.lines.toLocaleString()} line${h.lines === 1 ? '' : 's'})`).join(', ')} — click to compare labour`;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={title}
        aria-label={title}
        className="ml-1 inline-flex align-middle items-center rounded bg-indigo-100 px-1 py-0.5 text-indigo-700 hover:bg-indigo-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <ArrowsRightLeftIcon className="h-3 w-3" />
      </button>
      {open && <HintDialog context={context} currency={currency} onClose={() => setOpen(false)} />}
    </>
  );
}

function HintDialog({ context, currency, onClose }: { context: SkuContext; currency?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`SKU ${context.skuNo} in other companies`} className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl text-sm text-slate-700 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex justify-end border-b border-slate-200 bg-white px-3 py-2">
          <button type="button" onClick={onClose} autoFocus className="p-1 rounded hover:bg-slate-100" aria-label="Close"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">
          <SkuOtherCompanies context={context} currency={currency} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
