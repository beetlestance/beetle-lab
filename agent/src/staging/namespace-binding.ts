import { createHash } from 'node:crypto';
import { captureInstalledRoot, installedRootDigest, captureNamespaceIntent, captureNamespaceState,
  namespaceMarkerBytes, captureNamespaceMarker, captureNamespaceAnchor, sealNamespaceAnchor, namespaceCaps } from '../staging-namespace/index.js';
import type { InstalledRootFacts, NamespaceIntent, NamespaceMarker, InstalledNamespaceAnchor, InstalledNamespaceState, StagingNamespaceJournal } from '../staging-namespace/index.js';
import type { Operation } from '../backends/docker/index.js';
import { Boundary } from './bounds.js';
import { Files, bytes } from './files.js';
import type { MarkerObservation, StagingFilesPort } from './files.js';
import { rootIdentity, checkRoot, rememberRootNamespace } from './root.js';
import type { VerifiedRoot } from './root.js';
import { StagingError } from './types.js';
export class NamespaceBindingError extends Error {
  readonly code = 'recovery_required';
  constructor(cause?: unknown) { super('Staging namespace requires recovery', { cause }); }
}
export interface NamespaceBindingOptions {
  root: VerifiedRoot; journal: StagingNamespaceJournal; journalAuthority: string; operation: Operation;
  /** Trusted native boundary for focused fixtures, never a job/config field. */
  native?: StagingFilesPort;
}
function assert(condition: unknown): asserts condition { if (!condition) throw new NamespaceBindingError(); }
function installedFacts(root: VerifiedRoot): InstalledRootFacts {
  const identity = rootIdentity(root); const config = identity.configuration;
  return captureInstalledRoot({ protocolVersion: 1, installationId: config.installationId.toLowerCase(), daemonId: config.expectedDaemonId,
    source: config.stagingRoot, target: config.stagingRoot, native: { dev: identity.dev.toString(), ino: identity.ino.toString(),
      uid: String(identity.uid), gid: String(identity.gid), mode: identity.mode.toString() } });
}
/** Runtime retains this owner through original result/drain/cached closes, including startup failure. */
export class NamespaceBinding {
  private readonly boundary: Boundary;
  private readonly files: Files;
  private readonly root: InstalledRootFacts;
  private observation: MarkerObservation | undefined;
  private running: Promise<InstalledNamespaceAnchor> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  constructor(private readonly options: NamespaceBindingOptions) {
    this.root = installedFacts(options.root); this.boundary = new Boundary(options.operation);
    this.files = new Files(rootIdentity(options.root), this.boundary, async () => undefined, options.native);
  }
  bind(): Promise<InstalledNamespaceAnchor> {
    if (this.closed) return Promise.reject(new StagingError('closed'));
    this.running ??= this.run(); return this.running;
  }
  private async run(): Promise<InstalledNamespaceAnchor> {
    try {
      await this.files.namespaceAncestors();
      const state = captureNamespaceState(await this.boundary.wait(() => this.options.journal.read()));
      const intent = await this.intent(state); const marker = await this.marker(state, intent);
      await this.files.syncDirectories(); await this.files.close();
      await this.verifyMarker();
      await checkRoot(rootIdentity(this.options.root), this.boundary);
      const anchor = captureNamespaceAnchor(await this.boundary.wait(() => this.options.journal.commit({ intent, marker })), intent);
      assert(anchor.namespaceIdentity === sealNamespaceAnchor({ intent, marker }).namespaceIdentity);
      await checkRoot(rootIdentity(this.options.root), this.boundary); await this.verifyMarker(); this.boundary.check();
      rememberRootNamespace(this.options.root, anchor); return anchor;
    } catch (error) {
      if (error instanceof NamespaceBindingError) throw error;
      if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'recovery_required') throw new NamespaceBindingError(error);
      throw error;
    } finally {
      try { await this.boundary.drain(); await this.files.close(); } finally { this.boundary.dispose(); }
    }
  }
  private async intent(state: InstalledNamespaceState | null): Promise<NamespaceIntent> {
    if (!state) assert((await this.files.namespaceEntries()).length === 0);
    const intent = captureNamespaceIntent(await this.boundary.wait(() => this.options.journal.begin(this.root)));
    if (state) assert(state.intent.namespaceId === intent.namespaceId && state.intent.nonce === intent.nonce);
    assert(intent.rootDigest === installedRootDigest(this.root) && intent.journalAuthority === this.options.journalAuthority); return intent;
  }
  private async marker(state: InstalledNamespaceState | null, intent: NamespaceIntent): Promise<NamespaceMarker> {
    if (state?.state !== 'bound') await this.ensureMarker(intent);
    const marker = await this.readMarker(intent);
    if (state?.state === 'bound') assert(sealNamespaceAnchor({ intent, marker }).namespaceIdentity === state.anchor.namespaceIdentity);
    return marker;
  }
  private async ensureMarker(intent: NamespaceIntent): Promise<void> {
    const entries = await this.files.namespaceEntries();
    assert(entries.length === 0 || (entries.length === 1 && entries[0] === namespaceCaps.markerName));
    if (entries.length === 0) {
      const content = namespaceMarkerBytes(intent);
      await this.files.file(this.root.target, namespaceCaps.markerName, bytes(content), content.byteLength);
    }
  }
  private async readMarker(intent: NamespaceIntent): Promise<NamespaceMarker> {
    const expected = namespaceMarkerBytes(intent);
    let read: Awaited<ReturnType<Files['readNamespaceMarker']>>;
    try { read = await this.files.readNamespaceMarker(expected.byteLength); }
    catch (error) { throw new NamespaceBindingError(error); }
    assert(Buffer.from(read.bytes).equals(Buffer.from(expected)));
    this.observation = read.observation;
    return captureNamespaceMarker({ ...read.observation.native, sha256: createHash('sha256').update(read.bytes).digest('hex') }, intent);
  }
  private async verifyMarker(): Promise<void> {
    assert(this.observation);
    try { await this.files.verifyNamespaceMarker(this.observation); }
    catch (error) { throw new NamespaceBindingError(error); }
  }
  close(): Promise<void> {
    this.closed = true; this.boundary.fail(new StagingError('closed')); this.closing ??= this.closeOriginal(); return this.closing;
  }
  private async closeOriginal(): Promise<void> {
    if (this.running) await Promise.allSettled([this.running]);
    try { await this.boundary.drain(); await this.files.close(); } finally { this.boundary.dispose(); }
  }
}
