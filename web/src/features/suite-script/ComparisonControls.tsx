import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { Run, Suite } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { validId } from '../../app/routes.js';
import { Tabs } from '../../components/Tabs.js';
import { Select } from '../../components/Fields.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import type { Comparison, Layout } from './comparison-model.js';

type Props = {
  tab: 'script' | 'changes';
  select(tab: 'script' | 'changes'): void;
  comparison: Comparison;
  layout: Layout;
  setLayout(layout: Layout): void;
  suite: Suite;
};

/** Observe the breadcrumb's verified run read without owning another request. */
function useOriginRevision(suite: Suite) {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const ids = search.getAll('run');
  const runId = ids.length === 1 && validId(ids[0]) ? ids[0] : undefined;
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  const read = () => {
    if (!runId) return undefined;
    const query = client.getQueryState<Run>(queryKeys.run(suite.scope.organizationId, suite.scope.workspaceId, runId));
    return query?.status === 'success' && query.data && query.data.suiteId.toLowerCase() === suite.id.toLowerCase()
      ? query.data.revisionId
      : undefined;
  };
  return useSyncExternalStore(subscribe, read, read);
}

export function ScriptTabs({ tab, select, comparison, layout, setLayout, suite }: Props) {
  const diff = comparison.status === 'ready' ? comparison.diff : undefined;
  const count = diff ? `+${diff.added} −${diff.removed}` : undefined;
  return (
    <div className="script-tabs-row">
      <Tabs
        label="Script views"
        idBase="script"
        selected={tab}
        onSelect={select}
        items={[
          { id: 'script', label: 'Script' },
          { id: 'changes', label: 'Changes', count },
        ]}
      />
      {tab === 'changes' && (
        <ComparisonControls comparison={comparison} layout={layout} setLayout={setLayout} suite={suite} />
      )}
    </div>
  );
}

function emptyChoice(status: Comparison['status']) {
  if (status === 'error') return 'Revisions unavailable';
  return status === 'only' ? 'No other revision' : 'Reading revisions…';
}

function ComparisonControls({
  comparison,
  layout,
  setLayout,
  suite,
}: Pick<Props, 'comparison' | 'layout' | 'setLayout' | 'suite'>) {
  const origin = useOriginRevision(suite);
  return (
    <div className="script-compare-controls">
      <span>Compare with</span>
      <Select
        label="Compare with"
        hideLabel
        value={comparison.otherId}
        disabled={!comparison.choices.length}
        onChange={(event) => comparison.setOtherId(event.target.value)}
      >
        {!comparison.choices.length && <option value="">{emptyChoice(comparison.status)}</option>}
        {comparison.choices.map((choice) => {
          const tags = [
            choice.id.toLowerCase() === origin?.toLowerCase() ? 'this run' : '',
            choice.id.toLowerCase() === suite.currentRevisionId?.toLowerCase() ? 'latest' : '',
          ].filter(Boolean);
          return (
            <option key={choice.id} value={choice.id}>
              Revision {choice.ordinal}
              {tags.length ? ` (${tags.join(', ')})` : ''}
            </option>
          );
        })}
      </Select>
      <SegmentedFilter<Layout>
        label="Diff layout"
        value={layout}
        onChange={setLayout}
        options={[
          { value: 'split', label: 'Side by side' },
          { value: 'unified', label: 'One column' },
        ]}
      />
    </div>
  );
}
