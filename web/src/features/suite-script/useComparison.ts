import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Suite, SuiteRevision, SuiteRevisionSummary } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { formatDraft } from '../suites/draft.js';
import { configChanges } from './changes.js';
import type { Comparison } from './ChangesTab.js';
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

function diffConfigs(before: SuiteRevision | undefined, after: SuiteRevision) {
  if (!before) return { diff: undefined, changes: [] };
  try {
    return {
      diff: lineDiff(formatDraft(before.config), formatDraft(after.config)),
      changes: configChanges(before.config, after.config),
    };
  } catch {
    return { diff: null, changes: [] };
  }
}

/** Compare-with choices (first page of revisions) and the diff from the chosen one to this revision. */
export function useComparison(suite: Suite, revision: SuiteRevision): Comparison {
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
  const { diff, changes } = useMemo(() => diffConfigs(other.data, revision), [other.data, revision]);
  return {
    ordinal: revision.ordinal,
    other: other.data,
    choices,
    otherId,
    setOtherId: setChosen,
    diff,
    changes,
    failed: page.isError || other.isError,
  };
}
