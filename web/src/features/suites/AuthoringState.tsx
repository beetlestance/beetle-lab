import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiFailure } from '../../app/api.js';
import { QueryState } from '../../components/QueryState.js';

/** A refresh failure must not retire the editor that owns a scoped draft or replay. */
export function AuthoringState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data === undefined) return <QueryState query={query}>{children}</QueryState>;
  return <>
    {query.isError && <div role="alert" className="notice error">
      <p>{query.error instanceof ApiFailure ? query.error.message : 'Could not refresh saved details.'} Your draft is kept.</p>
      <button type="button" onClick={() => void query.refetch()}>Retry loading</button>
    </div>}
    {children(query.data)}
  </>;
}
