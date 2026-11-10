import { createHash } from 'node:crypto';
import { sealEngineResult } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { prepareOutputManifest, captureSourceChunkRequest } from '@beetle/contracts/output-source';
import type { Owned, SourceEnvelope, SourceChunkRequest } from '@beetle/contracts/output-source';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { acknowledge, reserveAndMark } from '../storage/execution-foundation-fixtures.js';
import { observation, settingsFixture } from '../storage/fixture.js';
import { result } from '../domain/run-observation-fixtures.js';
import { loopback, send } from '../runner/fixtures.js';
import { id } from './controlled-fixture.js';

export const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function binary() {return Buffer.from(Array.from({length: 131089}, (_, index) => (index * 197 + (index >>> 8)) & 255));}
export function seeded(artifacts: Artifact[]) {
  const f = claimsFixture();
  f.policy(values => {values.pool.outputBytes = 1_000_000; values.perRunCeilings.outputBytes = 1_000_000; values.pool.storageBytes = 4_000_000;});
  const runtime = observation(settingsFixture().runtime); runtime.ceilings.pool.outputBytes = 1_000_000;
  runtime.ceilings.perRun.outputBytes = 1_000_000; runtime.ceilings.pool.storageBytes = 4_000_000;
  f.store.execute({kind: 'runtime', runtime});
  const key = f.add(70, 'parallel', 100, 300_000);
  transaction(f.db, () => {reserveAndMark(f.db, key); acknowledge(f.db, key);});
  const binding = {key, journalAuthority: runtime.journalAuthority}; const offer = f.claims.readOffer(key).offer;
  if (!offer.installedIdentity) throw new Error('Missing synthetic original pin');
  const {seal, ...body} = result(); const {intentDigest, ...scope} = key.attempt; void intentDigest;
  const sealed = sealEngineResult({...body, ...scope, artifacts}, seal.sealedAt, sha);
  if (!sealed.ok) throw new Error('Invalid synthetic result');
  const manifest = prepareOutputManifest({version: 1, binding: {...key.attempt, journalAuthority: binding.journalAuthority,
    engine: offer.engine, installedIdentity: offer.installedIdentity, specDigest: 'b'.repeat(64)}, result: sealed.value,
    resultFileBytes: 1024, controlBytes: 0, verifiedBytes: 1024 + artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0)}, sha);
  const sourceDigest = 'c'.repeat(64);
  const envelope: Owned<SourceEnvelope> = {version: 1, manifest, sourceDigest, closure: {version: 1, finalAgentSeq: 1,
    receipt: {version: 1, journalAuthority: binding.journalAuthority, key: scope, manifestDigest: manifest.manifestDigest, sourceDigest}}};
  return {...f, binding, envelope};
}
export function descriptor(bytes: Uint8Array, ordinal = 0): Artifact {
  return {artifactId: id(501 + ordinal), kind: 'raw', relativePath: `synthetic-${ordinal}.bin`, bytes: bytes.length,
    sha256: sha(bytes), sealedAt: '2026-01-01T00:00:00Z'};
}
/** Bounded synthetic protocol peer, with no engine or target routes. */
export async function peer(envelope: Owned<SourceEnvelope>, contents: readonly Uint8Array[]) {
  const selectors: SourceChunkRequest[] = []; const unexpected: string[] = [];
  const prefix = `/runner/v1/attempts/${envelope.manifest.binding.attemptId}/source`;
  const server = await loopback((request, response) => {
    if (request.url === prefix && request.method === 'GET') {send(response, envelope); return;}
    if (request.url !== `${prefix}/chunk` || request.method !== 'POST') {
      unexpected.push(`${request.method} ${request.url}`); send(response, {}, 500); return;
    }
    let body = ''; let size = 0;
    request.on('data', (bytes: Buffer) => {size += bytes.length; if (size > 4096) request.destroy(); else body += bytes.toString('utf8');});
    request.on('end', () => {
      try {
        const selector = captureSourceChunkRequest(JSON.parse(body) as unknown);
        const ordinal = envelope.manifest.result.artifacts.findIndex(artifact => artifact.artifactId === selector.artifactId);
        if (selector.manifestDigest !== envelope.manifest.manifestDigest || selector.sourceDigest !== envelope.sourceDigest || ordinal < 0) throw new Error();
        const bytes = contents[ordinal]!; selectors.push(selector);
        const end = Math.min(bytes.length, selector.offset + selector.length);
        send(response, {...selector, length: undefined, nextOffset: end, totalBytes: bytes.length,
          eof: end === bytes.length, base64: Buffer.from(bytes.subarray(selector.offset, end)).toString('base64')});
      } catch {unexpected.push('invalid selector'); send(response, {}, 500);}
    });
  });
  return {...server, selectors, unexpected};
}
