import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiFailure } from '../app/api.js';
import { Button } from './Button.js';
import { LoadingState } from './States.js';
import './primitives.css';

/**
 * Pending, error and ready for one query. Pending shows `loading` (default: an
 * inline status); an error hides data and offers an explicit retry.
 */
export function QueryState<T>({
  query,
  children,
  loading,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode | undefined;
}) {
  if (query.isPending) return loading ?? <LoadingState />;
  if (query.isError)
    return (
      <div role="alert" className="banner banner-danger">
        <div className="banner-body">
          <p className="banner-title">
            {query.error instanceof ApiFailure ? query.error.message : 'The service is unavailable.'}
          </p>
        </div>
        <div className="banner-actions">
          <Button size="sm" onClick={() => void query.refetch()}>
            Retry loading
          </Button>
        </div>
      </div>
    );
  return children(query.data);
}
