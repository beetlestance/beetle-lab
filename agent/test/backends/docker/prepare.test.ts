import { describe, expect, it } from 'vitest';
import { prepareRuntime, runtimeName } from '../../../src/backends/docker/index.js';
import { makeInput, makePlan } from './fixtures.js';

describe('approved Docker specification', () => {
  it('sets exact immutable resource/security controls and restricted mounts', () => {
    const input = makeInput();
    const plan = makePlan(input);
    expect(plan.spec.Image).toBe(input.manifest.imageDigest);
    expect(plan.spec).toMatchObject({ User: '10001:10001', Entrypoint: ['beetle-wrapper'], Cmd: [], Env: input.profile.effectiveImage.environment,
      WorkingDir: '/beetle/input', NetworkDisabled: false,
      HostConfig: { NanoCpus: 1_000_000_000, Memory: 536_870_912, MemorySwap: 536_870_912, PidsLimit: 128,
        ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges:true'],
        NetworkMode: 'beetle-targets', RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, AutoRemove: false,
        PidMode: '', IpcMode: 'private', UTSMode: '', CgroupnsMode: 'private', PublishAllPorts: false,
        PortBindings: {}, Devices: [], DeviceRequests: [], Binds: [], VolumesFrom: [],
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=1048576,mode=1777' }, LogConfig: { Type: 'none', Config: {} } } });
    expect(plan.spec.HostConfig.Mounts.map(mount => [mount.Target, mount.ReadOnly, mount.BindOptions.Propagation]))
      .toEqual([['/beetle/input', true, 'rprivate'], ['/beetle/output', false, 'rprivate'], ['/beetle/secrets', true, 'rprivate']]);
    expect(plan.spec.Labels['dev.beetle.spec']).toBe(plan.specDigest);
    expect(Object.isFrozen(plan.spec.HostConfig.Mounts[0])).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
  });
  it('does not serialize job config, environment, flags or secret references', () => {
    const input = makeInput();
    input.offer.config = { Env: { TOKEN: 'secret-canary' }, Privileged: true, command: 'arbitrary', host: '/docker.sock' };
    const spec = JSON.stringify(makePlan(input).spec);
    for (const value of ['secret-canary', 'arbitrary', 'token-ref', 'api-token', 'docker.sock']) expect(spec).not.toContain(value);
    const result = prepareRuntime({ ...input, offer: { ...input.offer, Env: ['TOKEN=secret-canary'] } });
    expect(result).toEqual({ ok: false, reason: 'invalid_input' });
  });
  it('snapshots inputs before validation and bounds/catches cycles and accessors safely', () => {
    const input = makeInput();
    const plan = makePlan(input);
    input.manifest.entrypoint.arguments.push('changed');
    expect(plan.spec.Cmd).toEqual([]);
    const cyclic: Record<string, unknown> = {}; cyclic.cycle = cyclic;
    expect(prepareRuntime({ ...input, offer: cyclic })).toEqual({ ok: false, reason: 'invalid_input' });
    let read = false;
    const getter = Object.defineProperty({}, 'config', { enumerable: true, get: () => { read = true; return 'canary'; } });
    expect(prepareRuntime({ ...input, offer: getter }).ok).toBe(false);
    expect(read).toBe(false);
    expect(prepareRuntime({ ...input, offer: { ...input.offer, config: { huge: 'x'.repeat(1_048_577) } } }).ok).toBe(false);
  });
  it.each(['image', 'entrypoint', 'capability', 'minimum', 'maximum', 'controls', 'hard-output', 'cpu-overflow'])('rejects unapproved %s', kind => {
    let input = makeInput();
    let hardOutput = false;
    switch (kind) {
      case 'image': input.offer.engine.imageDigest = `sha256:${'c'.repeat(64)}`; break;
      case 'entrypoint': input = { ...input, profile: { ...input.profile, entrypoint: { executable: 'sh', arguments: [] } } }; break;
      case 'capability': input.offer.requiredCapabilities.push('unknown'); break;
      case 'minimum': input.offer.budget.memoryBytes--; break;
      case 'maximum': input.offer.budget.pids++; break;
      case 'controls': input.manifest.supportedControls = ['cpu', 'memory']; break;
      case 'hard-output': hardOutput = true; break;
      case 'cpu-overflow':
        input.offer.budget.cpuMillis = 9_007_199_255;
        input = { ...input, profile: { ...input.profile, maximumBudget: { ...input.profile.maximumBudget, cpuMillis: 9_007_199_255 } } }; break;
    }
    expect(prepareRuntime({ ...input, requireHardOutputQuota: hardOutput })).toEqual({ ok: false, reason: 'unsupported' });
  });
  it.each(['/tmp/../escape', 'relative', '/', '/var/run/docker.sock', '/proc/input', '/dev/input'])('rejects unsafe staging root %s', root => {
    const input = makeInput();
    expect(prepareRuntime({ ...input, profile: { ...input.profile, stagingRoot: root } }).ok).toBe(false);
  });
  it('rejects arbitrary staged paths, root UID, host network and invalid generations', () => {
    const input = makeInput();
    expect(prepareRuntime({ ...input, staged: { ...input.staged, secrets: '/tmp/other' } }).ok).toBe(false);
    expect(prepareRuntime({ ...input, profile: { ...input.profile, user: '0:0' } }).ok).toBe(false);
    expect(prepareRuntime({ ...input, profile: { ...input.profile, network: { profile: 'target-egress', name: 'host' } } }).ok).toBe(false);
    for (const generation of [0, -1, NaN, 1.5]) expect(prepareRuntime({ ...input, generation }).ok).toBe(false);
  });
  it('normalizes UUID hex case but preserves URN distinction and scoped generation', () => {
    const identity = { installationId: 'abcdef00-0000-4000-8000-000000000010',
      organizationId: 'abcdef00-0000-4000-8000-000000000011', workspaceId: 'abcdef00-0000-4000-8000-000000000012',
      attemptId: 'abcdef00-0000-4000-8000-000000000013', generation: 1 };
    const name = runtimeName(identity);
    expect(runtimeName({ ...identity, attemptId: identity.attemptId.toUpperCase() })).toBe(name);
    expect(runtimeName({ ...identity, attemptId: `urn:uuid:${identity.attemptId}` })).not.toBe(name);
    expect(runtimeName({ ...identity, generation: 2 })).not.toBe(name);
    expect(runtimeName({ ...identity, workspaceId: identity.organizationId })).not.toBe(name);
  });
});
