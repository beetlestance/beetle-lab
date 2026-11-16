import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import { addResources, MAX_RESOURCE_VALUE, resourceNames, validResources, zeroResources } from '../admission/index.js';
import type { Resources, RuntimeObservation } from '../admission/index.js';
import { daemonResources } from '../backends/docker/index.js';
import type { DockerReply, Operation } from '../backends/docker/index.js';
import { readRootSpace } from '../staging/index.js';
import { ObserverError } from './types.js';
import type { ObserverOptions, ResourceObserver } from './types.js';
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

function policy(input: ObserverOptions['configuration']): Resources {
  try {
    const value = JSON.parse(encodeJson(input, 4096)) as typeof input;
    const vectors = [value.pool, value.controlReserve, value.headroom];
    if (!vectors.every(vector => vector && validResources(vector))) throw new Error();
    const total = addResources(value.pool, addResources(value.controlReserve, value.headroom));
    if (resourceNames.some(name => total[name] > MAX_RESOURCE_VALUE)) throw new Error();
    return Object.freeze(total);
  } catch { throw new ObserverError('invalid_input'); }
}
function signalValue(input: Operation): AbortSignal | undefined {
  const signal = Object.getOwnPropertyDescriptor(input, 'signal');
  if (!signal) return undefined;
  if (!('value' in signal) || !(signal.value instanceof AbortSignal)) throw new Error();
  Reflect.apply(aborted, signal.value, []);
  return signal.value as AbortSignal;
}
function budget(input: Operation): Operation {
  try {
    const deadline = Object.getOwnPropertyDescriptor(input, 'deadline');
    if (!deadline || !('value' in deadline) || typeof deadline.value !== 'number' || !Number.isFinite(deadline.value)) throw new Error();
    const remaining = deadline.value - performance.now();
    if (remaining <= 0 || remaining > 30_000) throw new Error();
    const signal = signalValue(input);
    return { deadline: deadline.value, ...(signal ? { signal } : {}) };
  } catch { throw new ObserverError('invalid_input'); }
}
function wall(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error();
  return value;
}

class Observer implements ResourceObserver {
  private readonly configured: Resources;
  private active: { promise: Promise<RuntimeObservation>; abort: AbortController } | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private highWater = 0;
  constructor(private readonly options: ObserverOptions) { this.configured = policy(options.configuration); }

  sample(input: Operation): Promise<RuntimeObservation> {
    if (this.closed) return Promise.reject(new ObserverError('closed'));
    if (this.active) return Promise.reject(new ObserverError('busy'));
    let operation: Operation;
    try { operation = budget(input); } catch { return Promise.reject(new ObserverError('invalid_input')); }
    const abort = new AbortController();
    const promise = Promise.resolve().then(() => this.run(operation, abort)).finally(() => { this.active = undefined; });
    this.active = { promise, abort }; return promise;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const active = this.active;
    this.closing = Promise.resolve().then(async () => { await active?.promise; });
    active?.abort.abort(); return this.closing;
  }
  private unknown(observedAt: number): RuntimeObservation {
    return { source: 'docker-info+statfs', observedAt, status: 'unknown',
      capacity: { ...zeroResources(), pids: this.configured.pids, outputBytes: this.configured.outputBytes, stagingBytes: this.configured.stagingBytes },
      capacityProvenance: { cpuMillis: 'unavailable', memoryBytes: 'unavailable', pids: 'configured-policy', outputBytes: 'configured-policy', stagingBytes: 'configured-policy' },
      diskSource: 'unavailable', daemonId: null, physicalPidCapacity: null, freeDiskBytes: 0, controls: [] };
  }
  private async run(operation: Operation, abort: AbortController): Promise<RuntimeObservation> {
    const signal = operation.signal ? AbortSignal.any([operation.signal, abort.signal]) : abort.signal;
    const timer = setTimeout(() => abort.abort(), Math.max(0, operation.deadline - performance.now()));
    let observedAt = 0;
    const check = () => {
      if (this.closed || signal.aborted || performance.now() >= operation.deadline) throw new Error();
    };
    const request = async (path: string): Promise<DockerReply> => {
      check(); const reply = await this.options.transport.request({ method: 'GET', path, deadline: operation.deadline, signal });
      check(); return reply;
    };
    try {
      check(); observedAt = wall((this.options.wallNow ?? Date.now)());
      if (observedAt < this.highWater) throw new Error();
      this.highWater = observedAt;
      const space = await readRootSpace(this.options.root, { deadline: operation.deadline, signal });
      check(); if (!space.ok) throw new Error();
      const version = await request('/version'); const info = await request('/v1.47/info');
      const daemon = daemonResources(version, info, space.value.expectedDaemonId);
      if (!daemon.ok) throw new Error();
      const endedAt = wall((this.options.wallNow ?? Date.now)());
      if (endedAt < this.highWater) throw new Error();
      this.highWater = endedAt; check();
      return { ...this.unknown(observedAt), status: 'known', capacity: { ...this.configured,
        cpuMillis: daemon.value.cpuMillis, memoryBytes: daemon.value.memoryBytes },
        capacityProvenance: { cpuMillis: 'docker-info', memoryBytes: 'docker-info', pids: 'configured-policy', outputBytes: 'configured-policy', stagingBytes: 'configured-policy' },
        diskSource: 'statfs', daemonId: daemon.value.daemonId, freeDiskBytes: space.value.availableBytes,
        controls: ['cpu', 'memory', 'pids'] };
    } catch { return this.unknown(observedAt); }
    finally { clearTimeout(timer); }
  }
}

export function createResourceObserver(options: ObserverOptions): ResourceObserver { return new Observer(options); }
