import { afterEach, beforeEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { sealEngineResult } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { collectOutputs } from '../../src/collection/output/index.js';
import type { OutputCollection, OutputCollectionOptions } from '../../src/collection/output/index.js';
import { startCollection } from '../../src/collection/output/operation.js';
import { nodePorts } from '../../src/collection/output/ports.js';
import type { OutputPorts } from '../../src/collection/output/ports.js';

export function sha(bytes: string | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
export function seal(result: EngineResult): Readonly<EngineResult> {
  const body: Record<string, unknown> = { ...result }; delete body.seal;
  const sealed = sealEngineResult(body, result.seal.sealedAt, sha);
  if (!sealed.ok) throw new Error(`Invalid synthetic result ${sealed.code}`); return sealed.value;
}
interface Hooks {
  readonly chunk?: number; readonly open?: (path: string) => void | Promise<void>;
  readonly read?: (path: string) => void | Promise<void>;
  readonly readDone?: (path: string) => void | Promise<void>;
  readonly close?: (path: string) => void | Promise<void>;
  readonly closeDone?: (path: string) => void | Promise<void>;
}
export function tracking(hooks: Hooks = {}) {
  const opened: string[] = []; const closed: string[] = []; const reads: { path: string; requested: number; bytes: number }[] = [];
  const ports: OutputPorts = { ...nodePorts, open: async (...args) => {
    const path = String(args[0]); opened.push(path); await hooks.open?.(path); const handle = await nodePorts.open(...args);
    return new Proxy(handle, { get(target, property) {
      if (property === 'read') return async (...values: unknown[]) => {
        await hooks.read?.(path); values[2] = Math.min(Number(values[2]), hooks.chunk ?? 65_536);
        const result: { bytesRead: number } = await Reflect.apply(target.read, target, values);
        reads.push({ path, requested: Number(values[2]), bytes: result.bytesRead }); await hooks.readDone?.(path); return result;
      };
      if (property === 'close') return async () => {
        closed.push(path); await hooks.close?.(path); await target.close(); await hooks.closeDone?.(path);
      };
      const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  return { ports, opened, closed, reads };
}
export function fixture() {
  let directory = ''; let original: EngineResult; let counter = 0;
  const operations: OutputCollection[] = [];
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-collection-'))); await chmod(directory, 0o700);
    original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  });
  afterEach(async () => {
    await Promise.allSettled(operations.map(operation => operation.close()));
    await Promise.all(operations.splice(0).map(operation => operation.quiesced));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory: () => directory, path: (relative = 'engine-result.json') => join(directory, relative),
    result: (artifacts: EngineResult['artifacts'] = []): Readonly<EngineResult> => seal({ ...structuredClone(original), artifacts }),
    async write(result: Readonly<EngineResult> | string | Buffer): Promise<void> {
      const bytes = typeof result === 'object' && !Buffer.isBuffer(result) ? JSON.stringify(result) : result;
      await writeFile(join(directory, 'engine-result.json'), bytes, { mode: 0o600 });
    },
    async artifact(path: string, body: string | Buffer): Promise<EngineResult['artifacts'][number]> {
      const target = join(directory, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, body, { mode: 0o600 });
      return { artifactId: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, kind: 'report',
        relativePath: path, bytes: Buffer.byteLength(body), sha256: sha(body), sealedAt: '2026-01-01T00:00:00Z' };
    },
    options(result: Readonly<EngineResult>, overrides: Partial<OutputCollectionOptions> = {}): OutputCollectionOptions {
      const { organizationId, workspaceId, attemptId, generation } = result;
      return { directory, uid: process.getuid!(), key: { organizationId, workspaceId, attemptId, generation },
        engineId: result.engineId, reportedResult: result, controlBytes: 123, outputBytes: 20_000_000,
        deadline: performance.now() + 5000, ...overrides };
    },
    collect(options: OutputCollectionOptions, ports?: OutputPorts): OutputCollection {
      const operation = ports ? startCollection(options, ports) : collectOutputs(options); operations.push(operation); return operation;
    },
  };
}
