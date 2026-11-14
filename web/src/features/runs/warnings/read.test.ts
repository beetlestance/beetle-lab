import { expect, it, vi } from 'vitest';
import source from '../../../../../contracts/fixtures/valid/k6-warnings.json' with {type: 'json'};
import { WarningReads } from './read.js';
import { fixture } from '../target-observations/read-fixtures.js';
async function hash(bytes: Uint8Array): Promise<string> {
 const value = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
 return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function setup(foreign = false) {
  const f = fixture();
  const report = structuredClone(source) as {scope: Record<string, string | number>};
  report.scope = {organizationId: f.params.organizationId, workspaceId: f.params.workspaceId,
    attemptId: foreign ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : f.params.attemptId, generation: 1};
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  const fetcher = vi.fn(async () => new Response(bytes));
  const reads = new WarningReads({fetch: fetcher, digest: async input => hash(input), monotonic: () => 0});
  return {reads, fetcher, report, input: {...f.input, artifact: {...f.artifact, kind: 'k6-warnings', bytes: bytes.length, sha256: await hash(bytes)}}};
}
it('verifies scoped warning bytes and rejects a valid foreign payload after integrity verification', async () => {
  const f = await setup(); expect(await f.reads.read(f.input)).toEqual(f.report);
  const other = await setup(true); await expect(other.reads.read(other.input)).rejects.toThrow('scope');
});
it('refuses over-cap metadata before issuing a fetch', async () => {
  const f = await setup(); await expect(f.reads.read({...f.input, artifact: {...f.input.artifact, bytes: 4097}})).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
});
