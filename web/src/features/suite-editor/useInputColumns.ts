import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { validateK6DraftPart } from '@beetle/contracts/engine-config/k6';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import type { Config } from '../suites/draft.js';
import { isObj, objects, text } from './model.js';

type Reference = { id: string; sha256: string; bytes: number; kind: 'csv' | 'json'; datasets: string[] };
function references(config: Config): Reference[] {
  const found = new Map<string, Reference>();
  for (const dataset of objects(config.datasets).slice(0, 64)) {
    if (
      (dataset.kind !== 'csv' && dataset.kind !== 'json') ||
      !validateK6DraftPart('dataset', dataset) ||
      !isObj(dataset.input)
    )
      continue;
    const value: Reference = {
      id: text(dataset.input.id).toLowerCase(),
      sha256: text(dataset.input.sha256),
      bytes: Number(dataset.input.bytes),
      kind: dataset.kind,
      datasets: [text(dataset.id)],
    };
    const key = JSON.stringify([value.id, value.sha256, value.bytes, value.kind]);
    const previous = found.get(key);
    if (previous) previous.datasets.push(text(dataset.id));
    else found.set(key, value);
  }
  return [...found.values()];
}
export type FileColumns = {
  columns: ReadonlyMap<string, readonly string[] | null>;
  pending: boolean;
  failed: boolean;
  retry: () => void;
};
/** One active discovery at a time; per-input/kind identity cache and abort-on-retirement remain query-owned. */
export function useInputColumns(scope: WorkspaceScope, config: Config): FileColumns {
  const api = useApi();
  const refs = references(config);
  const identity = JSON.stringify([scope.organizationId, scope.workspaceId, refs]);
  const [cursor, setCursor] = useState({ identity, index: 0 });
  const [retrying, setRetrying] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setRetrying(false);
    return () => {
      epoch.current++;
    };
  }, [identity]);
  const index = cursor.identity === identity ? cursor.index : 0;
  const reads = useQueries({
    queries: refs.map((ref, position) => ({
      queryKey: [
        ...queryKeys.input(scope.organizationId, scope.workspaceId, ref.id),
        'columns',
        ref.kind,
        ref.sha256,
        ref.bytes,
      ],
      enabled: position === index,
      retry: false,
      staleTime: Infinity,
      gcTime: 0,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const value = await readResult(
          api.getInputColumns({
            params: { inputId: ref.id, organizationId: scope.organizationId, workspaceId: scope.workspaceId },
            query: { kind: ref.kind },
            signal,
          }),
        );
        if (value.sha256 !== ref.sha256 || value.bytes !== ref.bytes) throw Error('Published input identity changed');
        return value;
      },
    })),
  });
  const settled = reads[index]?.isSuccess || reads[index]?.isError;
  useEffect(() => {
    if (cursor.identity !== identity) setCursor({ identity, index: 0 });
    else if (settled && index < refs.length) setCursor({ identity, index: index + 1 });
  }, [identity, index, settled, refs.length, cursor.identity]);
  const columns = useMemo(() => {
    const result = new Map<string, readonly string[] | null>();
    refs.forEach((ref, at) => {
      const value = reads[at]?.data;
      if (value) for (const name of ref.datasets) result.set(name, value.columns);
    });
    return result;
  }, [identity, reads.map((read) => read.dataUpdatedAt).join(',')]);
  const pending = index < refs.length || retrying;
  const retry = async () => {
    if (pending) return;
    const owner = epoch.current;
    setRetrying(true);
    try {
      for (const read of reads) {
        if (owner !== epoch.current) return;
        if (read.isError) await read.refetch();
      }
    } finally {
      if (owner === epoch.current) setRetrying(false);
    }
  };
  return {
    columns,
    pending,
    failed: reads.some((read) => read.isError),
    retry: () => {
      void retry();
    },
  };
}
