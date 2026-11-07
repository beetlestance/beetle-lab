import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Retain at most 20 previous pages; Back stops at that explicit history boundary.
export function usePage(queryPrefix: readonly string[]) {
  const client = useQueryClient();
  const prefixIdentity = JSON.stringify(queryPrefix);
  const [state, setState] = useState<{ cursor?: string; history: (string | undefined)[] }>({ history: [] });
  useEffect(() => {
    // The newly observed page survives; prior pages cannot accumulate until GC.
    const prefix = JSON.parse(prefixIdentity) as string[];
    client.removeQueries({ queryKey: prefix, type: 'inactive' });
  }, [client, prefixIdentity, state.cursor]);
  return {
    query: { limit: 100, ...(state.cursor ? { cursor: state.cursor } : {}) },
    cursor: state.cursor ?? '',
    back: () => setState({ ...(state.history.at(-1) ? { cursor: state.history.at(-1)! } : {}), history: state.history.slice(0, -1) }),
    next: (cursor: string) => setState({ cursor, history: [...state.history, state.cursor].slice(-20) }),
    hasBack: state.history.length > 0,
  };
}
export function Pagination({ page, next }: { page: ReturnType<typeof usePage>; next: string | null }) {
  return <nav className="pagination" aria-label="Pages">
    <button disabled={!page.hasBack} onClick={page.back}>Back</button>
    <span>Up to 100 items per page</span>
    <button disabled={!next} onClick={() => { if (next) page.next(next); }}>Next</button>
  </nav>;
}
