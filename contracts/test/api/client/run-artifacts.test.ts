import { expect, it } from 'vitest';
import { createApiClient, captureRunArtifactCursor, encodeRunArtifactCursor, runArtifactPageMatches } from '../../../src/api/index.js';
import type { RunArtifactPage } from '../../../src/api/index.js';
import { baseUrl, otherId, reply } from './helpers.js';
const params = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003', attemptId: '00000000-0000-4000-8000-000000000004'};
function page(): RunArtifactPage {
  return {id: params.runId, scope: {kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId},
    attemptId: params.attemptId, generation: 1, availability: 'ready', manifestDigest: 'a'.repeat(64), nextCursor: null,
    items: [{artifactId: otherId, kind: 'raw', relativePath: 'synthetic.bin', bytes: 2, sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z'}]};
}
it('dispatches artifact descriptors independently of generic item.scope and accepts pending/absent', async () => {
  const value = page(); const api = createApiClient({baseUrl, fetch: reply(value)});
  expect(await api.listRunArtifacts({params, query: {limit: 1}})).toEqual({ok: true, value});
  for (const availability of ['pending', 'absent'] as const) {
    const empty = {...value, availability, items: [], manifestDigest: null};
    expect(await createApiClient({baseUrl, fetch: reply(empty)}).listRunArtifacts({params, query: {limit: 1}})).toEqual({ok: true, value: empty});
  }
});
it.each(['run', 'attempt', 'scope', 'duplicate', 'pending', 'cursor', 'limit'])('rejects semantically invalid %s replies', async mode => {
  const value = page();
  switch (mode) {
    case 'run': value.id = otherId; break;
    case 'attempt': value.attemptId = otherId; break;
    case 'scope': value.scope.workspaceId = otherId; break;
    case 'duplicate': value.items.push(value.items[0]!); break;
    case 'pending': value.availability = 'pending'; break;
    case 'cursor': value.nextCursor = 'AA'; break;
    case 'limit': value.items.push({...value.items[0]!, artifactId: params.runId}); break;
  }
  expect(await createApiClient({baseUrl, fetch: reply(value)}).listRunArtifacts({params, query: {limit: 1}})).toEqual({ok: false, error: {kind: 'response'}});
});
it('bounds and canonically binds the distinct artifact cursor lane', () => {
  const position = {lane: 'artifacts' as const, ...params, generation: 1 as const, manifestDigest: 'a'.repeat(64), ordinal: 1};
  const cursor = encodeRunArtifactCursor(position); expect(cursor.length).toBeLessThanOrEqual(512);
  expect(captureRunArtifactCursor(cursor)).toEqual(position);
  for (const bad of [cursor + '=', 'AA', 'x'.repeat(513)]) expect(() => captureRunArtifactCursor(bad)).toThrow();
  for (const ordinal of [0, 128, -1, 1.5]) expect(() => encodeRunArtifactCursor({...position, ordinal})).toThrow();
  const value = page(); const query = {id: value.id, scope: value.scope, attemptId: value.attemptId, limit: 1};
  const bytes = Buffer.byteLength(JSON.stringify({...value, padding: ''}));
  expect(runArtifactPageMatches({...value, padding: 'x'.repeat(73728 - bytes)} as RunArtifactPage, query)).toBe(true);
  expect(runArtifactPageMatches({...value, padding: 'x'.repeat(73729 - bytes)} as RunArtifactPage, query)).toBe(false);
  expect(runArtifactPageMatches(value, {...query, cursor: encodeRunArtifactCursor({...position, manifestDigest: 'b'.repeat(64)})})).toBe(false);
});
