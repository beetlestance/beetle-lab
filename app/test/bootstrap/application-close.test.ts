import { expect, it, vi } from 'vitest';
import { closeApplicationStore, throwCloseFailures } from '../../src/bootstrap/application-close.js';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
const flush = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
it('keeps metadata open until both original agent and input drains settle', async () => {
  const agentHeld = deferred(); const inputHeld = deferred();
  const agent = { close: vi.fn().mockReturnValue(agentHeld.promise) };
  const inputs = { close: vi.fn().mockReturnValue(inputHeld.promise) };
  const metadata = { close: vi.fn().mockResolvedValue(undefined) };
  const closing = closeApplicationStore(agent, inputs, metadata); await flush();
  expect(agent.close).toHaveBeenCalledTimes(1); expect(inputs.close).toHaveBeenCalledTimes(1);
  expect(metadata.close).not.toHaveBeenCalled();
  agentHeld.resolve(); await flush(); expect(metadata.close).not.toHaveBeenCalled();
  inputHeld.resolve(); await closing; expect(metadata.close).toHaveBeenCalledTimes(1);
});
it('drains the other original owner before metadata even when a peer fails', async () => {
  const failure = new Error('synthetic agent'); const held = deferred();
  const metadata = { close: vi.fn().mockResolvedValue(undefined) };
  const closing = closeApplicationStore({ close: async () => { throw failure; } }, { close: () => held.promise }, metadata);
  const result = expect(closing).rejects.toBe(failure); await flush(); expect(metadata.close).not.toHaveBeenCalled();
  held.resolve(); await result; expect(metadata.close).toHaveBeenCalledTimes(1);
});
it('preserves all original close failures without skipping metadata cleanup', async () => {
  const first = new Error('agent'); const second = new Error('inputs'); const third = new Error('metadata');
  const metadata = { close: vi.fn().mockRejectedValue(third) };
  await expect(closeApplicationStore({ close: async () => { throw first; } },
    { close: async () => { throw second; } }, metadata)).rejects.toMatchObject({ errors: [first, second, third] });
  expect(metadata.close).toHaveBeenCalledTimes(1);
});
it('propagates a rejection even when its original reason is falsy', () => {
  for (const reason of [undefined, null, false, 0]) {
    let thrown = false;
    try { throwCloseFailures([{ status: 'rejected', reason }]); }
    catch (error) { thrown = true; expect(error).toBe(reason); }
    expect(thrown).toBe(true);
  }
});

it('preserves original error identity when multiple close paths propagate the same failure', () => {
  const failure = new Error('synthetic original');
  let caught = false;
  try { throwCloseFailures([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]); }
  catch (error) { caught = true; expect(error).toBe(failure); }
  expect(caught).toBe(true);
});
it('preserves distinct original failures even when their messages are identical', () => {
  const first = new Error('same text'); const second = new Error('same text');
  try { throwCloseFailures([{ status: 'rejected', reason: first }, { status: 'rejected', reason: second }]); }
  catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.errors).toHaveLength(2); expect(aggregate.errors[0]).toBe(first); expect(aggregate.errors[1]).toBe(second);
    return;
  }
  throw new Error('Expected both original failures');
});
