import { expect, it } from 'vitest';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import { openReconcileRuntime } from '../../src/bootstrap/runtime.js';
import { fixture } from './fixtures.js';
import { observation, now, scope } from '../admission/fixtures.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { runReconcileCommand } from '../../src/bootstrap/reconcile-command.js';
import type { ReconcileRuntime } from '../../src/bootstrap/types.js';
const f = fixture();
it('opens offline with the process owner, serves and schedules nothing, and lists no unprepared task', async () => {
  const e = await f.setup();
  const runtime = await openReconcileRuntime(e.options);
  try {
    expect(Object.keys(runtime).sort()).toEqual(['candidates', 'close', 'reconcile']);
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
    expect(await runtime.candidates(null)).toEqual({ candidates: [], next: null });
    expect(e.daemon.mutations()).toHaveLength(0);
    expect(e.daemon.calls.some((call) => call.path.includes('/events') || call.path.includes('/containers/json'))).toBe(false);
  } finally { await runtime.close(); }
  const serving = f.keep(await openAgentRuntime(e.options)); await serving.initial; await serving.close();
});
it('refuses an attempt whose task was never prepared and refuses a key without a stored intent', async () => {
  const e = await f.setup(); const journal = await f.open(e.journalPath);
  const preflight = e.options.catalog.preflight(e.offer); const key = scope(preflight.offer);
  await journal.admission({ kind: 'configure', configuration: { ...e.options.configuration, profiles: e.options.catalog.engines.map(engine => engine.approved) } });
  const observed = observation(); observed.capacity.outputBytes = 131_072;
  await journal.admission({ kind: 'observe', observation: observed });
  await journal.admission({ kind: 'offer', offer: preflight.offer, validation: preflight.validation, now });
  await journal.admission({ kind: 'admit', key, now, sourceOrdinal: 1 });
  await journal.admission({ kind: 'abortUnstarted', key }); const proof = await journal.closeOutputAbsence(key);
  if (!proof) throw new Error('Missing closure');
  await journal.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: proof.finalAgentSeq });
  await f.close(journal);
  const target = { ...key, generation: 1 as const };
  let runtime = await openReconcileRuntime(e.options);
  try {
    await expect(runtime.reconcile(target, { deadline: performance.now() + 5000 })).rejects.toMatchObject({ reason: 'conflict' });
  } finally { await runtime.close(); }
  // Store the retirement intent through the serving runtime, then stop it.
  const serving = f.keep(await openAgentRuntime(e.options)); await serving.initial;
  const work = serving.retirement.retire(requestFor(proof)); expect((await work.result).ok).toBe(true); await work.settled; await serving.close();
  runtime = await openReconcileRuntime(e.options);
  try {
    expect(await runtime.candidates(null)).toEqual({ candidates: [], next: null });
    await expect(runtime.reconcile(target, { deadline: performance.now() + 5000 })).rejects.toMatchObject({ reason: 'conflict' });
    // Composed: the command's own deadline and signal pass real pipeline admission, so the attempt
    // reaches the prepared-task check (conflict), not invalid_input.
    const listed: ReconcileRuntime = { ...runtime, candidates: async () => ({ candidates: [{ key: target, reconciled: false }], next: null }) };
    const lines: string[] = [];
    expect(await runReconcileCommand({ apply: true }, listed, (line) => lines.push(line), new AbortController().signal)).toBe(1);
    expect(JSON.parse(lines[0]!)).toEqual({ attemptId: target.attemptId, outcome: 'refused', reason: 'conflict' });
    // An aborted signal is honoured by the real pipeline as closed, before any retirement work.
    const abort = new AbortController(); abort.abort();
    await expect(runtime.reconcile(target, { deadline: performance.now() + 5000, signal: abort.signal })).rejects.toMatchObject({ reason: 'closed' });
    expect(e.daemon.mutations()).toHaveLength(0);
  } finally { await runtime.close(); }
});
