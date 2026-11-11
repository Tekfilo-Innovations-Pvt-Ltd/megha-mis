'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import type { PriceChart } from '@/lib/priceChart';
import type { PriceChartSummary } from '@/lib/priceChartStore';
import { usePermissions } from '@/hooks/usePermissions';
import { fmtDate } from '@/lib/format';

const STORAGE_KEY = 'mis.priceChart';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

// The chart list and the selected chart (remembered per browser). Charts are
// not company data, so the same chart shows in every company.
export function useSelectedChart() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    try {
      setCode(localStorage.getItem(STORAGE_KEY));
    } catch {
      // storage unavailable — fall back to the newest chart
    }
  }, []);

  const charts = useQuery({ queryKey: ['price-charts'], queryFn: () => getJson<PriceChartSummary[]>('/api/price-charts') });
  const selectedCode = charts.data?.find((c) => c.code === code)?.code ?? charts.data?.[0]?.code ?? null;
  const chart = useQuery({
    queryKey: ['price-chart', selectedCode],
    queryFn: () => getJson<PriceChart>(`/api/price-charts/${selectedCode}`),
    enabled: selectedCode != null,
  });

  const select = (next: string) => {
    setCode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable — selection just isn't remembered
    }
  };

  return {
    charts: charts.data ?? [],
    chart: chart.data,
    select,
    isLoading: charts.isLoading || chart.isLoading,
    isEmpty: charts.isSuccess && charts.data.length === 0,
    isError: charts.isError || chart.isError,
  };
}

interface UploadResult {
  message: string;
  problems?: string[];
  backup?: string | null;
  counts?: { metalRates: number; settingRates: number; commodities: number };
}

function UploadPanel({ chart }: { chart: PriceChart }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setProblems(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/price-charts/${chart.code}/upload`, { method: 'POST', body });
      const result: UploadResult = await res.json().catch(() => ({ message: 'Upload failed' }));
      if (!res.ok) {
        setProblems(result.problems ?? [result.message]);
        toast.error(result.message);
        return;
      }
      toast.success(`Chart replaced — ${result.counts?.metalRates} metal and ${result.counts?.settingRates} setting rates loaded`);
      reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['price-charts'] }),
        queryClient.invalidateQueries({ queryKey: ['price-chart', chart.code] }),
      ]);
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          setProblems(null);
          setFile(e.target.files?.[0] ?? null);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <ArrowUpTrayIcon className="h-4 w-4" /> Upload
      </button>

      {file && (
        <div className="basis-full mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <p className="text-amber-900">
            Uploading <b>{file.name}</b> <b>deletes all data of “{chart.name}”</b> and replaces it with this workbook. The current chart is kept as a backup.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={upload}
              disabled={uploading}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Delete and replace'}
            </button>
            <button onClick={reset} disabled={uploading} className="px-3 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-amber-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {problems && (
        <div className="basis-full mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">Nothing was changed — fix these in the workbook and upload again:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

export default function ChartHeader({
  title,
  chart,
  charts,
  onSelect,
}: {
  title: string;
  chart: PriceChart;
  charts: PriceChartSummary[];
  onSelect: (code: string) => void;
}) {
  const { roles } = usePermissions();
  const canUpload = roles.includes('ADMIN');

  return (
    <header className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {charts.length > 1 ? (
          <select
            value={chart.code}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Price chart"
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          >
            {charts.map((c) => (
              <option key={c.code} value={c.code}>{c.name} ({c.effectiveDate})</option>
            ))}
          </select>
        ) : (
          <span className="text-slate-600">{chart.name}</span>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <a
            href={`/api/price-charts/${chart.code}/download`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Download
          </a>
          {canUpload && <UploadPanel chart={chart} />}
        </div>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-slate-500">Chart: </dt><dd className="inline text-slate-900">{chart.factoryLabel}</dd></div>
        <div><dt className="inline text-slate-500">Metal: </dt><dd className="inline text-slate-900">{chart.metal}</dd></div>
        <div><dt className="inline text-slate-500">Currency: </dt><dd className="inline text-slate-900">{chart.currency}</dd></div>
        <div><dt className="inline text-slate-500">Effective: </dt><dd className="inline text-slate-900">{fmtDate(chart.effectiveDate)}</dd></div>
        <div className="text-slate-400">
          Loaded from {chart.source.file} on {fmtDate(chart.source.importedAt)} · applies to all companies
        </div>
      </dl>
    </header>
  );
}
