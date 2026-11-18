import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Suite, SuiteRevision, SuiteRevisionSummary } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { useSavedScript } from './useSavedScript.js';
import { sourceState } from './comparison-state.js';
import { configChanges } from './changes.js';
import type { Comparison, ScriptSide } from './comparison-model.js';
import { lineDiff } from './diff.js';

/** The suite's current revision when it is another one, else the closest earlier revision. */
function defaultOther(suite: Suite, revision: SuiteRevision, choices: readonly SuiteRevisionSummary[]): string {
  const current = choices.find((choice) => choice.id.toLowerCase() === suite.currentRevisionId?.toLowerCase());
  if (current) return current.id;
  const earlier = choices.filter((choice) => choice.ordinal < revision.ordinal);
  const closest = earlier.reduce<SuiteRevisionSummary | undefined>(
    (best, choice) => (!best || choice.ordinal > best.ordinal ? choice : best),
    undefined,
  );
  return (closest ?? choices[0])?.id ?? '';
}

/** Compare-with choices (first page of revisions) and the diff from the chosen one to this revision. */
export function useComparison(
  suite: Suite,
  revision: SuiteRevision,
  current: ScriptSide,
  retryCurrent: () => void,
): Comparison {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const [chosen, setChosen] = useState('');
  const page = useQuery({
    queryKey: [...queryKeys.suiteRevisions(organizationId, workspaceId, suite.id), 'compare'],
    queryFn: ({ signal }) =>
      readResult(
        api.listSuiteRevisions({
          params: { organizationId, workspaceId, suiteId: suite.id },
          query: { limit: 100 },
          signal,
        }),
      ),
  });
  const choices = (page.data?.items ?? []).filter((item) => item.id.toLowerCase() !== revision.id.toLowerCase());
  const otherId = chosen || defaultOther(suite, revision, choices);
  const other = useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, otherId),
    enabled: otherId !== '',
    queryFn: async ({ signal }) => {
      const value = await readResult(
        api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId: otherId }, signal }),
      );
      if (value.suiteId.toLowerCase() !== suite.id.toLowerCase()) throw new Error('Revision belongs to another suite');
      return value;
    },
  });
  const compared = useSavedScript(suite.scope, other.data);
  const computed = useMemo(
    () =>
      current.text.data === undefined || compared.text.data === undefined
        ? undefined
        : lineDiff(compared.text.data, current.text.data),
    [current.text.data, compared.text.data],
  );
  const changes = useMemo(
    () => (other.data ? configChanges(other.data.config, revision.config) : []),
    [other.data, revision],
  );
  const metadata = metadataState(page.isPending, page.isError || other.isError, choices.length, other.isPending);
  const status = metadata ?? sourceState(current, compared, computed);
  return {
    ordinal: revision.ordinal,
    other: other.data,
    choices,
    otherId,
    setOtherId: setChosen,
    diff: visibleDiff(status, computed),
    changes,
    status,
    current,
    compared,
    refreshing: page.isFetching || other.isFetching || compared.refreshing || current.text.isFetching,
    retry: () => {
      void page.refetch({ cancelRefetch: false });
      if (otherId) void other.refetch({ cancelRefetch: false });
      compared.retry();
      retryCurrent();
    },
  };
}

function metadataState(
  pending: boolean,
  failed: boolean,
  count: number,
  otherPending: boolean,
): Comparison['status'] | null {
  if (failed) return 'error';
  if (pending) return 'loading';
  if (count === 0) return 'only';
  return otherPending ? 'loading' : null;
}

function visibleDiff(status: Comparison['status'], diff: ReturnType<typeof lineDiff> | undefined) {
  return status === 'ready' || status === 'too_large' ? diff : undefined;
}
