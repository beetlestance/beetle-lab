import type { Artifact } from '@beetle/contracts';
import type { OutputArtifactState } from '../../../../ports/output-custody.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { closed, natural } from './values.js';
export interface Slot {
  v: number; t: string; o: number; p: OutputArtifactState['phase']; i: string | null; w: string | null;
}
export function digest(input: unknown): input is string { return typeof input === 'string' && /^[a-f0-9]{64}$/.test(input); }
export function writer(input: unknown): void {
  requireRule(typeof input === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input));
}
export function decodeSlot(input: unknown, bytes: number): Slot {
  const slot = input as Slot; closed(slot, ['v', 't', 'o', 'p', 'i', 'w']);
  natural(slot.v); requireRule(slot.v > 0); natural(slot.o); requireRule(slot.o <= bytes); writer(slot.t);
  requireRule(['transferring', 'publishing', 'published'].includes(slot.p));
  if (slot.i !== null) requireRule(digest(slot.i));
  if (slot.w !== null) writer(slot.w);
  requireRule(slot.i !== null || slot.o === 0);
  if (slot.p !== 'transferring') requireRule(slot.i !== null && slot.o === bytes);
  if (slot.p === 'publishing') requireRule(slot.w !== null);
  if (slot.p === 'published') requireRule(slot.w === null);
  return slot;
}
export function artifactSlot(value: OutputArtifactState): Slot {
  return decodeSlot({v: value.version, t: value.token, o: value.offset, p: value.phase, i: value.identity, w: value.writer}, value.bytes);
}
export function decodeArtifact(input: unknown): OutputArtifactState {
  const value = input as OutputArtifactState;
  closed(value, ['ordinal', 'artifactId', 'token', 'bytes', 'sha256', 'offset', 'phase', 'identity', 'writer', 'version']);
  natural(value.ordinal); requireRule(value.ordinal <= 127);
  requireRule(typeof value.artifactId === 'string' && Buffer.byteLength(value.artifactId) <= 128);
  natural(value.bytes); requireRule(digest(value.sha256)); artifactSlot(value); return value;
}
export function deriveArtifact(ordinal: number, artifact: Artifact, slot: Slot): OutputArtifactState {
  return {ordinal, artifactId: artifact.artifactId, bytes: artifact.bytes, sha256: artifact.sha256,
    token: slot.t, offset: slot.o, phase: slot.p, identity: slot.i, writer: slot.w, version: slot.v};
}
