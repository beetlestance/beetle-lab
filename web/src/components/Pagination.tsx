import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './Button.js';

/**
 * Keyset paging over one list. Retains at most 20 previous cursors; going back stops
 * at that explicit history boundary. `position` is the 1-based page number counted
 * from the first page, exact because back never passes the retained boundary.
 */
export function usePage(queryPrefix: readonly string[]) {
  const client = useQueryClient();
  const prefixIdentity = JSON.stringify(queryPrefix);
  const [state, setState] = useState<{ cursor?: string; history: (string | undefined)[]; position: number }>({
    history: [],
    position: 1,
  });
  useEffect(() => {
    // The newly observed page survives; prior pages cannot accumulate until GC.
    const prefix = JSON.parse(prefixIdentity) as string[];
    client.removeQueries({ queryKey: prefix, type: 'inactive' });
  }, [client, prefixIdentity, state.cursor]);
  return {
    query: { limit: 100, ...(state.cursor ? { cursor: state.cursor } : {}) },
    cursor: state.cursor ?? '',
    back: () =>
      setState({
        ...(state.history.at(-1) ? { cursor: state.history.at(-1)! } : {}),
        history: state.history.slice(0, -1),
        position: Math.max(1, state.position - 1),
      }),
    next: (cursor: string) =>
      setState({ cursor, history: [...state.history, state.cursor].slice(-20), position: state.position + 1 }),
    hasBack: state.history.length > 0,
    position: state.position,
    reset: () => setState({ history: [], position: 1 }),
  };
}
/**
 * Pager for one keyset list. Lists in time order pass `order` and get Newer/Older in
 * that direction; lists in identifier order (no time meaning) keep Back/Next, so the
 * labels never claim an order the list does not have. Shows the page position; the
 * total is unknown for keyset pages and is never shown.
 */
export function Pagination({
  page,
  next,
  order,
  label = 'Pages',
  limit = 100,
  summary,
}: {
  page: ReturnType<typeof usePage>;
  next: string | null;
  order?: 'newest' | 'oldest' | undefined;
  label?: string | undefined;
  limit?: number | undefined;
  /** Caller-supplied exact snapshot range; omitted for lists without count authority. */
  summary?: string | undefined;
}) {
  const [back, forward] = !order ? ['Back', 'Next'] : order === 'newest' ? ['Newer', 'Older'] : ['Older', 'Newer'];
  return (
    <nav className="pagination" aria-label={label}>
      <Button size="sm" disabled={!page.hasBack} onClick={page.back}>
        {back}
      </Button>
      <span aria-live="polite">{summary ?? `Page ${page.position} · up to ${limit} items per page`}</span>
      <Button
        size="sm"
        disabled={!next}
        onClick={() => {
          if (next) page.next(next);
        }}
      >
        {forward}
      </Button>
    </nav>
  );
}
