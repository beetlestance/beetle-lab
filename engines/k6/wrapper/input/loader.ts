import { compileSuite } from '../../compiler/suite/index.js';
import type { Offer } from '@beetle/contracts';
import type { CompileInput, SuiteIssue } from '../../compiler/suite/index.js';
import { sha256, validateCompileInput, validateSuiteConfig } from '../../compiler/suite/validation.js';
import { checkBindings, decode, digest, freeze, text } from './bindings.js';
import { Budget } from './budget.js';
import { Files } from './files.js';
import { matchSecretReferences } from './secrets.js';
import { failure, InputError } from './types.js';
import type { CompiledInput, InputOperation, InputResult, OpenStagedOptions, StagedHeaders, StagedInput } from './types.js';

/** One loader owns one staged attempt; no resolved secret values cross this boundary. */
export class Loader {
  private readonly budget: Budget;
  private readonly files: Files;
  private headers: StagedHeaders | undefined;
  private offer: Offer | undefined;
  private compiled = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private active: Promise<void> = Promise.resolve();
  constructor(private readonly options: OpenStagedOptions) {
    this.budget = new Budget(options); this.files = new Files(this.budget, options.uid);
  }
  open(): InputOperation<StagedInput> {
    return this.operation(async () => {
      this.budget.start();
      await this.files.root(this.options.inputRoot);
      await this.files.root(this.options.secretRoot);
      if (this.options.inputRoot === this.options.secretRoot) throw new InputError('binding');
      const staging = decode('StagedAttempt', await this.files.read(this.options.inputRoot, 'staging.json', 65_536), 65_536);
      this.budget.metadata(staging.deadlineMs);
      const offerBytes = await this.files.read(this.options.inputRoot, 'offer.json', 1_048_576);
      const offer = decode('Offer', offerBytes, 1_048_576);
      const attempt = this.budget.bind(offer.budget.timeoutMs, staging.deadlineMs);
      const manifestBytes = await this.files.read(this.options.inputRoot, 'manifest.json', 65_536);
      const manifest = decode('EngineManifest', manifestBytes, 65_536);
      checkBindings({ staging, offer, manifest, offerBytes, manifestBytes, options: this.options });
      await this.files.entries(this.options.inputRoot, ['staging.json', 'offer.json', 'manifest.json', ...staging.inputFiles.map(item => item.fileName)]);
      await this.files.entries(this.options.secretRoot, staging.secretNames);
      await this.statSecrets(staging.secretNames);
      this.offer = offer;
      this.headers = freeze({ staging, offer, manifest, attempt });
      this.budget.headersFinished();
      return Object.freeze({ ...this.headers, compile: () => this.compile(), close: () => this.close() });
    });
  }
  private async statSecrets(names: readonly string[]): Promise<void> {
    let total = 0;
    for (const name of names) {
      total += await this.files.stat(this.options.secretRoot, name, 65_536);
      if (total > 1_048_576) throw new InputError('input_limit');
    }
  }
  private compile(): InputOperation<CompiledInput> {
    if (this.closed) return this.rejected('closed');
    if (this.compiled) return this.rejected('already_compiled');
    this.compiled = true;
    return this.operation(async () => {
      const headers = this.headers!;
      this.budget.check();
      const config = validateSuiteConfig(headers.offer.config);
      if (!config.ok) return this.semantic(config);
      if (!matchSecretReferences(config.value, this.offer!)) throw new InputError('secret_binding');
      const inputs = await this.inputs(headers);
      this.budget.check();
      const dependencies = validateCompileInput({ engine: { version: headers.manifest.engineVersion,
        imageDigest: headers.manifest.imageDigest }, inputs });
      if (!dependencies.ok) return this.semantic(dependencies);
      this.budget.check();
      const suite = compileSuite(config.value, { input: dependencies.value, digest: sha256 });
      this.budget.check();
      if (!suite.ok) return this.semantic(suite);
      return Object.freeze({ suite: suite.value, attempt: headers.attempt });
    });
  }
  private semantic(result: { readonly issues: readonly SuiteIssue[] }): never {
    // Compiler issues are static codes/paths, but never publish exception text or data.
    throw new InputError('invalid_config', Object.freeze(result.issues.slice(0, 16).map(issue =>
      Object.freeze({ code: issue.code, path: issue.path.slice(0, 256) }))));
  }
  private async inputs(headers: StagedHeaders): Promise<CompileInput['inputs']> {
    const inputs: CompileInput['inputs'] = [];
    let total = 0;
    for (const reference of headers.offer.inputs) {
      total += reference.bytes;
      if (reference.bytes > 8_388_608 || total > 33_554_432) throw new InputError('input_limit');
    }
    for (const [index, reference] of headers.offer.inputs.entries()) {
      const bytes = await this.files.read(this.options.inputRoot, headers.staging.inputFiles[index]!.fileName, 8_388_608);
      if (bytes.byteLength !== reference.bytes || digest(bytes) !== reference.sha256) throw new InputError('input_integrity');
      inputs.push({ ref: { ...reference }, content: text(bytes) });
    }
    return inputs;
  }
  private operation<T>(work: () => Promise<T>): InputOperation<T> {
    // Publish ownership synchronously, before any caller-provided clock can reenter.
    let resolveQuiet!: () => void;
    let rejectQuiet!: (error: unknown) => void;
    const quiesced = new Promise<void>((resolve, reject) => { resolveQuiet = resolve; rejectQuiet = reject; });
    this.active = quiesced;
    const task = Promise.resolve().then(async () => {
      const outcome = await this.execute(work);
      await this.budget.settled();
      try { await this.files.close(); resolveQuiet(); }
      catch (error) { rejectQuiet(error); throw error; }
      if (!outcome.ok) throw outcome.error;
      this.budget.check(); return outcome.value;
    });
    void quiesced.catch(() => undefined);
    const result: Promise<InputResult<T>> = this.budget.race(task).then(value => {
      this.budget.check(); return { ok: true as const, value };
    }).catch(error => {
      this.closed = true; this.budget.dispose(); return failure(error);
    });
    return Object.freeze({ result, quiesced });
  }
  private async execute<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    try {
      this.budget.check(); const value = await work(); this.budget.check(); return { ok: true, value };
    } catch (error) { return { ok: false, error }; }
  }
  private rejected<T>(code: 'closed' | 'already_compiled'): InputOperation<T> {
    return Object.freeze({ result: Promise.resolve({ ok: false as const, code }), quiesced: this.active });
  }
  private close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.budget.stop('closed');
    this.closePromise = Promise.resolve().then(async () => {
      await this.active; await this.files.close(); this.budget.dispose();
    });
    return this.closePromise;
  }
}
