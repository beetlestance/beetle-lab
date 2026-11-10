import { describe, expect, it } from 'vitest';
import { fixture } from './output-custody-fixtures.js';
import { artifactsFixture, publishedIdentity, stageIdentity, writerId } from './output-artifacts-fixtures.js';
import { captureArtifactOperation, captureArtifactReply } from '../../src/adapters/outbound/sqlite/output-artifacts/index.js';
import { largeOperation, operationMessageLimit, operationReplyLimit } from '../../src/adapters/outbound/sqlite/input.js';
describe('durable artifact writer', () => {
  it('claims one logical writer, enforces exact changing CAS and never steals custody', () => {
    const f = artifactsFixture(); const value = f.claim();
    expect(value.artifact).toMatchObject({version: 2, writer: writerId, offset: 0});
    expect(f.claim()).toEqual(value);
    const before = f.allFacts();
    expect(() => f.execute({kind: 'outputClaimArtifact', request: {...f.request(2), writerId: '22222222-2222-4222-8222-222222222222'}})).toThrow();
    expect(() => f.progress(value, 1, stageIdentity, 1)).toThrow();
    expect(f.allFacts()).toEqual(before);
    const next = f.progress(value, 0); expect(next.artifact.version).toBe(3);
    expect(f.progress(next, 0)).toEqual(next);
    const high = f.progress(next, 20); expect(high.artifact.version).toBe(4);
    expect(f.progress(high, 10, stageIdentity, 2)).toEqual(high);
    expect(() => f.progress(high, 21, 'f'.repeat(64))).toThrow();
    expect(() => f.begin(high)).toThrow(); expect(() => f.publish(high)).toThrow();
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it.each([0, 32])('publishes %i bytes and replays after writer clearing without changing parent version or charges', bytes => {
    const f = artifactsFixture(bytes); const initialFacts = f.facts(); const claimed = f.claim();
    const full = f.progress(claimed, bytes); const publishing = f.begin(full);
    expect(f.begin(publishing)).toEqual(publishing);
    expect(f.progress(publishing, bytes)).toEqual(publishing);
    const published = f.publish(publishing);
    expect(published.artifact).toMatchObject({phase: 'published', identity: publishedIdentity, writer: null, version: 5});
    expect(f.publish(publishing)).toEqual(published); expect(f.claim()).toEqual(published);
    expect(f.adopt()).toMatchObject({kind: 'adopted', version: 1, artifacts: [published.artifact]});
    const before = f.allFacts(); expect(() => f.publish(publishing, 'f'.repeat(64))).toThrow();
    expect(() => f.progress(published, bytes)).toThrow(); expect(f.allFacts()).toEqual(before);
    expect(f.facts()).toEqual(initialFacts);
    expect(f.db.prepare('SELECT version FROM execution_output_sources').get()?.version).toBe(1);
  });
  it('rejects every mismatched original and digest, unknown ordinal and pending source atomically', () => {
    const f = artifactsFixture(); const before = f.allFacts();
    const badKeys = [{...f.key, sourceDigest: 'f'.repeat(64)}, {...f.key, manifestDigest: 'f'.repeat(64)},
      {...f.key, ordinal: 1}, {...f.key, binding: {...f.binding, journalAuthority: '11111111-1111-4111-8111-111111111111'}},
      {...f.key, binding: {...f.binding, key: {...f.key.binding.key, runId: '11111111-1111-4111-8111-111111111111'}}},
      {...f.key, binding: {...f.binding, key: {...f.key.binding.key, attempt: {...f.key.binding.key.attempt, organizationId: '11111111-1111-4111-8111-111111111111'}}}}];
    for (const key of badKeys) expect(() => f.execute({kind: 'outputClaimArtifact', request: {...f.request(), key}})).toThrow();
    expect(f.allFacts()).toEqual(before);
  });
  it('refuses a pending source and foreign workspace/attempt/digest originals without mutation', () => {
    const pending = fixture();
    const f = artifactsFixture();
    expect(() => pending.outputs.execute({kind: 'outputClaimArtifact', request: {...f.request(),
      key: {...f.key, binding: pending.binding}}})).toThrow();
    const before = f.allFacts(); const attempt = f.binding.key.attempt;
    for (const patch of [{workspaceId: writerId}, {attemptId: writerId}, {intentDigest: 'f'.repeat(64)}]) {
      const binding = {...f.binding, key: {...f.binding.key, attempt: {...attempt, ...patch}}};
      expect(() => f.execute({kind: 'outputClaimArtifact', request: {...f.request(), key: {...f.key, binding}}})).toThrow();
    }
    expect(f.allFacts()).toEqual(before); expect(pending.carrier()).toHaveLength(0);
  });
  it('captures bounded closed request/reply without accessors and keeps small operations off large credits', () => {
    const f = artifactsFixture(); const operation = {kind: 'outputClaimArtifact', request: f.request()} as const;
    expect(operationMessageLimit(operation)).toBe(4096); expect(operationReplyLimit(operation)).toBe(4096);
    expect(largeOperation(operation)).toBe(false); expect(captureArtifactOperation(operation)).toEqual(operation);
    expect(() => captureArtifactOperation({...operation, request: {...f.request(), extra: 'x'.repeat(4097)}} as never)).toThrow();
    const request = Object.defineProperty({}, 'key', {enumerable: true, get: () => {throw new Error('Accessor invoked');}});
    expect(() => captureArtifactOperation({...operation, request} as typeof operation)).toThrow();
    expect(() => captureArtifactOperation({...operation, request: {...f.request(), expectedVersion: Number.MAX_SAFE_INTEGER + 1}})).toThrow();
    const claimed = f.claim();
    expect(() => captureArtifactReply(operation, {...claimed, artifact: {...claimed.artifact, ordinal: 1}})).toThrow();
    expect(() => captureArtifactReply(operation, {...claimed, artifact: {...claimed.artifact, identity: 'x'.repeat(4097)}})).toThrow();
    expect(captureArtifactReply(operation, claimed)).toEqual(claimed);
  });
  it('rejects wrong receipt tokens, phases, offsets and writers without mutating any facts', () => {
    const f = artifactsFixture(); const record = f.claim(); const before = f.allFacts();
    const receipt = {token: record.artifact.token, offset: 0, phase: 'transferring', identity: stageIdentity} as const;
    for (const patch of [{token: writerId}, {offset: 33}, {offset: -1}, {identity: 'a'}, {phase: 'published'}]) {
      expect(() => f.execute({kind: 'outputRecordProgress', request: {...f.request(2), receipt: {...receipt, ...patch}}} as never)).toThrow();
    }
    expect(() => f.execute({kind: 'outputRecordProgress', request: {...f.request(2), writerId: record.artifact.token, receipt}})).toThrow();
    expect(f.allFacts()).toEqual(before);
  });
});
