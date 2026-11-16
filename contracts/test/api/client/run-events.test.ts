import { expect, it } from 'vitest';
import { createApiClient, captureRunEventCursor, encodeRunEventCursor, runEventPageMatches, validateApi } from '../../../src/api/index.js';
import type { RunEventPage } from '../../../src/api/index.js';
import batch from '../../../fixtures/valid/events.json' with { type: 'json' };
import { baseUrl, otherId, reply } from './helpers.js';
const event = batch.events[0]!;
const params = { organizationId: event.organizationId, workspaceId: event.workspaceId, runId: '00000000-0000-4000-8000-000000000090' };
const query = { limit: 2 };
function page(): RunEventPage {
  const cursor = encodeRunEventCursor({ ...params, attemptId: event.attemptId, generation: 1, afterSeq: 1 });
  return { id: params.runId, scope: { kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId },
    activeAttemptId: event.attemptId, generation: 1, afterSeq: 0, durableThrough: 1, coverage: 'contiguous',
    blockedReason: null, retainedStartSeq: null, items: [{ ...event, seq: 1 } as RunEventPage['items'][number]], resumeCursor: cursor, nextCursor: null };
}
it('dispatches AgentEvent ownership independently of generic item.scope and polls resume', async () => {
  const value = page(); expect(validateApi('RunEventPage', value).ok).toBe(true);
  expect(await createApiClient({ baseUrl, fetch: reply(value) }).listRunEvents({ params, query })).toEqual({ ok: true, value });
  const empty = { ...value, afterSeq: 1, items: [] };
  expect(await createApiClient({ baseUrl, fetch: reply(empty) }).listRunEvents({ params, query: { ...query, cursor: value.resumeCursor } }))
    .toEqual({ ok: true, value: empty });
});
it.each(['run', 'attempt', 'scope', 'eventAttempt', 'sequence', 'highwater', 'after', 'resume', 'next', 'coverage', 'limit'])(
'rejects semantically mismatched %s responses', async mode => {
  const value = page();
  const changes: Record<string, () => void> = {
    run: () => { value.id = otherId; }, attempt: () => { value.activeAttemptId = otherId; },
    scope: () => { value.scope.workspaceId = otherId; }, eventAttempt: () => { value.items[0]!.attemptId = otherId; },
    sequence: () => { value.items[0]!.seq = 2; }, highwater: () => { value.durableThrough = 0; },
    after: () => { value.afterSeq = 1; }, resume: () => { value.resumeCursor = 'AA'; },
    next: () => { value.nextCursor = value.resumeCursor; }, coverage: () => { value.coverage = 'pending'; },
    limit: () => { value.items.push({ ...value.items[0]! }); },
  };
  changes[mode]!();
  expect(await createApiClient({ baseUrl, fetch: reply(value) }).listRunEvents({ params, query: { limit: 1 } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});
it('accepts exactly the full page byte cap and rejects the next byte', () => {
  const value = page(); const key = { id: params.runId, scope: value.scope, limit: 2 };
  // Semantic helper is called only after schema; synthetic padding isolates its exact byte bound.
  const bytes = Buffer.byteLength(JSON.stringify({ ...value, padding: '' }));
  expect(runEventPageMatches({ ...value, padding: 'x'.repeat(262144 - bytes) } as RunEventPage, key)).toBe(true);
  expect(runEventPageMatches({ ...value, padding: 'x'.repeat(262145 - bytes) } as RunEventPage, key)).toBe(false);
});

it('validates closed cursor positions before encoding and normalizes UUID case', () => {
  const position = captureRunEventCursor(page().resumeCursor);
  expect(encodeRunEventCursor({ ...position, attemptId: position.attemptId.toUpperCase() })).toBe(page().resumeCursor);
  const malformed = [{ ...position, extra: 1 }, { ...position, generation: 2 }, { ...position, afterSeq: -1 },
    { ...position, afterSeq: 65537 }, { ...position, afterSeq: 1.5 }, { ...position, runId: 'x'.repeat(513) }];
  for (const value of malformed) {
    expect(() => encodeRunEventCursor(value as typeof position)).toThrow();
    const raw = btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(() => captureRunEventCursor(raw)).toThrow();
  }
});
it.each([0, 101, 1.5, NaN])('semantic matching independently rejects requested limit %s', limit => {
  const value = page();
  expect(runEventPageMatches(value, { id: value.id, scope: value.scope, limit })).toBe(false);
});
