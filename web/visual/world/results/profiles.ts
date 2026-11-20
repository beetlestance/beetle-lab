// Workload profiles behind the Run result boards: catalog-crawl (64 endpoints, the passed run)
// and steady-1.2k (5 endpoints, the failed, stopped and incomplete runs).
import { createHash } from 'node:crypto';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Deterministic noise so every run of the suite draws the same charts. */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Endpoint {
  readonly method: string;
  readonly path: string;
  readonly name: string;
  /** Relative share of all requests. */
  readonly weight: number;
  readonly p50: number;
  readonly p95: number;
  readonly failed: number;
}
export interface Slo {
  readonly id: string;
  readonly metric: string;
  readonly stat: string;
  readonly operator: '<' | '>';
  readonly value: number;
  /** What the engine read at the end of a full run. */
  readonly reading: number;
}
export interface Profile {
  readonly key: 'catalog' | 'steady';
  readonly suiteName: string;
  readonly suiteId: string;
  readonly ordinal: number;
  readonly digest: string;
  readonly savedAt: string;
  readonly message: string;
  readonly target: string;
  readonly durationMs: number;
  readonly rampMs: number;
  readonly rps: number;
  readonly peak: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly failRatio: number;
  readonly checkRatio: number;
  readonly vusBusy: number;
  readonly vusMax: number;
  readonly slos: readonly Slo[];
  readonly endpoints: readonly Endpoint[];
}

const head: [string, string, number, number, number][] = [
  ['GET', '/content/{id}/summary', 79, 329, 0.0011],
  ['GET', '/pricing/{id}', 78, 326, 0.0007],
  ['GET', '/offers', 78, 323, 0.0012],
  ['GET', '/reviews/filters', 77, 320, 0.0008],
  ['GET', '/product/{id}/related', 76, 317, 0.0004],
  ['GET', '/recommend/{id}/summary', 76, 317, 0.0007],
  ['GET', '/returns/{id}', 75, 314, 0.0012],
  ['GET', '/content', 75, 311, 0.0008],
  ['GET', '/media/filters', 74, 308, 0.0004],
  ['GET', '/account/{id}/related', 73, 306, 0.0009],
  ['GET', '/reviews/recent', 73, 303, 0.0005],
  ['GET', '/product/popular', 72, 300, 0.0011],
];
const areas = ['catalog', 'search', 'cart', 'wishlist', 'promo', 'stock', 'shipping', 'tax', 'brand', 'category'];
const kinds = ['/{id}', '/{id}/images', '/featured', '/{id}/variants', '/new', '/{id}/specs'];

function catalogEndpoints(): Endpoint[] {
  const next = rng(11);
  const rows: [string, string, number, number, number][] = [...head];
  for (let i = 0; rows.length < 64; i++) {
    const path = `/${areas[i % areas.length]}${kinds[Math.floor(i / areas.length) % kinds.length]}`;
    const step = rows.length - head.length;
    rows.push(['GET', path, 72 - step * 0.45, 298 - step * 2.1 - next() * 3, 0.0003 + next() * 0.0009]);
  }
  return rows.map(([method, path, p50, p95, failed]) => ({
    method,
    path,
    name: `${method} ${path}`,
    weight: 0.5 + next() * 1.6,
    p50: Math.round(p50),
    p95: Math.round(p95),
    failed,
  }));
}

const gate = (
  id: string,
  metric: string,
  stat: string,
  limit: [operator: '<' | '>', value: number],
  reading: number,
): Slo => ({ id, metric, stat, operator: limit[0], value: limit[1], reading });

export const catalog: Profile = {
  key: 'catalog',
  suiteName: 'catalog-crawl',
  suiteId: '5c1a0000-0000-4000-8000-0000000000a1',
  ordinal: 2,
  digest: '7b21e04d'.padEnd(64, '3'),
  savedAt: '2026-11-02T10:12:00.000Z',
  message: 'crawl all 64 catalog endpoints',
  target: 'http://checkout-api:8080',
  durationMs: 960_000,
  rampMs: 120_000,
  rps: 900,
  peak: 1040,
  p50: 75,
  p95: 312,
  p99: 488,
  failRatio: 0.0008,
  checkRatio: 0.9994,
  vusBusy: 146,
  vusMax: 300,
  slos: [
    gate('p95', 'http_req_duration', 'p95', ['<', 400], 312),
    gate('failed', 'http_req_failed', 'rate', ['<', 0.01], 0.0008),
    gate('checks', 'checks', 'rate', ['>', 0.99], 0.9994),
  ],
  endpoints: catalogEndpoints(),
};

const steadyRows: [string, string, number, number, number, number, number][] = [
  ['POST', '/checkout', 0.11, 98, 408, 0.0021, 1],
  ['POST', '/cart/items', 0.34, 43, 172, 0.0003, 1],
  ['GET', '/cart', 0.25, 31, 120, 0.0004, 1],
  ['GET', '/products/{id}', 0.2, 28, 96, 0.0002, 1],
  ['GET', '/health', 0.1, 6, 21, 0, 1],
];
export const steady: Profile = {
  key: 'steady',
  suiteName: 'steady-1.2k',
  suiteId: '5c1a0000-0000-4000-8000-0000000000a2',
  ordinal: 4,
  digest: '3fa8c2d1'.padEnd(64, '5'),
  savedAt: '2026-11-04T09:30:00.000Z',
  message: 'added a p99 limit',
  target: 'http://checkout-api:8080',
  durationMs: 600_000,
  rampMs: 60_000,
  rps: 1187,
  peak: 1240,
  p50: 48,
  p95: 197,
  p99: 322,
  failRatio: 0.0006,
  checkRatio: 0.9992,
  vusBusy: 96,
  vusMax: 240,
  slos: [
    gate('p95', 'http_req_duration', 'p95', ['<', 250], 197),
    gate('failed', 'http_req_failed', 'rate', ['<', 0.01], 0.0006),
    gate('checks', 'checks', 'rate', ['>', 0.99], 0.9992),
    gate('p99', 'http_req_duration', 'p99', ['<', 300], 322),
  ],
  endpoints: steadyRows.map(([method, path, weight, p50, p95, failed]) => ({
    method,
    path,
    name: `${method} ${path}`,
    weight,
    p50,
    p95,
    failed,
  })),
};

/** The earlier steady-1.2k run the failed one is compared against (board run b089). */
export const steadyBase: Profile = {
  ...steady,
  rps: 1180,
  peak: 1198,
  p50: 46,
  p95: 188,
  p99: 288,
  failRatio: 0.0004,
  checkRatio: 0.9995,
  vusBusy: 141,
  slos: [
    gate('p95', 'http_req_duration', 'p95', ['<', 250], 188),
    gate('failed', 'http_req_failed', 'rate', ['<', 0.01], 0.0004),
    gate('checks', 'checks', 'rate', ['>', 0.99], 0.9995),
    gate('p99', 'http_req_duration', 'p99', ['<', 300], 288),
  ],
};
