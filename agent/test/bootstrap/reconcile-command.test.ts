import { expect, it } from 'vitest';
import { parseReconcileArguments, runReconcileCommand } from '../../src/bootstrap/reconcile-command.js';
import type { ReconcileKey, ReconcileRuntime } from '../../src/bootstrap/types.js';
import { RetirementPipelineError } from '../../src/retirement-pipeline/index.js';
import { captureWindow } from '../../src/runtime-retirement/index.js';
import type { Operation } from '../../src/backends/docker/index.js';
const live = () => new AbortController().signal;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n: number): ReconcileKey => ({ organizationId: id(900), workspaceId: id(901), attemptId: id(n), generation: 1 });
function fake(total: number, refuse = new Set<number>(), during?: (n: number, operation: Operation) => void) {
  const calls: string[] = [];
  const runtime: ReconcileRuntime = {
    async candidates(after) {
      calls.push(`list:${after}`);
      const start = after === null ? 1 : Number(after.slice(-12)) + 1;
      const end = Math.min(total, start + 31);
      const candidates = [];
      for (let n = start; n <= end; n++) candidates.push({ key: key(n), reconciled: n % 2 === 0 });
      return { candidates, next: end < total ? id(end) : null };
    },
    async reconcile(input, operation) {
      const n = Number(input.attemptId.slice(-12));
      calls.push(`reconcile:${n}`);
      // The real pipeline admission validates the window before any retirement work.
      captureWindow(operation);
      during?.(n, operation);
      if (refuse.has(n)) throw new RetirementPipelineError('conflict');
      return n % 2 === 0 ? { state: 'current' } : { state: 'reconciled', reconciliation: {} as never };
    },
    close: async () => undefined,
  };
  return { runtime, calls };
}
it('accepts exactly preview or --apply', () => {
  expect(parseReconcileArguments([])).toEqual({ apply: false });
  expect(parseReconcileArguments(['--apply'])).toEqual({ apply: true });
  for (const args of [['apply'], ['--apply', '--apply'], ['--force'], ['--apply', 'x']]) expect(parseReconcileArguments(args)).toBeNull();
});
it('previews every page from the Journal without reconciling anything', async () => {
  const { runtime, calls } = fake(40); const lines: string[] = [];
  expect(await runReconcileCommand({ apply: false }, runtime, (line) => lines.push(line), live())).toBe(0);
  expect(calls).toEqual(['list:null', `list:${id(32)}`]);
  expect(lines).toHaveLength(41);
  expect(JSON.parse(lines[1]!)).toEqual({ attemptId: id(2), reconciled: true });
  expect(JSON.parse(lines.at(-1)!)).toEqual({ mode: 'preview', attempts: 40, refused: 0, stopped: false });
});
it('applies one attempt at a time, reports refusals by code and exits non-zero', async () => {
  const { runtime, calls } = fake(3, new Set([2])); const lines: string[] = [];
  expect(await runReconcileCommand({ apply: true }, runtime, (line) => lines.push(line), live())).toBe(1);
  expect(calls).toEqual(['list:null', 'reconcile:1', 'reconcile:2', 'reconcile:3']);
  expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
    { attemptId: id(1), outcome: 'reconciled' },
    { attemptId: id(2), outcome: 'refused', reason: 'conflict' },
    { attemptId: id(3), outcome: 'reconciled' },
    { mode: 'apply', attempts: 3, refused: 1, stopped: false },
  ]);
});
it('applies across pages by cursor, each page before the next is read', async () => {
  const { runtime, calls } = fake(33); const lines: string[] = [];
  expect(await runReconcileCommand({ apply: true }, runtime, (line) => lines.push(line), live())).toBe(0);
  expect(calls.indexOf(`list:${id(32)}`)).toBe(33);
  expect(calls.filter((call) => call.startsWith('reconcile:'))).toHaveLength(33);
  expect(JSON.parse(lines.at(-1)!)).toEqual({ mode: 'apply', attempts: 33, refused: 0, stopped: false });
});
it('stops on the signal: cancels the attempt in progress and admits no later attempt or page', async () => {
  const abort = new AbortController(); const seen: (AbortSignal | undefined)[] = [];
  const { runtime, calls } = fake(40, new Set(), (n, operation) => {
    seen.push(operation.signal);
    if (n === 2) { abort.abort(); throw new RetirementPipelineError('closed'); }
  });
  const lines: string[] = [];
  expect(await runReconcileCommand({ apply: true }, runtime, (line) => lines.push(line), abort.signal)).toBe(1);
  expect(calls).toEqual(['list:null', 'reconcile:1', 'reconcile:2']);
  expect(seen).toEqual([abort.signal, abort.signal]);
  expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
    { attemptId: id(1), outcome: 'reconciled' },
    { attemptId: id(2), outcome: 'refused', reason: 'closed' },
    { mode: 'apply', attempts: 2, refused: 1, stopped: true },
  ]);
});
it('lists nothing once stopped before the first page', async () => {
  const abort = new AbortController(); abort.abort(); const { runtime, calls } = fake(5); const lines: string[] = [];
  expect(await runReconcileCommand({ apply: true }, runtime, (line) => lines.push(line), abort.signal)).toBe(1);
  expect(calls).toEqual([]);
  expect(JSON.parse(lines[0]!)).toEqual({ mode: 'apply', attempts: 0, refused: 0, stopped: true });
});
