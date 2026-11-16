import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { RunArtifactParams } from '@beetle/contracts/api';
import { responseBody } from './response-body.js';
export interface ArtifactRead {
  readonly params: RunArtifactParams; readonly artifact: Artifact; readonly signal: AbortSignal;
}
export interface ArtifactReadPorts {
  readonly fetch: typeof globalThis.fetch;
  digest(bytes: Uint8Array): Promise<string>;
  monotonic(): number;
}
export interface ArtifactReadPolicy<T> {readonly kind: string; readonly maximumBytes: number; decode(bytes: Uint8Array): T}
const native: ArtifactReadPorts = {fetch: (...args) => globalThis.fetch(...args), monotonic: () => performance.now(),
  async digest(bytes) {
    const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }};
let activeOriginals = 0;
/** Shared two-original admission, no queue/retries/cache; caller retires its own result. */
export class VerifiedArtifactReads<T> {
  private readonly ports: ArtifactReadPorts;
  private readonly policy: ArtifactReadPolicy<T>;
  constructor(policy: ArtifactReadPolicy<T>, ports: ArtifactReadPorts = native) {
    if (!Number.isSafeInteger(policy.maximumBytes) || policy.maximumBytes < 1 || policy.maximumBytes > 1048576
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(policy.kind) || typeof policy.decode !== 'function') throw new Error('Invalid artifact policy');
    this.policy = {kind: policy.kind, maximumBytes: policy.maximumBytes, decode: policy.decode};
    this.ports = {fetch: ports.fetch.bind(ports), digest: ports.digest.bind(ports), monotonic: ports.monotonic.bind(ports)};
  }
  read(input: ArtifactRead): Promise<T> {
    let selection;
    try {selection = capture(input, this.policy);} catch {return Promise.reject(new Error('Invalid artifact selection'));}
    if (selection.signal.aborted) return Promise.reject(new Error('Artifact retired'));
    if (activeOriginals >= 2) return Promise.reject(new Error('Artifact read capacity unavailable'));
    activeOriginals++;
    const original = Promise.resolve().then(() => this.original(selection));
    return original.finally(() => {activeOriginals--;});
  }
  private async original(input: ReturnType<typeof capture>): Promise<T> {
    const controller = new AbortController(); const signal = AbortSignal.any([input.signal, controller.signal]);
    const start = this.ports.monotonic(); const timer = setTimeout(() => controller.abort(), 5000);
    let response: Response | undefined; let bodyOwned = false;
    try {
      this.check(signal, start);
      response = await this.ports.fetch(input.path, {method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal});
      this.check(signal, start);
      bodyOwned = true;
      const bytes = await responseBody(response, {maximum: this.policy.maximumBytes, expected: input.artifact.bytes}, signal);
      this.check(signal, start); const digest = await this.ports.digest(bytes); this.check(signal, start);
      if (digest !== input.artifact.sha256) throw new Error('Artifact integrity mismatch');
      const report = this.policy.decode(bytes); this.check(signal, start); return report;
    } finally {
      clearTimeout(timer); controller.abort();
      if (!bodyOwned && response?.body && !response.body.locked) await response.body.cancel();
    }
  }
  private check(signal: AbortSignal, start: number): void {
    const now = this.ports.monotonic();
    if (signal.aborted || !Number.isFinite(start) || !Number.isFinite(now) || now < start || now - start >= 5000) throw new Error('Artifact retired or expired');
  }
}
function capture(input: ArtifactRead, policy: Pick<ArtifactReadPolicy<unknown>, 'kind' | 'maximumBytes'>) {
  if (!(input.signal instanceof AbortSignal)) throw new Error('Invalid artifact signal');
  const artifact: unknown = JSON.parse(encodeJson(input.artifact, 4096)); const checked = validatePrimitive('artifact', artifact);
  if (!checked.ok || checked.value.kind !== policy.kind || checked.value.bytes < 1 || checked.value.bytes > policy.maximumBytes
    || checked.value.artifactId.toLowerCase() !== input.params.artifactId.toLowerCase()) throw new Error('Invalid artifact metadata');
  return {path: runArtifactContentPath(input.params), artifact: checked.value, signal: input.signal};
}
