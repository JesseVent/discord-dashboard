import { useQuery } from '@tanstack/react-query';

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/metrics');
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return res.json();
    },
    staleTime: 60 * 1000 * 5, // 5 minutes
  });
}
