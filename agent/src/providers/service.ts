import { join } from 'node:path';
import type { InputRequest, SecretRequest } from '../staging/index.js';
import { check, field, scope, secretKey, signal, text, uuid } from './capture.js';
import { readOwnedPrivateFile } from './private-file.js';
import { pinRoot, privatePath } from './root.js';
import type { NamedIdentity } from './root.js';
import { InputStream } from './stream.js';
import { ProviderError } from './types.js';
import type { InstalledProviders, ProviderOptions } from './types.js';

interface Binding { readonly provider: 'env' | 'mounted'; readonly source: string }
interface Captured { readonly root: string; readonly bindings: ReadonlyMap<string, Binding>; readonly environment: object }
function capture(options: ProviderOptions): Captured {
  const configuration = field(options, 'configuration');
  const root = privatePath(field(configuration, 'inputRoot'));
  const bindings = field(configuration, 'secretBindings');
  const configuredEnvironment = field(options, 'environment');
  const environment = configuredEnvironment === undefined ? process.env : configuredEnvironment;
  if (!environment || typeof environment !== 'object') throw new ProviderError('configuration');
  const length = bindingCount(bindings);
  const index = new Map<string, Binding>();
  for (let n = 0; n < length; n++) {
    const binding = field(bindings, String(n));
    const key = secretKey(binding, binding);
    const provider = field(binding, 'provider') as Binding['provider'];
    const source = text(field(binding, 'source'), 1024);
    if (provider === 'mounted') privatePath(source);
    else validateVariable(source);
    if (index.has(key)) throw new ProviderError('configuration');
    index.set(key, { provider, source });
  }
  return { root, bindings: index, environment };
}
function bindingCount(bindings: unknown): number {
  if (!Array.isArray(bindings)) throw new ProviderError('configuration');
  const length = field(bindings, 'length');
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 256) throw new ProviderError('configuration');
  return length;
}
function validateVariable(source: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(source)) throw new ProviderError('configuration');
}
interface SecretOwner { readonly controller: AbortController; readonly work: Promise<Uint8Array>; readonly cleanup: Promise<never> }
class Service implements InstalledProviders {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly streams = new Set<InputStream>();
  private readonly secrets = new Set<SecretOwner>();
  constructor(private readonly configuration: Captured, private readonly root: NamedIdentity) {}
  private check(): void { if (this.closed) throw new ProviderError('closed'); }
  async input(request: InputRequest): Promise<AsyncIterable<Uint8Array>> {
    this.check();
    const authority = field(request, 'authority');
    const [organization, workspace] = scope(authority);
    const input = field(request, 'input');
    const id = uuid(field(input, 'id'));
    const digest = text(field(input, 'sha256'), 64);
    const bytes = field(input, 'bytes');
    const external = signal(field(request, 'signal'));
    if (!/^[a-f0-9]{64}$/.test(digest) || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) throw new ProviderError('invalid_input');
    this.check(); check(external);
    if (this.streams.size >= 256) throw new ProviderError('busy');
    const stream = new InputStream({ path: join(this.root.path, organization, workspace, id, digest), bytes,
      root: this.root, signal: external, retired: () => { this.streams.delete(stream); } });
    if (this.closed) { await stream.return(); throw new ProviderError('closed'); }
    this.streams.add(stream); return stream;
  }
  async secret(request: SecretRequest): Promise<Uint8Array> {
    this.check();
    const key = secretKey(field(request, 'authority'), field(request, 'secret'));
    const external = signal(field(request, 'signal'));
    const binding = this.configuration.bindings.get(key);
    this.check(); check(external);
    if (!binding) throw new ProviderError('invalid_input');
    if (binding.provider === 'env') return this.environment(binding.source, external);
    return this.mounted(binding.source, external);
  }
  private environment(source: string, external: AbortSignal): Uint8Array {
    const value = field(this.configuration.environment, source);
    this.check(); check(external);
    if (typeof value !== 'string' || Buffer.byteLength(value) > 65_536) throw new ProviderError('invalid_input');
    return new Uint8Array(Buffer.from(value));
  }
  private async mounted(path: string, external: AbortSignal): Promise<Uint8Array> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    if (external.aborted) abort();
    if (this.closed) { external.removeEventListener('abort', abort); throw new ProviderError('closed'); }
    let rejectCleanup: (error: ProviderError) => void = () => undefined;
    const cleanup = new Promise<never>((_, reject) => { rejectCleanup = reject; });
    void cleanup.catch(() => undefined);
    const work = readOwnedPrivateFile(path, 65_536, { signal: controller.signal,
      failed: () => rejectCleanup(new ProviderError('cleanup')) });
    const owner = { controller, work, cleanup }; this.secrets.add(owner);
    try { return await work; }
    finally { external.removeEventListener('abort', abort); this.secrets.delete(owner); }
  }
  close(): Promise<void> {
    this.closed = true;
    this.closing ??= Promise.resolve().then(() => this.drain());
    for (const owner of this.secrets) owner.controller.abort();
    return this.closing;
  }
  private async drain(): Promise<void> {
    const results = await Promise.allSettled([
      ...Array.from(this.streams, stream => stream.return()),
      ...Array.from(this.secrets, owner => Promise.race([owner.work, owner.cleanup])),
    ]);
    if (results.some(result => result.status === 'rejected' && result.reason instanceof ProviderError
      && result.reason.reason === 'cleanup')) throw new ProviderError('cleanup');
  }
}
export async function openInstalledProviders(options: ProviderOptions): Promise<InstalledProviders> {
  try {
    const configuration = capture(options);
    const root = await pinRoot(configuration.root);
    return new Service(configuration, root);
  } catch { throw new ProviderError('configuration'); }
}
