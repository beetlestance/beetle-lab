import type { RuntimePlan } from '../backends/docker/index.js';
import { snapshot, Boundary } from './bounds.js';
import { scopeSnapshot, validationSnapshot } from './authority.js';
import type { Files } from './files.js';
import { prepareFiles } from './prepare.js';
import { rootIdentity } from './root.js';
import { StagingError } from './types.js';
import type { StagerOptions, Preparation, PrepareRequest, StagingResult } from './types.js';
export { verifyInstallation } from './root.js';
export type { VerifiedRoot } from './root.js';
export { readRootSpace } from './space.js';
export type { RootSpace } from './space.js';
export type { OutputScanRequest, OutputScanResult, OutputScanReason } from './output-types.js';
export { StagingError } from './types.js';
export type { Authority, Providers, InputRequest, SecretRequest, InstallationConfiguration, VerifyInput,
  StagerOptions, Preparation, PrepareRequest, StagingReason, StagingResult } from './types.js';

// Stronger than per-installation: at most two active preparations across this process.
let active = 0;
function rejected(reason: 'busy' | 'closed'): Preparation {
  return { result: Promise.resolve({ ok: false, reason }), quiesced: Promise.resolve() };
}
/** Trusted single-agent composition retains this service through shutdown/quiescence. */
export class Stager {
  private readonly options: StagerOptions;
  private readonly running = new Set<Promise<void>>();
  private closed = false;
  constructor(options: StagerOptions) {
    const identity = rootIdentity(options.root);
    const profile = snapshot(options.profile, 65_536);
    if (identity.configuration.installationId.toLowerCase() !== profile.installationId.toLowerCase()
      || identity.configuration.stagingRoot !== profile.stagingRoot || identity.configuration.user !== profile.user) throw new StagingError('installation');
    const providers = Object.freeze({ input: options.providers.input, secret: options.providers.secret });
    this.options = Object.freeze({ ...options, providers, profile, manifest: snapshot(options.manifest, 65_536), validation: validationSnapshot(options.validation) });
  }
  prepare(input: PrepareRequest): Preparation {
    if (this.closed) return rejected('closed');
    if (active >= 2) return rejected('busy');
    let boundary: Boundary; let request: PrepareRequest;
    try {
      request = { key: scopeSnapshot(input.key), operation: { deadline: input.operation.deadline,
        ...(input.operation.signal ? { signal: input.operation.signal } : {}) } };
      boundary = new Boundary(request.operation);
    } catch { return { result: Promise.resolve({ ok: false, reason: 'invalid_input' }), quiesced: Promise.resolve() }; }
    active++;
    let resolve: (result: StagingResult<RuntimePlan>) => void = () => undefined;
    const result = new Promise<StagingResult<RuntimePlan>>(done => { resolve = done; });
    const quiesced = this.run(request, boundary, resolve);
    this.running.add(quiesced);
    void quiesced.then(() => this.running.delete(quiesced));
    return Object.freeze({ result, quiesced });
  }
  /** No cancellation/release authority. A stalled issued operation deliberately keeps this pending. */
  async close(): Promise<void> { this.closed = true; await Promise.all(this.running); }
  private async run(request: PrepareRequest, boundary: Boundary, resolve: (result: StagingResult<RuntimePlan>) => void): Promise<void> {
    let files: Files | undefined;
    try {
      const plan = await prepareFiles({ options: this.options, request, boundary, ownFiles: owned => { files = owned; } });
      boundary.check(); resolve({ ok: true, value: plan });
    } catch (error) {
      const failure = error instanceof StagingError ? error : new StagingError('io');
      boundary.fail(failure); resolve({ ok: false, reason: failure.reason });
    }
    finally {
      await boundary.drain();
      // A failed close is unknown kernel work: it cannot establish a quiescent boundary.
      try { await files?.close(); }
      catch { await new Promise<never>(() => undefined); }
      boundary.dispose(); active--;
    }
  }
}
