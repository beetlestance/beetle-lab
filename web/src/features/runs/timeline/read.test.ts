// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readTimeline } from './read.js';
import { deferred, json, page, requested, run, testClient } from './fixtures.js';
function owner() { return { scope: run().scope, runId: run().id, attemptId: run().activeAttemptId, active: true }; }
it('uses two generated-client calls for long history then one confirmed resume, without retaining raw events', async () => {
  const fixture = testClient(request => json(page({ ...requested(request.path), through: 60000 })));
  const input = { api: fixture.client, owner: owner(), signal: new AbortController().signal, previous: undefined };
  const data = await readTimeline(input);
  expect(fixture.records).toHaveLength(2); expect(requested(fixture.records[0]!.path)).toEqual({ after: 0, limit: 1 });
  expect(requested(fixture.records[1]!.path)).toEqual({ after: 59900, limit: 100 });
  expect(data.rows).toHaveLength(100); expect(data.omitted).toBe(true); expect(JSON.stringify(data)).not.toContain('private-runtime');
  const empty = await readTimeline({ ...input, previous: data });
  expect(fixture.records).toHaveLength(3); expect(empty.rows).toEqual(data.rows);
});
it.each([1, 2])('retirement after held bootstrap call %s prevents continuation or publication', async heldCall => {
  const held = deferred<Response>(); let calls = 0; const identity = owner();
  const fixture = testClient(request => ++calls === heldCall ? held.promise : json(page({ ...requested(request.path), through: 200 })));
  const promise = readTimeline({ api: fixture.client, owner: identity, signal: new AbortController().signal, previous: undefined });
  // Wait only for the held actual call; no abort-aware mock hides the late completion.
  while (calls < heldCall) await new Promise(resolve => setTimeout(resolve, 1));
  identity.active = false;
  held.resolve(json(page({ after: heldCall === 1 ? 0 : 100, limit: heldCall === 1 ? 1 : 100, through: 200 })));
  await expect(promise).rejects.toThrow('retired'); expect(calls).toBe(heldCall);
});
it('checks abort before issuance and rejects a generated-valid replacement attempt', async () => {
  const fixture = testClient(() => json(page({ current: { ...run(), activeAttemptId: run().scope.workspaceId } })));
  const input = { api: fixture.client, owner: owner(), signal: new AbortController().signal, previous: undefined };
  await expect(readTimeline(input)).rejects.toThrow('attempt changed');
  const controller = new AbortController(); controller.abort();
  await expect(readTimeline({ ...input, signal: controller.signal })).rejects.toThrow('retired'); expect(fixture.records).toHaveLength(1);
});
