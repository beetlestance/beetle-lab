import { useState } from 'react';
import type { RunListQuery } from '@beetle/contracts/api';

export type HistoryFilter = Pick<RunListQuery, 'state' | 'outcome' | 'order'>;
const runStates = ['queued', 'dispatching', 'active', 'finalizing', 'finished', 'cancelled', 'errored'] as const;
const outcomes = ["pending", "passed", "failed", "inconclusive"] as const;
export function HistoryFilters({ applied, apply }: { applied: HistoryFilter; apply: (value: HistoryFilter) => void }) {
  const [draft, setDraft] = useState(applied);
  function edit(field: 'state' | 'outcome', value: string) {
    const next = { ...draft }; delete next[field];
    if (field === 'state' && value) next.state = value as NonNullable<HistoryFilter['state']>;
    if (field === 'outcome' && value) next.outcome = value as NonNullable<HistoryFilter['outcome']>;
    setDraft(next);
  }
  function reset() { const value = { order: 'newest' as const }; setDraft(value); apply(value); }
  return <form aria-label="History filters" onSubmit={event => { event.preventDefault(); apply(draft); }}>
    <label>State <select value={draft.state ?? ''} onChange={event => edit('state', event.target.value)}>
      <option value="">All states</option>{runStates.map(state => <option key={state}>{state}</option>)}
    </select></label>
    <label>Outcome <select value={draft.outcome ?? ''} onChange={event => edit('outcome', event.target.value)}>
      <option value="">All outcomes</option>{outcomes.map(outcome => <option key={outcome}>{outcome}</option>)}
    </select></label>
    <label>Order <select value={draft.order ?? 'newest'} onChange={event => setDraft({ ...draft, order: event.target.value as NonNullable<HistoryFilter['order']> })}>
      <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
    </select></label>
    <button type="submit">Apply filters</button><button type="button" onClick={reset}>Reset filters</button>
    <p>State and outcome membership can change while runs progress. Refresh starts at the first page.</p>
  </form>;
}
