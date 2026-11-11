'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

// Switches the company every ERP query is scoped to. The server only accepts
// a company from the list granted at sign-in (see jwt callback in lib/auth.ts).
export default function CompanySwitcher() {
  const { data: session, update } = useSession();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const companies = session?.user?.companies ?? [];
  const companyId = session?.user?.companyId ?? null;

  const handleChange = async (value: string) => {
    const next = Number(value);
    if (next === companyId) return;
    setSwitching(true);
    try {
      const updated = await update({ companyId: next });
      if (updated?.user?.companyId !== next) throw new Error('switch refused');

      // A record page (/dashboard/<module>/<id>) belongs to the old company — go back to its list.
      const recordPage = pathname.match(/^(\/dashboard\/[^/]+)\/\d+$/);
      if (recordPage) router.push(recordPage[1]);

      await queryClient.resetQueries();
      toast.success(`Switched to ${companies.find((c) => c.id === next)?.name}`);
    } catch {
      toast.error('Could not switch company');
    } finally {
      setSwitching(false);
    }
  };

  if (companies.length === 0) return null;

  return (
    <div className="px-3 pb-3">
      <label htmlFor="company-switcher" className="flex items-center gap-1.5 px-1 mb-1 text-[11px] uppercase tracking-wide text-slate-400">
        <BuildingOffice2Icon className="h-3.5 w-3.5" /> Company
      </label>
      {companies.length === 1 ? (
        <div className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-white truncate">{companies[0].name}</div>
      ) : (
        <select
          id="company-switcher"
          value={companyId ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          disabled={switching}
          className="w-full px-2.5 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
