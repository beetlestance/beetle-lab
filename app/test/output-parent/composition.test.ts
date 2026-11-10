import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openAgentRuntime } from '../../src/bootstrap/agent-runtime.js';
import type { OutputRuntimeOptions } from '../../src/ports/output-runtime.js';
import type { RunnerOutputGateway } from '../../src/ports/output-source.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
import { pin, credential } from '../bootstrap/agent-config/fixture.js';
import { deferred, flush, outputOwnerFixture } from './fixture.js';

const mocks = vi.hoisted(() => ({ gateway: vi.fn(), source: vi.fn(), outputs: vi.fn(), delivery: vi.fn() }));
vi.mock('../../src/adapters/outbound/runner/index.js', () => ({ createRunnerGateway: mocks.gateway, startDeliveryRuntime: mocks.delivery }));
vi.mock('../../src/adapters/outbound/capacity/index.js', () => ({ openCapacitySource: mocks.source }));
vi.mock('../../src/bootstrap/output-runtime/index.js', () => ({ openOutputRuntime: mocks.outputs }));
const fixture = storageFixture();
beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

function configuration() {
  return { dataRoot: fixture.root(), connection: { token: credential, configuration: {
    version: 1 as const, origin: 'http://127.0.0.1:1', tokenFile: '/synthetic/token',
    expectedInstallationId: settingsFixture().chain.installation.id, profiles: [pin()],
    storageAllocationBytes: 20000, freeSpaceReserveBytes: 2000,
  } } };
}
async function setup() {
  const metadata = await fixture.open(); const f = outputOwnerFixture(mocks.delivery);
  const gateway: RunnerOutputGateway = { ...f.gateway, output: vi.fn(() => { throw new Error('Synthetic output client'); }) };
  mocks.gateway.mockReturnValue(gateway); mocks.source.mockResolvedValue(f.source);
  mocks.outputs.mockResolvedValue(f.output);
  return { f, metadata, gateway, options: configuration() };
}
it('always provisions the actual output factory with installation metadata and a bound output-only shared gateway', async () => {
  const { f, metadata, gateway, options } = await setup();
  const held = deferred<typeof f.output>(); mocks.outputs.mockReturnValueOnce(held.promise);
  const runtimeOpening = openAgentRuntime(options, metadata); await flush();
  expect(mocks.outputs).toHaveBeenCalledOnce(); expect(f.source.sample).not.toHaveBeenCalled();
  expect(mocks.delivery).not.toHaveBeenCalled();
  const captured = mocks.outputs.mock.calls[0]![0] as OutputRuntimeOptions;
  expect(captured).toMatchObject({ dataRoot: options.dataRoot, freeSpaceReserveBytes: 2000 });
  expect(captured.outputs).toBe(metadata.outputs); expect(captured.finalizations).toBe(metadata.finalizations);
  expect(captured.runs).toBe(metadata.runs); expect(Object.keys(captured.gateway)).toEqual(['output']);
  const identity = { journalAuthority: '33333333-3333-4333-8333-333333333333', organizationId: 'org',
    workspaceId: 'workspace', attemptId: 'attempt', generation: 1, intentDigest: 'a'.repeat(64) };
  expect(() => captured.gateway.output(identity)).toThrow('Synthetic output client');
  expect(gateway.output).toHaveBeenCalledWith(identity); expect(vi.mocked(gateway.output).mock.contexts[0]).toBe(gateway);
  held.resolve(f.output); const runtime = await runtimeOpening;
  try {
    expect(mocks.gateway).toHaveBeenCalledOnce();
    expect(mocks.source).toHaveBeenCalledWith({ dataRoot: options.dataRoot, configuration: options.connection.configuration, gateway });
    expect(f.options()?.gateway).toBe(gateway);
  } finally { await runtime.close(); await fixture.close(metadata); }
});
it('owns source and shared connection cleanup when mandatory production output provisioning rejects', async () => {
  const { f, metadata, gateway, options } = await setup(); const failure = new Error('Synthetic mandatory output startup failure');
  mocks.outputs.mockRejectedValueOnce(failure);
  try {
    await expect(openAgentRuntime(options, metadata)).rejects.toBe(failure);
    expect(f.source.close).toHaveBeenCalledOnce(); expect(gateway.close).toHaveBeenCalledOnce();
    expect(f.source.sample).not.toHaveBeenCalled(); expect(mocks.delivery).not.toHaveBeenCalled();
    expect(await metadata.outputs.scan({ limit: 1 })).toMatchObject({ items: [] });
  } finally { await fixture.close(metadata); }
});
it('closes the sole gateway if capacity-source provisioning fails before outputs open', async () => {
  const { metadata, gateway, options } = await setup(); const failure = new Error('Synthetic capacity startup failure');
  mocks.source.mockRejectedValueOnce(failure);
  try {
    await expect(openAgentRuntime(options, metadata)).rejects.toBe(failure);
    expect(gateway.close).toHaveBeenCalledOnce(); expect(mocks.outputs).not.toHaveBeenCalled();
  } finally { await fixture.close(metadata); }
});
