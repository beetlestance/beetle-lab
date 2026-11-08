import type { AgentEvent, AttemptSnapshot } from '@beetle/contracts';
import { canonical } from './input.js';
import { Failure } from './sql.js';
import type { Row } from './sql.js';

const phases = ['validate', 'prepare', 'execute', 'collect', 'seal'] as const;
type Phase = typeof phases[number];
export interface Projection {
  readonly state: AttemptSnapshot['state']; readonly phase: Phase | null;
  readonly exit_json: string | null; readonly exit_facts_json: string | null; readonly result_json: string | null;
  readonly snapshot_bytes: number;
}
function terminal(state: AttemptSnapshot['state']): boolean { return state === 'exited' || state === 'lost'; }
function phaseState(phase: Phase): AttemptSnapshot['state'] {
  if (phase === 'validate' || phase === 'prepare') return 'preparing';
  return phase === 'execute' ? 'running' : 'collecting';
}
function known<T>(before: T | null, after: T | null): T | null {
  if (before !== null && after !== null && before !== after) throw new Failure('conflict');
  return before ?? after;
}
function exit(row: Row, event: Extract<AgentEvent, { kind: 'runtime.exited' }>): Pick<Projection, 'exit_json' | 'exit_facts_json'> {
  const prior = JSON.parse(row.exit_facts_json ?? row.exit_json ?? '{"exitCode":null,"oomKilled":null}') as
    NonNullable<AttemptSnapshot['exitEvidence']>;
  const reason = known(prior.reason ?? null, event.payload.reason ?? null);
  const facts = { exitCode: known(prior.exitCode, event.payload.exitCode),
    oomKilled: known(prior.oomKilled, event.payload.oomKilled), ...(reason === null ? {} : { reason }) };
  // The first public witness stays immutable; confirmed facts must survive later unknowns/restart.
  return { exit_json: row.exit_json ?? JSON.stringify(event.payload), exit_facts_json: JSON.stringify(facts) };
}
function wrapper(row: Row, event: Extract<AgentEvent, { source: 'wrapper' }>): Projection {
  const phase = row.phase === null || phases.indexOf(event.phase) > phases.indexOf(row.phase) ? event.phase : row.phase;
  let result = row.result_json;
  if (event.kind === 'engine.result') {
    if (result !== null && canonical(JSON.parse(result)) !== canonical(event.payload)) throw new Failure('conflict');
    result ??= JSON.stringify(event.payload);
  }
  // A wrapper seal is result evidence, never supervisor proof that its container exited.
  const state = terminal(row.state) || row.state === 'stopping' ? row.state : phaseState(phase);
  return measured({ state, phase, exit_json: row.exit_json, exit_facts_json: row.exit_facts_json, result_json: result });
}
function measured(value: Omit<Projection, 'snapshot_bytes'>): Projection {
  return { ...value, snapshot_bytes: Buffer.byteLength(value.phase ?? '')
    + Buffer.byteLength(value.exit_json ?? '') + Buffer.byteLength(value.exit_facts_json ?? '')
    + Buffer.byteLength(value.result_json ?? '') };
}
function startedState(row: Row): AttemptSnapshot['state'] {
  if (terminal(row.state) || row.state === 'stopping') return row.state;
  return row.phase === null ? 'running' : phaseState(row.phase);
}
function supervisor(row: Row, event: Extract<AgentEvent, { source: 'agent' }>): Projection {
  const current = { state: row.state, phase: row.phase, exit_json: row.exit_json,
    exit_facts_json: row.exit_facts_json, result_json: row.result_json };
  switch (event.kind) {
    case 'runtime.exited':
      return measured({ ...current, state: 'exited', ...exit(row, event) });
    case 'execution.lost': return measured({ ...current, state: row.exit_json === null ? 'lost' : 'exited' });
    case 'runtime.started':
      return measured({ ...current, state: startedState(row) });
    case 'admitted': return measured({ ...current, state: row.state === 'offered' ? 'admitted' : row.state });
    case 'cancellation.requested':
      if (!row.cancel_requested) throw new Failure('conflict');
      return measured({ ...current, state: terminal(row.state) ? row.state : 'stopping' });
    default: return measured(current);
  }
}
/** Pure projection of accepted evidence. Its owner commits it with event/cursor/charge. */
export function project(row: Row, event: AgentEvent): Projection {
  return event.source === 'wrapper' ? wrapper(row, event) : supervisor(row, event);
}
