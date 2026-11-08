import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import { zeroResources } from '../admission/index.js';
import type { RuntimeObservation } from '../admission/index.js';
import { PublisherError } from './publisher-types.js';
import type { PublisherOptions } from './publisher-types.js';

function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new PublisherError('invalid_input');
  return descriptor.value;
}
function method<T>(owner: unknown, key: string): T {
  if (!owner || typeof owner !== 'object') throw new PublisherError('invalid_input');
  let current: object | null = owner;
  for (let depth = 0; current && depth < 16; depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') throw new PublisherError('invalid_input');
      return descriptor.value.bind(owner) as T;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new PublisherError('invalid_input');
}
function duration(value: unknown, fallback: number, min: number, max: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < min || result > max) throw new PublisherError('invalid_input');
  return result;
}
function clock(value: unknown, fallback: () => number): () => number {
  if (value === undefined) return fallback;
  if (typeof value !== 'function') throw new PublisherError('invalid_input');
  return value as () => number;
}
export function capture(options: PublisherOptions) {
  const journal = field(options, 'journal') as PublisherOptions['journal'];
  const observer = field(options, 'observer');
  const output = field(options, 'output');
  const timeout = field(options, 'timeout');
  const interval = duration(field(options, 'intervalMs'), 250, 10, 5000);
  const deadline = duration(field(options, 'sampleTimeoutMs'), 1000, 10, 30_000);
  const ttl = duration(field(options, 'ttlMs'), 2000, 100, 300_000);
  if (ttl <= interval || ttl <= deadline) throw new PublisherError('invalid_input');
  return { journal, interval, deadline, ttl,
    admission: method<PublisherOptions['journal']['admission']>(journal, 'admission'),
    sample: method<PublisherOptions['observer']['sample']>(observer, 'sample'),
    output: method<PublisherOptions['output']['status']>(output, 'status'),
    timeout: method<PublisherOptions['timeout']['status']>(timeout, 'status'),
    wall: clock(field(options, 'wallNow'), Date.now), mono: clock(field(options, 'monotonicNow'), () => performance.now()) };
}
export type Captured = ReturnType<typeof capture>;
export function validWall(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}
export function unknownObservation(observedAt: number): RuntimeObservation {
  return { source: 'resource-guard-publisher', observedAt, status: 'unknown', capacity: zeroResources(),
    capacityProvenance: { cpuMillis: 'unavailable', memoryBytes: 'unavailable', pids: 'configured-policy',
      outputBytes: 'configured-policy', stagingBytes: 'configured-policy' }, diskSource: 'unavailable',
    daemonId: null, physicalPidCapacity: null, freeDiskBytes: 0, controls: [] };
}
export function snapshot(input: RuntimeObservation): RuntimeObservation {
  const value = JSON.parse(encodeJson(input, 16_384)) as RuntimeObservation;
  delete value.guards;
  if (!Array.isArray(value.controls)) throw new Error('invalid_sample');
  value.controls = value.controls.filter(control => control !== 'timeout' && control !== 'output');
  return value;
}
export function acknowledgement(input: unknown): boolean {
  if (!input || typeof input !== 'object') throw new Error('invalid_acknowledgement');
  const stored = Object.getOwnPropertyDescriptor(input, 'stored');
  if (!stored || !('value' in stored) || typeof stored.value !== 'boolean') throw new Error('invalid_acknowledgement');
  return stored.value;
}
