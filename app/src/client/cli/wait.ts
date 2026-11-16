import type { ApiClient, Run } from '@beetle/contracts/api';
import { clientFailure } from './auth.js';
export interface WaitClock {now(): number; sleep(ms: number, signal: AbortSignal): Promise<void>}
export const waitClock: WaitClock = {now: () => performance.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
  const done = () => {signal.removeEventListener('abort', abort); resolve();};
  const timer = setTimeout(done, ms);
  const abort = () => {clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('interrupted'));};
  signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
})};
export function terminal(run: Run): boolean {return ['finished', 'cancelled', 'errored'].includes(run.state);}
/** Map declared application facts only; never reinterpret metrics or engine seals. */
export function runExit(run: Run): number {
  if (!terminal(run)) return 5;
  if (run.state === 'cancelled') return 4;
  switch (run.outcome) {case 'passed': return 0; case 'failed': return 1; default: return 3;}
}
export async function waitForRun(input: {api: ApiClient; run: Run; deadline: number; signal: AbortSignal; clock: WaitClock}): Promise<Run> {
  let current = input.run;
  for (let reads = 0; reads < 1801 && !terminal(current); reads++) {
    const remaining = input.deadline - input.clock.now(); if (remaining <= 0 || input.signal.aborted) return current;
    try {await input.clock.sleep(Math.min(2000, remaining), input.signal);} catch {return current;}
    if (expired(input)) return current;
    const {organizationId, workspaceId} = current.scope;
    const result = await input.api.getRun({params: {organizationId, workspaceId, runId: current.id}, signal: input.signal});
    if (expired(input)) return current;
    if (!result.ok) clientFailure(result.error);
    current = result.value;
  }
  return current;
}

function expired(input: {signal: AbortSignal; clock: WaitClock; deadline: number}): boolean {return input.signal.aborted || input.clock.now() >= input.deadline;}
