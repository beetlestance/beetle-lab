import { useState } from 'react';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import type { ResultReads } from './useResultReads.js';

/** Explicit retry stays with this result owner; ordinary run refresh is a separate read. */
export function ResultReadProblem({ read }: { read: ResultReads['result'] }) {
  const [retried, setRetried] = useState(false);
  if (read.status !== 'error' && !(retried && read.status === 'loading')) return null;
  return (
    <Banner
      tone="warning"
      title={read.status === 'loading' ? 'Reading result details…' : 'Result details unavailable'}
      actions={
        <Button
          size="sm"
          disabled={read.query.isFetching}
          onClick={() => {
            setRetried(true);
            void read.query.refetch({ cancelRefetch: false });
          }}
        >
          Retry result details
        </Button>
      }
    >
      Retry to read the published details for this run.
    </Banner>
  );
}
