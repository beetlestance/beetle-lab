import { normalizeRunListQuery } from '@beetle/contracts/api';
import { useEffect, useState } from 'react';
import type { RunHistoryCounts, RunListQuery } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';

export type HistoryFilter = Pick<
  RunListQuery,
  'state' | 'outcome' | 'order' | 'name' | 'runIdPrefix' | 'suiteId' | 'pinned'
>;
export type HistoryChip = 'all' | 'running' | 'passed' | 'failed' | 'cancelled' | 'pinned';
const chips: readonly { value: HistoryChip; label: string; filter: Partial<HistoryFilter> }[] = [
  { value: 'all', label: 'All', filter: {} },
  { value: 'running', label: 'Running', filter: { state: 'active' } },
  { value: 'passed', label: 'Passed', filter: { outcome: 'passed' } },
  { value: 'failed', label: 'Failed', filter: { outcome: 'failed' } },
  { value: 'cancelled', label: 'Cancelled', filter: { state: 'cancelled' } },
  { value: 'pinned', label: 'Pinned', filter: { pinned: true } },
];
export function chipOf(filter: HistoryFilter): HistoryChip {
  if (filter.pinned) return 'pinned';
  if (filter.state === 'active') return 'running';
  if (filter.state === 'cancelled') return 'cancelled';
  if (filter.outcome === 'passed') return 'passed';
  if (filter.outcome === 'failed') return 'failed';
  return 'all';
}
/** Eight or more hex characters (and dashes) search run IDs; anything else searches names and notes. */
export function searchField(text: string): 'name' | 'runIdPrefix' {
  return /^[0-9a-f-]{8,36}$/i.test(text.trim()) && /[0-9a-f]{8}/i.test(text.trim()) ? 'runIdPrefix' : 'name';
}
export type SuiteOption = { id: string; name: string };
export function filtersActive(filter: HistoryFilter): boolean {
  return (
    chipOf(filter) !== 'all' ||
    filter.name !== undefined ||
    filter.runIdPrefix !== undefined ||
    filter.suiteId !== undefined
  );
}

/**
 * Chips, suite and sort apply at once; search applies on Enter. The suite choice is
 * hidden when the page is already bound to one suite through its address.
 */
export function HistoryFilters({
  applied,
  apply,
  suites,
  counts,
  suiteLocked,
}: {
  applied: HistoryFilter;
  apply: (value: HistoryFilter) => void;
  suites: readonly SuiteOption[] | undefined;
  counts?: RunHistoryCounts | undefined;
  suiteLocked: boolean;
}) {
  const [text, setText] = useState(applied.name ?? applied.runIdPrefix ?? '');
  const [error, setError] = useState('');
  const searching = applied.name !== undefined || applied.runIdPrefix !== undefined;
  useEffect(() => {
    if (!searching) setText('');
  }, [searching]);
  function commit(next: HistoryFilter) {
    try {
      const normalized: Partial<RunListQuery> = { ...normalizeRunListQuery({ limit: 100, ...next }) };
      delete normalized.limit;
      setError('');
      apply(normalized as HistoryFilter);
    } catch {
      setError('Enter at least 3 characters (64 bytes maximum), or a run ID prefix of at least 8 characters.');
    }
  }
  function withoutChip(filter: HistoryFilter): HistoryFilter {
    const next = { ...filter };
    delete next.state;
    delete next.outcome;
    delete next.pinned;
    return next;
  }
  function submitSearch() {
    const next = { ...applied };
    delete next.name;
    delete next.runIdPrefix;
    if (text.trim()) next[searchField(text)] = text;
    commit(next);
  }
  function reset() {
    setText('');
    setError('');
    apply({ order: 'newest', ...(suiteLocked && applied.suiteId ? { suiteId: applied.suiteId } : {}) });
  }
  return (
    <div className="history-filters">
      <SegmentedFilter
        label="Run state"
        options={chips.map(({ value, label }) => ({ value, label, count: counts?.[value]?.toLocaleString('en-US') }))}
        value={chipOf(applied)}
        onChange={(value) => commit({ ...withoutChip(applied), ...chips.find((chip) => chip.value === value)!.filter })}
      />
      <SearchForm text={text} error={error} onText={setText} onSubmit={submitSearch} />
      {!suiteLocked && <SuiteSelect applied={applied} suites={suites} commit={commit} />}
      <Select
        label="Sort"
        hideLabel
        value={applied.order ?? 'newest'}
        onChange={(event) => commit({ ...applied, order: event.target.value as NonNullable<HistoryFilter['order']> })}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </Select>
      {filtersActive(applied) && (
        <Button variant="text" size="sm" onClick={reset}>
          Reset filters
        </Button>
      )}
    </div>
  );
}

function SearchForm({
  text,
  error,
  onText,
  onSubmit,
}: {
  text: string;
  error: string;
  onText: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      role="search"
      aria-label="Run history search"
      className="history-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextInput
        label="Search runs"
        hideLabel
        type="search"
        placeholder="Search by suite, run or note"
        value={text}
        maxLength={256}
        error={error || undefined}
        onChange={(event) => onText(event.target.value)}
      />
    </form>
  );
}

function SuiteSelect({
  applied,
  suites,
  commit,
}: {
  applied: HistoryFilter;
  suites: readonly SuiteOption[] | undefined;
  commit: (next: HistoryFilter) => void;
}) {
  return (
    <Select
      label="Suite"
      hideLabel
      loading={suites === undefined}
      value={applied.suiteId ?? ''}
      onChange={(event) => {
        const next = { ...applied };
        delete next.suiteId;
        if (event.target.value) next.suiteId = event.target.value;
        commit(next);
      }}
    >
      <option value="">All suites</option>
      {suites?.map((suite) => (
        <option key={suite.id} value={suite.id}>
          {suite.name}
        </option>
      ))}
    </Select>
  );
}
