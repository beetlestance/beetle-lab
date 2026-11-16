import { createHash } from 'node:crypto';
import { encodeCanonicalJson, sealEngineResult } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { CollectedSource, CollectionIntent, PrivateSource } from '../../src/output-source/index.js';
import { OUTPUT_MANIFEST_PREFIX, OUTPUT_SOURCE_PREFIX } from '../../src/output-source/index.js';
import data from '../../../contracts/fixtures/output-source/v1.json' with { type: 'json' };

export type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
interface Vector {
  name: string; input: CollectedSource<EngineResult>;
  expected: { manifestPreimage: string; manifestDigest: string; sourcePreimage: string; sourceDigest: string;
    manifestBytes: number; sourceBytes: number };
}
export const vectors = data.vectors as unknown as readonly Vector[];
export const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export function input(): Mutable<CollectedSource<EngineResult>> { return structuredClone(vectors[0]!.input) as Mutable<CollectedSource<EngineResult>>; }
export function intent(): Mutable<CollectionIntent> { return structuredClone(data.intent) as Mutable<CollectionIntent>; }
export function source(value = input()): Mutable<PrivateSource<EngineResult>> {
  const manifest = { version: 1 as const, binding: value.binding, result: value.collection.value,
    resultFileBytes: value.collection.custody.resultFileBytes, controlBytes: value.collection.custody.controlBytes,
    verifiedBytes: value.collection.verifiedBytes, manifestDigest: '' };
  return rehash({ version: 1, manifest, root: value.collection.custody.root,
    checkpoint: value.checkpoint, release: value.release, sourceDigest: '' });
}
export function rehash(value: Mutable<PrivateSource<EngineResult>>): Mutable<PrivateSource<EngineResult>> {
  const { manifestDigest: omittedManifest, ...publicCore } = value.manifest;
  const { sourceDigest: omittedSource, ...privateCore } = value;
  void omittedManifest; void omittedSource;
  value.manifest.manifestDigest = digest(OUTPUT_MANIFEST_PREFIX + encodeCanonicalJson(publicCore, 73_728));
  value.sourceDigest = digest(OUTPUT_SOURCE_PREFIX + encodeCanonicalJson(privateCore, 131_072));
  return value;
}
export function reseal(result: Mutable<EngineResult>): void {
  const { seal, ...body } = result;
  const sealed = sealEngineResult(body, seal.sealedAt, digest);
  if (!sealed.ok) throw new Error(`Fixture seal rejected: ${sealed.code}`);
  result.seal.sha256 = sealed.value.seal.sha256;
}
export function assertFrozen(value: unknown): boolean {
  return value === null || typeof value !== 'object'
    || Object.isFrozen(value) && Object.values(value).every(assertFrozen);
}
