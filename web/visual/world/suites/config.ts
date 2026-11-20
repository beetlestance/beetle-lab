// The checkout suite configuration: five HTTP requests, ramp / hold / drain load, thresholds, one dataset.
import type { Json } from '../../harness.js';
import { hex, inputIds } from './ids.js';

type Obj = Record<string, Json>;
export interface ConfigOptions {
  /** Peak requests a second the ramp reaches and holds. */
  peak?: number;
  maxVUs?: number;
  preAllocatedVUs?: number;
  p99?: boolean;
  /** Names of secrets the revision references (blocks script export). */
  secrets?: string[];
  /** Replaces the dataset's input file reference, e.g. to point at a deleted input. */
  datasetInput?: string;
}

const input = (id: string, bytes: number) => ({ id, sha256: hex('b'), bytes });
const check = (id: string, kind: string, extra: Obj, required = true): Obj => ({ id, required, kind, ...extra });
const wait = { durationMs: 0, jitterMs: 200 };

function request(id: string, method: string, path: string, assertions: Obj[], extra: Obj = {}): Obj {
  return { id, name: `${method} ${path}`, method, path, query: {}, headers: {}, assertions, ...extra };
}

export const requests: Obj[] = [
  request(
    'add-to-cart',
    'POST',
    '/cart/items',
    [check('created', 'statusEq', { value: 201 }), check('cart', 'jsonExists', { path: '$.cartId' })],
    { body: { kind: 'input', input: input(inputIds.cart, 1200), format: 'json' } },
  ),
  request('search', 'GET', '/catalog/search', [check('ok', 'statusFamily', { value: 2 })]),
  request('product', 'GET', '/product/{id}', [
    check('ok', 'statusEq', { value: 200 }),
    check('etag', 'headerExists', { name: 'etag' }),
  ]),
  request(
    'checkout',
    'POST',
    '/checkout',
    [
      check('ok', 'statusEq', { value: 200 }),
      check('confirmed', 'jsonEquals', { path: '$.status', value: 'confirmed' }),
    ],
    {
      body: { kind: 'input', input: input(inputIds.checkout, 2800), format: 'json' },
      query: { currency: '{{data.users.currency}}' },
      headers: { 'content-type': 'application/json' },
    },
  ),
  request('health', 'GET', '/health', [check('ok', 'statusEq', { value: 200 })]),
];
const weights = [34, 28, 22, 11, 5];

/** A full k6 suite configuration; options change what the Revisions list reports as differences. */
export function config(options: ConfigOptions = {}): Obj {
  const peak = options.peak ?? 1200;
  const slos: Obj[] = [
    { id: 'p95', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 250 },
    { id: 'errors', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 },
    { id: 'checks', metric: 'checks', stat: 'rate', operator: '>', value: 0.99 },
    ...(options.p99 === false
      ? []
      : [{ id: 'p99', metric: 'http_req_duration', stat: 'p99', operator: '<', value: 300 }]),
  ];
  return {
    version: 1,
    target: 'http://checkout-api:8080',
    requests,
    datasets: [
      { id: 'users', selection: 'byVu', kind: 'csv', input: input(options.datasetInput ?? inputIds.users, 2_100_000) },
    ],
    secrets: (options.secrets ?? []).map((name) => ({ name, provider: 'env', locator: name.toUpperCase() })),
    loadPlan: {
      version: 1,
      scenarios: [
        {
          id: 'steady',
          name: 'steady',
          executor: 'ramping-arrival-rate',
          startTime: '0s',
          gracefulStop: '30s',
          startRate: 10,
          timeUnit: '1s',
          stages: [
            { duration: '60s', target: peak },
            { duration: '480s', target: peak },
            { duration: '60s', target: 10 },
          ],
          preAllocatedVUs: options.preAllocatedVUs ?? 120,
          maxVUs: options.maxVUs ?? 240,
        },
      ],
      slos,
    },
    selections: [
      {
        scenarioId: 'steady',
        entries: requests.map((item, index) => ({ requestId: item.id as string, weight: weights[index]!, wait })),
      },
    ],
    readiness: {
      path: '/health',
      attempts: 10,
      intervalMs: 2000,
      timeoutMs: 1000,
      wallBudgetMs: 30000,
      expectedStatus: 200,
      assertions: [],
    },
  };
}

/** A smaller configuration for the other suites of the folder listing. */
export function simpleConfig(shape: 'constant' | 'ramping', minutes: number, requestCount: number): Obj {
  const base = config();
  const plan = base.loadPlan as Obj;
  const scenario =
    shape === 'ramping'
      ? {
          ...((plan.scenarios as Obj[])[0] as Obj),
          stages: [
            { duration: '60s', target: 600 },
            { duration: `${Math.max(1, minutes - 2) * 60}s`, target: 600 },
            { duration: '60s', target: 10 },
          ],
        }
      : {
          id: 'steady',
          name: 'steady',
          executor: 'constant-arrival-rate',
          startTime: '0s',
          gracefulStop: '30s',
          rate: 800,
          timeUnit: '1s',
          duration: `${minutes}m`,
          preAllocatedVUs: 100,
          maxVUs: 200,
        };
  const used = requests.slice(0, requestCount);
  return {
    ...base,
    requests: used,
    loadPlan: { ...plan, scenarios: [scenario] },
    selections: [
      { scenarioId: 'steady', entries: used.map((item) => ({ requestId: item.id as string, weight: 10, wait })) },
    ],
  };
}
