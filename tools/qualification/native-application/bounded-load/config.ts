import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { SuiteConfig } from '../../../../engines/k6/compiler/suite/index.js';
export function configuration(): SuiteConfig {
  const config: SuiteConfig = {
    version: 1,
    target: 'http://target:8080',
    secrets: [],
    datasets: [{ id: 'cardinality', kind: 'range', selection: 'random', column: 'key', start: 1, end: 10000, step: 1 }],
    requests: [
      {
        id: 'get',
        name: 'Bounded dynamic URL',
        method: 'GET',
        path: '/work',
        query: { key: '{{data.cardinality.key}}' },
        headers: {},
        assertions: [{ id: 'ok', kind: 'statusEq', value: 200, required: true }],
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
    loadPlan: {
      version: 1,
      scenarios: [
        {
          id: 'main',
          name: 'Bounded_cardinality',
          executor: 'per-vu-iterations',
          vus: 4,
          iterations: 100,
          maxDuration: '30s',
          startTime: '0s',
          gracefulStop: '0s',
        },
      ],
      slos: [],
    },
    selections: [
      { scenarioId: 'main', entries: [{ requestId: 'get', weight: 1, wait: { durationMs: 150, jitterMs: 0 } }] },
    ],
  };
  assert(createK6ConfigSchema((value) => createHash('sha256').update(value).digest('hex')).validate(config));
  return config;
}
