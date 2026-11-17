import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { SuiteConfig } from '../../../../engines/k6/compiler/suite/index.js';
export function configuration(): SuiteConfig {
  const config: SuiteConfig = {
    version: 1,
    target: 'http://target:8080',
    secrets: [],
    datasets: [],
    loadPlan: {
      version: 1,
      scenarios: [
        {
          id: 'main',
          name: 'main',
          executor: 'per-vu-iterations',
          vus: 1,
          iterations: 40,
          maxDuration: '12s',
          startTime: '0s',
          gracefulStop: '0s',
        },
      ],
      slos: [],
    },
    requests: [
      {
        id: 'work',
        name: 'work',
        method: 'GET',
        path: '/work',
        query: {},
        headers: {},
        assertions: [{ id: 'ok', kind: 'statusEq', value: 200, required: true }],
      },
    ],
    selections: [
      {
        scenarioId: 'main',
        entries: [{ requestId: 'work', weight: 1, maxIterationsPerVu: 40, wait: { durationMs: 100, jitterMs: 0 } }],
      },
    ],
    readiness: {
      path: '/ready',
      attempts: 1,
      intervalMs: 0,
      timeoutMs: 1000,
      wallBudgetMs: 1000,
      expectedStatus: 200,
      assertions: [],
    },
    targetSampling: { path: '/runtime', intervalMs: 1000, timeoutMs: 500, cooldownMs: 3000 },
  };
  assert(createK6ConfigSchema((value) => createHash('sha256').update(value).digest('hex')).validate(config));
  return config;
}
export const sourceValues = {
  heapAlloc: 0,
  rss: 123456,
  external: -1,
  arrayBuffers: '123',
  cppHeap: { allocated_size: 42, used_size: 0 },
  eventLoopDelay: { mean: 0, p90: 2, p99: 3, max: 4 },
  gc: { count: 7, duration: 12.5 },
  private: 'TARGET_PRIVATE_MARKER',
  temperature: 999,
};
