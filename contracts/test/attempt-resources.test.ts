import { expect, it } from 'vitest';
import { validate } from '../src/index.js';
import { fixture } from './fixtures.js';
it('resource provenance distinguishes unavailable measurements from genuine zero', async () => {
  const original = await fixture('valid/agent-resource-summary.json') as {payload: Record<string, unknown>};
  const unknown = {...original, payload: {...original.payload, cpuMillis: null, peakMemoryBytes: null,
    peakPids: null, outputBytes: null, samples: 0, missedSamples: 1, lastSampleAt: null, reason: 'unavailable'}};
  expect(validate('AgentEvent', unknown).ok).toBe(true);
  expect(validate('AgentEvent', {...unknown, payload: {...unknown.payload, cpuMillis: 0}}).ok).toBe(false);
  expect(validate('AgentEvent', {...unknown, payload: {...unknown.payload, cpuMillis: 0, samples: 1,
    lastSampleAt: '2026-01-01T00:00:00Z'}}).ok).toBe(true);
  for (const field of ['source', 'lastSampleAt', 'samples', 'missedSamples', 'reason']) {
    const payload = {...unknown.payload} as Record<string, unknown>; delete payload[field];
    expect(validate('AgentEvent', {...unknown, payload}).ok).toBe(false);
  }
  expect(validate('AgentEvent', {...unknown, payload: {...unknown.payload, cpuMillis: -1}}).ok).toBe(false);
  expect(validate('AgentEvent', {...unknown, payload: {...unknown.payload, source: 'process-rss'}}).ok).toBe(false);
});
