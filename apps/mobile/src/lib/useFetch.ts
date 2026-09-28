import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api } from './api';

/** Load JSON from the API whenever the screen gains focus; exposes reload + pull-to-refresh state. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!path) return;
      if (isRefresh) setRefreshing(true);
      try {
        const res = await api.get<T>(path);
        if (alive.current) {
          setData(res);
          setError(null);
        }
      } catch (e: any) {
        if (alive.current) setError(e.message ?? 'Failed to load');
      } finally {
        if (alive.current) setRefreshing(false);
      }
    },
    [path],
  );

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  const reload = useCallback(() => load(true), [load]);
  /** Re-fetch without the pull-to-refresh spinner (for live socket updates). */
  const refetch = useCallback(() => load(false), [load]);
  return { data, setData, error, refreshing, reload, refetch };
}

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDate(d: string) {
  // 'YYYY-MM-DD' → local date without timezone shift
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y!, m! - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
