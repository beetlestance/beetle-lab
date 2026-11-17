import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InputParams } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { plural } from './format.js';

/**
 * Usage lookup: which saved suite revisions pin this input. One page of ten at a
 * time through `listInputUsage`; read only when the record reports usage.
 */
export function InputUsage({ params, count }: { params: InputParams; count: number }) {
  const api = useApi();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = useQuery({
    queryKey: [...queryKeys.input(params.organizationId, params.workspaceId, params.inputId), 'usage', cursor ?? ''],
    gcTime: 0,
    queryFn: ({ signal }) =>
      readResult(api.listInputUsage({ params, query: { limit: 10, ...(cursor ? { cursor } : {}) }, signal })),
  });
  return (
    <section className="input-usage" aria-label="Used by">
      <h3>Used by {plural(count, 'saved revision')}</h3>
      <QueryState query={query}>
        {(data) => (
          <>
            <ul>
              {data.items.map((item) => (
                <li key={item.revisionId}>
                  <span>{item.suiteName}</span> <span className="muted">Revision {item.ordinal}</span>
                  {item.current && <Badge>Current</Badge>}
                </li>
              ))}
            </ul>
            <div className="actions">
              {cursors.length > 0 && (
                <Button size="sm" variant="text" onClick={() => setCursors(cursors.slice(0, -1))}>
                  Previous revisions
                </Button>
              )}
              {data.nextCursor && (
                <Button size="sm" variant="text" onClick={() => setCursors([...cursors, data.nextCursor!].slice(-20))}>
                  More revisions
                </Button>
              )}
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}
