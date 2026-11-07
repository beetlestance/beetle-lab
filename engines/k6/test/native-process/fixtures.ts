import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, vi } from 'vitest';
import { ProcessActor } from '../../wrapper/process/actor.js';
import type { OwnedChild, ProcessPorts } from '../../wrapper/process/ports.js';
import type { NativeProcessOptions } from '../../wrapper/process/index.js';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export function options(extra: Partial<NativeProcessOptions> = {}): NativeProcessOptions {
  return { binary: '/owned/k6', emptyConfig: '/owned/empty.json', directory: '/owned/output',
    script: '/owned/output/suite.js', attempt: { mode: 'managed', timeoutMs: 20_000, deadlineMs: Date.now() + 20_000 },
    maxMetricStreamBytes: 1_048_576, maxDiagnosticBytes: 65_536, drainTimeoutMs: 100,
    sink: async () => {}, ...extra };
}
export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough({ highWaterMark: 65_536 });
  readonly stderr = new PassThrough({ highWaterMark: 65_536 });
  pid: number | undefined = 4567;
  start(): void { this.emit('spawn'); }
  end(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
  finish(): void { this.emit('close'); }
  port(): OwnedChild { return this as unknown as OwnedChild; }
}
export function harness(extra: Partial<NativeProcessOptions> = {}, overrides: Partial<ProcessPorts> = {}) {
  const child = new FakeChild();
  let present = true;
  const signals: (NodeJS.Signals | 0)[] = [];
  const group = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
    signals.push(signal); return present ? 'present' as const : 'absent' as const;
  });
  const spawn = vi.fn(() => child.port());
  const ports = { spawn, group, validate: async () => {}, ...overrides };
  const actor = new ProcessActor(options(extra), ports);
  return { actor, child, spawn, group, signals, absent() { present = false; } };
}
export async function flush(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); });
