import { normalizeRunListQuery } from '@beetle/contracts/api';
import { useState } from 'react';
import type { RunListQuery } from '@beetle/contracts/api';

export type HistoryFilter = Pick<RunListQuery, 'state' | 'outcome' | 'order' | 'name' | 'runIdPrefix'>;
const runStates = ['queued', 'dispatching', 'active', 'finalizing', 'finished', 'cancelled', 'errored'] as const;
const outcomes = ["pending", "passed", "failed", "inconclusive"] as const;
export function HistoryFilters({ applied, apply }: { applied: HistoryFilter; apply: (value: HistoryFilter) => void }) {
  const [draft, setDraft] = useState(applied);
  const [mode, setMode] = useState<'name' | 'runIdPrefix'>('name');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  function submit() {
    try {
      const value = { ...draft }; delete value.name; delete value.runIdPrefix;
      if (text.trim()) value[mode] = text;
      const normalized = normalizeRunListQuery({ limit: 100, ...value });
      const filters: Partial<RunListQuery> = { ...normalized }; delete filters.limit;
      setError(''); apply(filters);
    } catch { setError('Enter a name of at least 3 characters (64 UTF-8 bytes maximum), or a run ID prefix of at least 8 characters.'); }
  }
  function edit(field: 'state' | 'outcome', value: string) {
    const next = { ...draft }; delete next[field];
    if (field === 'state' && value) next.state = value as NonNullable<HistoryFilter['state']>;
    if (field === 'outcome' && value) next.outcome = value as NonNullable<HistoryFilter['outcome']>;
    setDraft(next);
  }
  function reset() { const value = { order: 'newest' as const }; setDraft(value); setText(''); setError(''); setMode('name'); apply(value); }
  return <form aria-label="History filters" onSubmit={event => { event.preventDefault(); submit(); }}>
    <label>State <select value={draft.state ?? ''} onChange={event => edit('state', event.target.value)}>
      <option value="">All states</option>{runStates.map(state => <option key={state}>{state}</option>)}
    </select></label>
    <label>Outcome <select value={draft.outcome ?? ''} onChange={event => edit('outcome', event.target.value)}>
      <option value="">All outcomes</option>{outcomes.map(outcome => <option key={outcome}>{outcome}</option>)}
    </select></label>
    <label>Order <select value={draft.order ?? 'newest'} onChange={event => setDraft({ ...draft, order: event.target.value as NonNullable<HistoryFilter['order']> })}>
      <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
    </select></label>
    <label>Search by <select value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
      <option value="name">Current names</option><option value="runIdPrefix">Run ID prefix</option>
    </select></label>
    <label>History search <input value={text} maxLength={256} onChange={event => setText(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <p>Names match a current workspace, suite or ancestor folder name. Run IDs match from the beginning.
      Path separators between names are not searched. Refine a search reported as too broad.</p>
    <button type="submit">Apply filters</button><button type="button" onClick={reset}>Reset filters</button>
    <p>State and outcome membership can change while runs progress. Refresh starts at the first page.</p>
  </form>;
}
