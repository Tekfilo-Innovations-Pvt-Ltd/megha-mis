'use client';

import { useQuery } from '@tanstack/react-query';
import type { PriceChartMasters } from '@/lib/priceChartMasters';

async function fetchMasters(): Promise<PriceChartMasters> {
  const res = await fetch('/api/price-charts/masters');
  if (!res.ok) throw new Error('Failed to load ERP masters');
  return res.json();
}

// The ERP's masters — shared by every company, so not refetched on a company switch.
export function useMasters() {
  const query = useQuery({ queryKey: ['price-chart-masters'], queryFn: fetchMasters, staleTime: 5 * 60 * 1000 });
  return { masters: query.data, isLoading: query.isLoading };
}
