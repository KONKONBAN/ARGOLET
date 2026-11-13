import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const PAGE_SIZES = [10, 20, 50, 100];

/**
 * List state kept in the URL (?page=&size=&…): going into a record and back returns to the
 * same page, and a page can be shared or bookmarked.
 */
export function useListState(defaultSize = 20) {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);
  const sizeRaw = Number(sp.get('size'));
  const pageSize = PAGE_SIZES.includes(sizeRaw) ? sizeRaw : defaultSize;

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
  const get = useCallback((k: string) => sp.get(k) ?? '', [sp]);
  const setPage = useCallback((p: number) => set({ page: p }), [set]);
  const setPageSize = useCallback(
    (n: number) => set({ size: n === defaultSize ? null : n, page: null }),
    [set, defaultSize],
  );
  /** Change a filter and go back to the first page. */
  const setFilter = useCallback((k: string, v: string) => set({ [k]: v || null, page: null }), [set]);

  return useMemo(
    () => ({ page, pageSize, get, setPage, setPageSize, setFilter }),
    [page, pageSize, get, setPage, setPageSize, setFilter],
  );
}

/** Search box text that becomes a URL filter after the user pauses typing. */
export function useSearchText(list: ReturnType<typeof useListState>, key = 'q', delayMs = 300) {
  const applied = list.get(key);
  const { setFilter } = list;
  const [text, setText] = useState(applied);
  useEffect(() => {
    if (text === applied) return;
    const t = setTimeout(() => setFilter(key, text), delayMs);
    return () => clearTimeout(t);
  }, [text, applied, setFilter, key, delayMs]);
  return [text, setText] as const;
}
