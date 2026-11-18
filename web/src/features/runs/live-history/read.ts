import { encodeCanonicalJson, jsonNodeCount } from '@beetle/contracts';
import {
  LIVE_HISTORY_BYTES,
  captureLiveMetricHistory,
  liveMetricScopeMatches,
  liveMetricSubsetText,
  validateApi,
} from '@beetle/contracts/api';
import type { LiveMetricHistory, RunAttemptParams } from '@beetle/contracts/api';
import { responseBody } from '../../../lib/response-body.js';
interface Input {
  readonly params: RunAttemptParams;
  readonly signal: AbortSignal;
}
export interface HistoryReadPorts {
  fetch: typeof globalThis.fetch;
  digest(bytes: Uint8Array): Promise<string>;
  monotonic(): number;
}
const native: HistoryReadPorts = {
  fetch: (...args) => globalThis.fetch(...args),
  monotonic: () => performance.now(),
  async digest(bytes) {
    const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
};
function capture(input: Input): Input {
  const params = Object.getOwnPropertyDescriptor(input, 'params');
  const signal = Object.getOwnPropertyDescriptor(input, 'signal');
  if (!params || !('value' in params) || !signal || !('value' in signal) || !(signal.value instanceof AbortSignal))
    throw Error('Invalid history selection');
  const value: unknown = JSON.parse(encodeCanonicalJson(params.value, 4096));
  const checked = validateApi('RunAttemptParams', value);
  if (!checked.ok) throw Error('Invalid history selection');
  return { params: checked.value, signal: signal.value };
}
/** One actual fetch/body/hash original across history views; abort never releases it early. */
export class HistoryReads {
  private active = 0;
  private readonly ports: HistoryReadPorts;
  constructor(ports: HistoryReadPorts = native) {
    this.ports = {
      fetch: ports.fetch.bind(ports),
      digest: ports.digest.bind(ports),
      monotonic: ports.monotonic.bind(ports),
    };
  }
  read(input: Input): Promise<LiveMetricHistory> {
    if (this.active >= 1) return Promise.reject(Error('Recorded history unavailable'));
    this.active++;
    let selection: Input;
    try {
      selection = capture(input);
    } catch (error) {
      this.active--;
      return Promise.reject(error);
    }
    return Promise.resolve()
      .then(() => this.original(selection))
      .finally(() => {
        this.active--;
      });
  }
  private check(signal: AbortSignal, start: number): void {
    const now = this.ports.monotonic();
    if (signal.aborted || !Number.isFinite(now) || now < start || now - start >= 30000)
      throw Error('Recorded history unavailable');
  }
  private async original(input: Input): Promise<LiveMetricHistory> {
    const controller = new AbortController();
    const signal = AbortSignal.any([input.signal, controller.signal]);
    const start = this.ports.monotonic();
    if (!Number.isFinite(start) || start < 0) throw Error('Recorded history unavailable');
    const timer = setTimeout(() => controller.abort(), 30000);
    let response: Response | undefined;
    let bodyOwned = false;
    try {
      this.check(signal, start);
      response = await this.ports.fetch(path(input.params), {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal,
      });
      this.check(signal, start);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? ''))
        throw Error('Recorded history unavailable');
      bodyOwned = true;
      const bytes = await responseBody(response, { maximum: LIVE_HISTORY_BYTES, profile: 'api-history' }, signal);
      this.check(signal, start);
      return await this.decode(bytes, input.params, signal, start);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (!bodyOwned && response?.body && !response.body.locked) await response.body.cancel();
    }
  }
  private async decode(
    bytes: Uint8Array,
    params: RunAttemptParams,
    signal: AbortSignal,
    start: number,
  ): Promise<LiveMetricHistory> {
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    jsonNodeCount(input);
    const checked = validateApi('LiveMetricHistory', input);
    if (!checked.ok) throw Error('Recorded history unavailable');
    const subset = liveMetricSubsetText(checked.value.subset);
    const digest = await this.ports.digest(new TextEncoder().encode(subset));
    this.check(signal, start);
    const value = captureLiveMetricHistory(checked.value, (text) => {
      if (text !== subset) throw Error();
      return digest;
    });
    if (!liveMetricScopeMatches(value.scope, { ...params, generation: 1 })) throw Error('Recorded history unavailable');
    this.check(signal, start);
    return value;
  }
}
function path(params: RunAttemptParams): string {
  return `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/metrics/live-history`;
}
export const historyReads = new HistoryReads();
