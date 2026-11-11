import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { RunArtifactParams } from '@beetle/contracts/api';
import { decodeTargetRuntimeReport, TARGET_RUNTIME_REPORT_BYTES } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { targetBody } from './body.js';
export interface TargetRead {
  readonly params: RunArtifactParams; readonly artifact: Artifact; readonly signal: AbortSignal;
}
export interface TargetReadPorts {
  readonly fetch: typeof globalThis.fetch;
  digest(bytes: Uint8Array): Promise<string>;
  monotonic(): number;
}
const native: TargetReadPorts = {fetch: (...args) => globalThis.fetch(...args), monotonic: () => performance.now(),
  async digest(bytes) {
    const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }};
/** Shared two-original admission, no queue/retries/cache; caller retires its own result. */
export class TargetReportReads {
  private active = 0;
  private readonly ports: TargetReadPorts;
  constructor(ports: TargetReadPorts = native) {
    this.ports = {fetch: ports.fetch.bind(ports), digest: ports.digest.bind(ports), monotonic: ports.monotonic.bind(ports)};
  }
  read(input: TargetRead): Promise<TargetRuntimeReport> {
    let selection;
    try {selection = capture(input);} catch {return Promise.reject(new Error('Invalid target report selection'));}
    if (input.signal.aborted) return Promise.reject(new Error('Target report retired'));
    if (this.active >= 2) return Promise.reject(new Error('Target report read capacity unavailable'));
    this.active++;
    const original = Promise.resolve().then(() => this.original(selection));
    return original.finally(() => {this.active--;});
  }
  private async original(input: ReturnType<typeof capture>): Promise<TargetRuntimeReport> {
    const controller = new AbortController(); const signal = AbortSignal.any([input.signal, controller.signal]);
    const start = this.ports.monotonic(); const timer = setTimeout(() => controller.abort(), 5000);
    let response: Response | undefined; let bodyOwned = false;
    try {
      this.check(signal, start);
      response = await this.ports.fetch(input.path, {method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal});
      this.check(signal, start);
      bodyOwned = true;
      const bytes = await targetBody(response, input.artifact.bytes, signal);
      this.check(signal, start); const digest = await this.ports.digest(bytes); this.check(signal, start);
      if (digest !== input.artifact.sha256) throw new Error('Target report integrity mismatch');
      const report = decodeTargetRuntimeReport(bytes); this.check(signal, start); return report;
    } finally {
      clearTimeout(timer); controller.abort();
      if (!bodyOwned && response?.body && !response.body.locked) await response.body.cancel();
    }
  }
  private check(signal: AbortSignal, start: number): void {
    const now = this.ports.monotonic();
    if (signal.aborted || !Number.isFinite(start) || !Number.isFinite(now) || now < start || now - start >= 5000) throw new Error('Target report retired or expired');
  }
}
function capture(input: TargetRead) {
  if (!(input.signal instanceof AbortSignal)) throw new Error('Invalid target report signal');
  const artifact: unknown = JSON.parse(encodeJson(input.artifact, 4096)); const checked = validatePrimitive('artifact', artifact);
  if (!checked.ok || checked.value.kind !== 'target-runtime' || checked.value.bytes < 1 || checked.value.bytes > TARGET_RUNTIME_REPORT_BYTES
    || checked.value.artifactId.toLowerCase() !== input.params.artifactId.toLowerCase()) throw new Error('Invalid target report metadata');
  return {path: runArtifactContentPath(input.params), artifact: checked.value, signal: input.signal};
}
export const targetReportReads = new TargetReportReads();
