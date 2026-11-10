import { vi } from 'vitest';
import type { OutputRuntime } from '../../src/ports/output-runtime.js';
import { ownerFixture } from '../bootstrap/agent-owners-fixture.js';

export { deferred, flush } from '../bootstrap/agent-owners-fixture.js';
export function outputOwnerFixture(start: ReturnType<typeof vi.fn>) {
  const parent = ownerFixture(start);
  let notify: ((error: unknown) => Promise<void>) | undefined;
  let notification: Promise<void> | undefined;
  let failure: { error: unknown } | undefined;
  const output: OutputRuntime = {
    state: () => ({ status: 'running', active: 0, problem: null }),
    close: vi.fn(async () => {
      await notification;
      if (failure) throw failure.error;
    }),
  };
  const openOutputs = vi.fn(async (onFailure: (error: unknown) => Promise<void>) => {
    notify = onFailure; return output;
  });
  function failOutput(error: unknown): Promise<void> {
    if (!notify) throw new Error('Output factory did not start');
    failure = { error }; notification = notify(error); return notification;
  }
  return { ...parent, output, openOutputs, failOutput };
}
