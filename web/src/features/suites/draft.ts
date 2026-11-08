import { encodeJson } from '@beetle/contracts';
import { SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';

export type Config = Record<string, unknown>;
export function parseDraft(text: string): Config {
  if (text.length > SUITE_MAXIMUM_CONFIG_BYTES || new TextEncoder().encode(text).byteLength > SUITE_MAXIMUM_CONFIG_BYTES) {
    throw new Error('Configuration exceeds 1 MiB UTF-8.');
  }
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { throw new Error('Enter valid JSON. Your text is preserved.'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object.');
  try { encodeJson(value, SUITE_MAXIMUM_CONFIG_BYTES); } catch { throw new Error('Configuration exceeds JSON byte, depth or collection limits.'); }
  return value as Config;
}
export function draftText(value: unknown) {
  return encodeJson(value, SUITE_MAXIMUM_CONFIG_BYTES);
}
export function updatePart(text: string, key: string, value: unknown): string {
  return draftText({ ...parseDraft(text), [key]: value });
}
export function starter(): string {
  return draftText({ version: 1, target: 'http://target.invalid',
    requests: [{ id: 'get', name: 'Get', method: 'GET', path: '/', query: {}, headers: {}, assertions: [] }],
    datasets: [], secrets: [], loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'Main',
      executor: 'per-vu-iterations', vus: 1, iterations: 1, startTime: '0s', gracefulStop: '0s', maxDuration: '1s' }], slos: [] },
    selections: [{ scenarioId: 'main', entries: [{ requestId: 'get', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }] });
}
