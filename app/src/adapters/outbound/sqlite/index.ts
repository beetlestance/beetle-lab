import type { SuiteStore, SuiteReader } from '../../../ports/suites.js';
import { Worker } from 'node:worker_threads';
import type { SettingsScope } from '@beetle/contracts/api';
import type { NamespaceStore } from '../../../ports/namespaces.js';
import type { NamespaceEntity } from '../../../ports/namespaces.js';
import type { SettingsStore } from '../../../ports/settings.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import { checkedBootstrap, checkedOperation, suiteOperation } from './input.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, EntityKey, EntityPage, ErrorCode, ListQuery, Operation, Reply, RuntimeObservation, SettingsView, Value } from './protocol.js';
export { StorageError } from './protocol.js';
export type { Bootstrap, EntityKey, EntityPage, ErrorCode, ListQuery, RuntimeObservation, SettingsView } from './protocol.js';

export interface MetadataOptions extends Bootstrap {
  path: string;
  /** Explicit compiled worker entrypoint supplied by the composition root. */
  workerUrl: URL;
  /** Includes in-flight work; maximum 64. Close has one reserved slot. */
  queueLimit?: number;
}
interface Pending { resolve(value: Value): void; reject(error: StorageError): void; timer: NodeJS.Timeout; suite: boolean }
function validateLocation(options: MetadataOptions): void {
  if (typeof options.path !== 'string' || !options.path || options.path === ':memory:' || options.path.length > 4096 ||
    !(options.workerUrl instanceof URL) || options.workerUrl.protocol !== 'file:') throw new StorageError('invalid_input');
}
function validateOptions(options: MetadataOptions): Bootstrap {
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new StorageError('invalid_input');
  validateLocation(options);
  try { return checkedBootstrap({ installation: options.installation, runtime: options.runtime,
    runtimeTtlMs: options.runtimeTtlMs ?? 5000 }); }
  catch { throw new StorageError('invalid_input'); }
}

export class Metadata {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly limit: number;
  private readonly runtimeTtlMs: number;
  private nextId = 0;
  private closing = false;
  private failed = false;
  private closePromise: Promise<void> | undefined;
  private terminationPromise: Promise<number> | undefined;
  private readyResolve: () => void = () => undefined;
  private readyReject: (error: StorageError) => void = () => undefined;
  private readonly ready: Promise<void>;
  readonly suites: SuiteStore & SuiteReader = {
    execute: command => this.call({ kind: 'suite', command }) as ReturnType<SuiteStore['execute']>,
    getSuite: key => this.call({ kind: 'getSuite', key }) as ReturnType<SuiteReader['getSuite']>,
    getRevision: key => this.call({ kind: 'getRevision', key }) as ReturnType<SuiteReader['getRevision']>,
    listSuites: query => this.call({ kind: 'listSuites', query }) as ReturnType<SuiteReader['listSuites']>,
    listRevisions: query => this.call({ kind: 'listRevisions', query }) as ReturnType<SuiteReader['listRevisions']>,
  };
  readonly namespaces: NamespaceStore = { execute: command => this.call({ kind: 'namespace', command }) as
    ReturnType<NamespaceStore['execute']> };
  readonly settings: SettingsStore = { execute: command => this.call({ kind: 'settings', command }) as
    ReturnType<SettingsStore['execute']> };

  private constructor(options: MetadataOptions, bootstrap: Bootstrap) {
    this.limit = options.queueLimit ?? 32;
    this.runtimeTtlMs = bootstrap.runtimeTtlMs ?? 5000;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker = new Worker(options.workerUrl, { workerData: { path: options.path, bootstrap },
      resourceLimits: { maxOldGenerationSizeMb: 128 } });
    this.worker.on('message', (reply: Reply) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable'));
    this.worker.on('exit', () => this.fail('unavailable'));
  }
  static async open(options: MetadataOptions): Promise<Metadata> {
    const bootstrap = validateOptions(options);
    let metadata: Metadata;
    try { metadata = new Metadata(options, bootstrap); } catch { throw new StorageError('unavailable'); }
    const timer = setTimeout(() => metadata.fail('unavailable'), 5000);
    try { await metadata.ready; return metadata; }
    catch (error) { await metadata.terminate(); throw error; }
    finally { clearTimeout(timer); }
  }
  get(key: EntityKey): Promise<NamespaceEntity> {
    return this.call({ kind: 'get', key }) as Promise<NamespaceEntity>;
  }
  list(query: ListQuery): Promise<EntityPage> { return this.call({ kind: 'list', query }) as Promise<EntityPage>; }
  getSettings(scope: SettingsScope): Promise<SettingsView> {
    return this.call({ kind: 'getSettings', scope }) as Promise<SettingsView>;
  }
  /** Internal identity seam: does not resolve defaults or inspect runtime capacity. */
  getSettingsIdentity(scope: SettingsScope): Promise<SettingsIdentity> {
    return this.call({ kind: 'getSettingsIdentity', scope }) as Promise<SettingsIdentity>;
  }
  updateRuntime(runtime: RuntimeObservation | null): Promise<null> {
    return this.call({ kind: 'runtime', runtime }) as Promise<null>;
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.send({ kind: 'close' }).then(() => undefined).finally(() => this.terminate());
    return this.closePromise;
  }
  /** Pending writes may have committed; replay original intent after reopening. */
  async abort(): Promise<void> { this.closing = true; this.fail('unavailable'); await this.terminate(); }
  private call(operation: Operation): Promise<Value> {
    if (this.closing) return Promise.reject(new StorageError('closed'));
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    if (this.pending.size >= this.limit) return Promise.reject(new StorageError('queue_full'));
    if (suiteOperation(operation) && [...this.pending.values()].filter(value => value.suite).length >= 2) return Promise.reject(new StorageError('queue_full'));
    try { return this.send(checkedOperation(operation, this.runtimeTtlMs)); }
    catch { return Promise.reject(new StorageError('invalid_input')); }
  }
  private send(operation: Operation): Promise<Value> {
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    const messageId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('unavailable'), 5000);
      this.pending.set(messageId, { resolve, reject, timer, suite: suiteOperation(operation) });
      try { this.worker.postMessage({ ...operation, messageId }); } catch { this.fail('unavailable'); }
    });
  }
  private receive(reply: Reply): void {
    if (reply.kind === 'ready') { this.readyResolve(); return; }
    if (reply.kind === 'startup_error') { this.fail(reply.code); return; }
    const pending = this.pending.get(reply.messageId);
    if (!pending) { this.fail('unavailable'); return; }
    this.pending.delete(reply.messageId); clearTimeout(pending.timer);
    if (reply.ok) pending.resolve(reply.value);
    else {
      pending.reject(new StorageError(reply.code));
      if (reply.code === 'unavailable') this.fail('unavailable');
    }
  }
  private fail(code: ErrorCode): void {
    if (this.failed) return;
    this.failed = true; this.readyReject(new StorageError(code));
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new StorageError(code)); }
    this.pending.clear(); void this.terminate();
  }
  private terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate(); return this.terminationPromise;
  }
}
export const openMetadata = Metadata.open;
