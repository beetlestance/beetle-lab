import { encodeCanonicalJson } from '@beetle/contracts';
import { captureLiveMetricSnapshot, liveMetricScopeMatches, liveMetricSubsetText, validateApi } from '@beetle/contracts/api';
import type { LiveMetricSnapshot, RunAttemptParams } from '@beetle/contracts/api';
import { responseBody } from '../../../lib/response-body.js';
export class LiveMetricStale extends Error {constructor() {super('Live metric source expired');}}
export interface LiveRead {readonly params: RunAttemptParams; readonly signal: AbortSignal}
export interface LiveFrame {readonly frame: LiveMetricSnapshot; readonly fingerprint: string;
  readonly receivedWall: number; readonly receivedMono: number; readonly expiresAtMono: number}
export interface LiveReadPorts {
  fetch: typeof globalThis.fetch; digest(bytes: Uint8Array): Promise<string>; wall(): number; monotonic(): number;
}
const native: LiveReadPorts = {fetch: (...args) => globalThis.fetch(...args), wall: Date.now, monotonic: () => performance.now(),
  async digest(bytes) {const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');}};
/** Shared two-original admission; abort never frees an ignored fetch/body/hash original. */
export class LiveMetricReads {
  private active = 0;
  private readonly ports: LiveReadPorts;
  constructor(ports: LiveReadPorts = native) {this.ports = {fetch: ports.fetch.bind(ports), digest: ports.digest.bind(ports),
    wall: ports.wall.bind(ports), monotonic: ports.monotonic.bind(ports)};}
  read(input: LiveRead): Promise<LiveFrame> {
    let params: RunAttemptParams;
    try {const checked = validateApi('RunAttemptParams', JSON.parse(encodeCanonicalJson(input.params, 4096)) as unknown);
      if (!checked.ok || !(input.signal instanceof AbortSignal)) throw new Error(); params = checked.value;
    } catch {return Promise.reject(new Error('Invalid live metric selection'));}
    if (input.signal.aborted || this.active >= 2) return Promise.reject(new Error('Live metric read unavailable'));
    this.active++;
    const original = Promise.resolve().then(() => this.original({params, signal: input.signal}));
    return original.finally(() => {this.active--;});
  }
  private async original(input: LiveRead): Promise<LiveFrame> {
    const controller = new AbortController(); const signal = AbortSignal.any([input.signal, controller.signal]);
    const start = this.sample(); const timer = setTimeout(() => controller.abort(), 5000);
    let response: Response | undefined; let bodyOwned = false;
    try {
      this.check(signal, start);
      response = await this.ports.fetch(path(input.params), {method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal});
      this.check(signal, start);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')) throw new Error('Live metric content type invalid');
      bodyOwned = true;
      const bytes = await responseBody(response, {maximum: 65536}, signal); this.check(signal, start);
      const result = await this.capture(bytes, input.params, signal, start);
      this.check(signal, start); return result;
    } finally {
      clearTimeout(timer); controller.abort();
      if (!bodyOwned && response?.body && !response.body.locked) await response.body.cancel();
    }
  }
  private async capture(bytes: Uint8Array, params: RunAttemptParams, signal: AbortSignal, start: {wall: number; mono: number}): Promise<LiveFrame> {
    const input: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    const checked = validateApi('LiveMetricSnapshot', input); if (!checked.ok) throw new Error('Live metric frame invalid');
    const subset = liveMetricSubsetText(checked.value.subset);
    const digest = await this.ports.digest(new TextEncoder().encode(subset)); this.check(signal, start);
    const frame = captureLiveMetricSnapshot(checked.value, text => {if (text !== subset) throw new Error('Subset changed'); return digest;});
    const fingerprint = await this.ports.digest(new TextEncoder().encode(encodeCanonicalJson(frame, 65536))); this.check(signal, start);
    const now = this.sample(); const age = Math.max(...[frame.capturedAtMs, frame.publishedAtMs, frame.endTimeMs].map(time => now.wall - time));
    if (!liveMetricScopeMatches(frame.scope, {...params, generation: 1})
      || [frame.capturedAtMs, frame.publishedAtMs, frame.endTimeMs].some(time => time > now.wall)) throw new Error('Live metrics mismatched');
    if (age > 6000) throw new LiveMetricStale();
    return {frame, fingerprint, receivedWall: now.wall, receivedMono: now.mono, expiresAtMono: now.mono + 6000 - age};
  }
  private sample() {
    const wall = this.ports.wall(); const mono = this.ports.monotonic();
    if (!Number.isSafeInteger(wall) || wall < 0 || wall > 8640000000000000 || !Number.isFinite(mono) || mono < 0) throw new Error('Live metric clock invalid');
    return {wall, mono};
  }
  private check(signal: AbortSignal, start: {wall: number; mono: number}): void {
    const now = this.sample();
    if (signal.aborted || now.wall < start.wall || now.mono < start.mono || now.mono - start.mono >= 5000) throw new Error('Live metric read retired or expired');
  }
}
function path(params: RunAttemptParams): string {
  return `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/metrics/live`;
}
export const liveMetricReads = new LiveMetricReads();
