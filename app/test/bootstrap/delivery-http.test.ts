import { expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { openAgentRuntime } from '../../src/bootstrap/agent-runtime.js';
import type { AgentRuntime } from '../../src/bootstrap/agent-runtime.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { seed, settingsFixture, storageFixture, observation, scope } from '../storage/fixture.js';
import { append, createSuite } from '../storage/suites-fixture.js';
import { runCommand, runOptions } from '../storage/runs-fixture.js';
import { deliveryHttpFixture, journalAuthority } from './delivery-http-fixture.js';

const fixture = storageFixture();
function options(runtime = true) {
  const values = settingsFixture(); values.chain.installation.values.pool.storageBytes = 1_000_000;
  values.chain.installation.values.supportedProfiles = ['standard'];
  values.runtime.pool.storageBytes = 2_000_000;
  return { installation: values.chain.installation, runtime: runtime ? observation(values.runtime) : null, ...runOptions() };
}
async function until(predicate: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for synthetic delivery');
}
it('reopens a claim made before any PUT, reconciles a scoped404 and sends the same original once over TCP', async () => {
  const configured = options(); const server = await deliveryHttpFixture(configured.runs!.profiles[0]!);
  server.state.requireAbsence = true;
  const root = await realpath(fixture.root()); const path = join(root, 'before-put.sqlite');
  let metadata: Metadata | undefined; let runtime: AgentRuntime | undefined;
  try {
    metadata = await fixture.open(path, configured); await seed(metadata);
    const revision = await append(metadata, await createSuite(metadata));
    const run = await metadata.runs.execute(runCommand(revision.id));
    const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
    const original = await metadata.dispatch.readOffer(key);
    expect((await metadata.dispatch.claim(key)).kind).toBe('claimed');
    expect(server.state.puts).toBe(0); await fixture.close(metadata);
    metadata = await fixture.open(path, options(false));
    runtime = await openAgentRuntime({ connection: server.connection, dataRoot: root }, metadata);
    const resumed = metadata;
    await until(async () => (await resumed.runs.getRun({ id: run.id, scope })).state === 'active');
    expect(server.state.absences).toBe(1); expect(server.state.gets).toBeGreaterThan(0); expect(server.state.puts).toBe(1); expect(server.state.accepted).toBe(1);
    expect(server.state.original).toEqual(original.offer); expect(server.state.failure).toBeUndefined();
    expect(await metadata.dispatch.claim(key)).toEqual({ kind: 'acknowledged', journalAuthority });
    expect((await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items).toEqual([]);
  } finally {
    try { await runtime?.close(); }
    finally { try { if (metadata) await fixture.close(metadata); } finally { await server.close(); } }
  }
});
it('recovers a lost PUT response after backend worker restart and profile drift without another PUT', async () => {
  const configured = options(); const server = await deliveryHttpFixture(configured.runs!.profiles[0]!);
  server.state.losePut = true; server.state.snapshots = false;
  const root = await realpath(fixture.root()); const path = join(root, 'lost-response.sqlite');
  let metadata: Metadata | undefined; let runtime: AgentRuntime | undefined;
  try {
    metadata = await fixture.open(path, options(false)); await seed(metadata);
    const revision = await append(metadata, await createSuite(metadata));
    runtime = await openAgentRuntime({ connection: server.connection, dataRoot: root }, metadata);
    await until(async () => runtime?.state().status === 'published');
    const run = await metadata.runs.execute(runCommand(revision.id));
    const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
    const original = await metadata.dispatch.readOffer(key);
    await until(async () => server.state.accepted === 1);
    expect((await metadata.dispatch.claim(key)).kind).toBe('replay');
    await runtime.close(); runtime = undefined; await fixture.close(metadata);
    const next = structuredClone(configured.runs!.profiles[0]!);
    next.engine.imageDigest = `sha256:${'e'.repeat(64)}`; next.installedIdentity.profileDigest = 'f'.repeat(64);
    server.state.profile = next; server.state.snapshots = true;
    metadata = await fixture.open(path, { ...options(false), runs: { profiles: [next], pendingLimit: 256 } });
    runtime = await openAgentRuntime({ connection: { ...server.connection,
      configuration: { ...server.connection.configuration, profiles: [next] } }, dataRoot: root }, metadata);
    const resumed = metadata;
    await until(async () => (await resumed.runs.getRun({ id: run.id, scope })).state === 'active');
    expect(server.state.puts).toBe(1); expect(server.state.accepted).toBe(1);
    expect(server.state.original).toEqual(original.offer); expect(server.state.failure).toBeUndefined();
    expect(await metadata.dispatch.claim(key)).toEqual({ kind: 'acknowledged', journalAuthority });
    expect((await metadata.dispatch.readOffer(key)).offer).toEqual(original.offer);
  } finally {
    try { await runtime?.close(); }
    finally { try { if (metadata) await fixture.close(metadata); } finally { await server.close(); } }
  }
});
