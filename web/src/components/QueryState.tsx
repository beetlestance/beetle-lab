import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiFailure } from '../app/api.js';

export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p role="status" className="notice">Loading…</p>;
  if (query.isError) return <div role="alert" className="notice error">
    <p>{query.error instanceof ApiFailure ? query.error.message : 'The service is unavailable.'}</p>
    <button onClick={() => void query.refetch()}>Retry loading</button>
  </div>;
  return children(query.data);
}
