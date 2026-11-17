import { useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputRecord, WorkspaceScope } from '@beetle/contracts/api';
import { ApiFailure, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import type { InputCatalog } from './fields.js';
import type { InputChoice } from './model.js';
import type { Problem } from './problems.js';

const gone = new Set(['deleted', 'deleting', 'failed']);

/**
 * Body and dataset choices (first page of published inputs) plus the state of every input the draft
 * references, so a deleted file is named before saving. Bounded: one list page and at most 64 reads.
 */
export function useInputCatalog(
  scope: WorkspaceScope,
  references: readonly { id: string; path: string }[],
): InputCatalog & { problems: Problem[] } {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = scope;
  const params = { organizationId, workspaceId };
  const root = queryKeys.inputs(organizationId, workspaceId);
  const page = useQuery({
    queryKey: [...root, 'editor-choices'],
    queryFn: ({ signal }) => readResult(api.listInputs({ params, query: { limit: 100 }, signal })),
  });
  const ids = useMemo(() => [...new Set(references.map((reference) => reference.id))].slice(0, 64), [references]);
  const reads = useQueries({
    queries: ids.map((inputId) => ({
      queryKey: queryKeys.input(organizationId, workspaceId, inputId),
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<InputRecord | 'missing'> => {
        try {
          return await readResult(api.getInput({ params: { ...params, inputId }, signal }));
        } catch (error) {
          if (error instanceof ApiFailure && error.failure.protocol?.code === 'not_found') return 'missing';
          throw error;
        }
      },
    })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: root, type: 'inactive' });
      client.removeQueries({ queryKey: root, type: 'inactive' });
    },
    [client, organizationId, workspaceId],
  );
  const records = new Map<string, InputRecord | 'missing'>();
  ids.forEach((id, index) => {
    const data = reads[index]?.data;
    if (data !== undefined) records.set(id, data);
  });
  const choices: InputChoice[] = (page.data?.items ?? [])
    .filter((item) => item.state === 'published')
    .map((item) => ({ id: item.id, name: item.name, sha256: item.sha256, bytes: item.bytes, state: item.state }));
  const name = (id: string) => {
    const key = id.toLowerCase();
    const record = records.get(key);
    if (record && record !== 'missing') return record.name;
    return page.data?.items.find((item) => item.id.toLowerCase() === key)?.name;
  };
  const problems: Problem[] = [];
  for (const reference of references) {
    const record = records.get(reference.id);
    if (record === 'missing')
      problems.push({ path: reference.path, message: 'An input file this suite uses no longer exists.' });
    else if (record && gone.has(record.state))
      problems.push({
        path: reference.path,
        message: record.state === 'failed' ? `${record.name} failed to upload.` : `${record.name} was deleted.`,
      });
  }
  return { choices, loading: page.isPending, name, problems };
}
