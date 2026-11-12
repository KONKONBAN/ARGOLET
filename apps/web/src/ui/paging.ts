import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List state kept in the URL (?page=&size=&…): going into a record and back returns to the
 * same page, and a page can be shared or bookmarked.
 */
export function useListState(defaultSize = 20) {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);
  const sizeRaw = Number(sp.get('size'));
  const pageSize = [10, 20, 50, 100].includes(sizeRaw) ? sizeRaw : defaultSize;
  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '' || (k === 'page' && v === 1)) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );
  return {
    page,
    pageSize,
    get: (k: string) => sp.get(k) ?? '',
    setPage: (p: number) => set({ page: p }),
    setPageSize: (n: number) => set({ size: n === defaultSize ? null : n, page: null }),
    /** Change a filter and go back to the first page. */
    setFilter: (k: string, v: string) => set({ [k]: v || null, page: null }),
  };
}
