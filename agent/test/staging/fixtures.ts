import { gateFor } from '../producer-gate/fixtures.js';
import { afterEach } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deriveInstalledIdentity } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { DockerRequest, DockerReply, DockerTransport } from '../../src/backends/docker/index.js';
import { Stager, verifyInstallation, NamespaceBinding } from '../../src/staging/index.js';
import type { InstallationConfiguration, StagerOptions } from '../../src/staging/index.js';
import { admissionFixture, configuration as admissionConfiguration, now, scope, validation } from '../admission/fixtures.js';
import { makeInput } from '../backends/docker/fixtures.js';

export const data = Buffer.from('🪲 café');
export const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const operation = (ms = 5000) => ({ deadline: performance.now() + ms });
export async function* stream(value: Uint8Array = data): AsyncIterable<Uint8Array> { yield value; }
export class Inspection implements DockerTransport {
  readonly calls: DockerRequest[] = [];
  info: Record<string, unknown>;
  agent: Record<string, unknown>;
  constructor(config: InstallationConfiguration) {
    this.info = { ID: config.expectedDaemonId, OSType: 'linux' };
    this.agent = { Id: 'b'.repeat(64), Name: `/${config.agentContainer}`, Image: config.agentImageId,
      Config: { User: config.user }, State: { Running: true, Paused: false, Restarting: false, Dead: false },
      Mounts: [{ Type: 'bind', Source: config.stagingRoot, Destination: config.stagingRoot, RW: true, Propagation: 'rprivate' }] };
  }
  async request(request: DockerRequest): Promise<DockerReply> {
    this.calls.push(request);
    return { ok: true, status: 200, body: request.path.endsWith('/info') ? this.info : this.agent };
  }
}
export function fixture() {
  const journal = admissionFixture();
  const paths: string[] = []; const stagers: Stager[] = [];
  afterEach(async () => {
    await Promise.all(stagers.splice(0).map(stager => stager.close()));
    await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })));
  });
  return {
    ...journal,
    async environment(enqueue = true, timeoutMs = 1000,liveMetricMailbox=false) {
      const rootPath = await realpath(await mkdtemp(join(tmpdir(), 'beetle-staging-'))); paths.push(rootPath);
      const input = makeInput(); const offer = journal.job(); offer.secretReferences = [];
      offer.budget.timeoutMs = timeoutMs;
      offer.inputs = [{ id: offer.inputs[0]!.id, bytes: data.byteLength, sha256: hash(data) }];
      offer.config.note = '🪲 café';
      const manifest = input.manifest; manifest.minimumBudget = { ...offer.budget };
      const user = `${process.getuid!()}:${process.getgid!()}`;
      const profile = { ...input.profile, user, stagingRoot: rootPath, maximumBudget: { ...offer.budget },...(liveMetricMailbox?{liveMetricMailbox:true}:{}) };
      const configuration = { installationId: profile.installationId, stagingRoot: rootPath, expectedDaemonId: 'synthetic-daemon',
        agentContainer: 'synthetic-agent', agentImageId: `sha256:${'c'.repeat(64)}`, user };
      const transport = new Inspection(configuration);
      const verified = await verifyInstallation({ configuration, transport, operation: operation() });
      if (!verified.ok) throw new Error(verified.reason);
      const journalPath = journal.path(); const owner = await journal.configured(journalPath, undefined, async current => {
        const binding = new NamespaceBinding({ root: verified.value, journal: current.stagingNamespace,
          journalAuthority: await current.journalAuthority(), operation: operation() });
        try { await binding.bind(); } finally { await binding.close(); }
      });
      if (timeoutMs !== 1000) await owner.admission({ kind: 'configure',
        configuration: { ...admissionConfiguration(), maxTimeoutMs: timeoutMs } });
      const installed = await owner.stagingNamespace.read();
      if (installed?.state !== 'bound') throw new Error('Missing test namespace');
      const gate = gateFor(owner, installed.anchor.namespaceIdentity);
      const options: StagerOptions = { gate, root: verified.value, profile, manifest, journal: owner,
        validation: { manifestId: validation(offer).manifestId, profileId: 'locked', schemaDigest: 'b'.repeat(64), catalogVersion: 1 },
        providers: { input: async () => stream(), secret: async () => Buffer.from('SYNTHETIC_SENTINEL') }, wallNow: () => now + 1 };
      offer.installedIdentity = deriveInstalledIdentity({ manifest, profile, identity: options.validation },
        value => createHash('sha256').update(value).digest('hex'));
      if (enqueue) { await journal.enqueue(owner, offer); await journal.admit(owner, offer); }
      const create = (overrides: Partial<StagerOptions> = {}) => {
        const target = overrides.journal ?? owner;
        const rebound = overrides.gate ?? (target === owner ? gate : gateFor(target, gate.namespaceIdentity));
        const stager = new Stager({ ...options, ...overrides, gate: rebound }); stagers.push(stager); return stager;
      };
      const prepare = (stager: Stager, target: Offer = offer, ms = 5000) => stager.prepare({ key: scope(target), operation: operation(ms) });
      return { rootPath, journalPath, configuration, transport, offer, owner, options, create, prepare };
    },
  };
}
