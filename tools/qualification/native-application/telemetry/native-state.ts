import assert from 'node:assert/strict';
import type { DockerTransport } from '../../../../agent/src/backends/docker/index.js';
import { verifyLiveVolume } from '../live-volumes.js';
import { record } from '../../resources/values.js';
function text(value: unknown) {
  assert(typeof value === 'string' && value.length <= 2048);
  return value;
}
function strings(value: unknown) {
  const entries = Object.entries(record(value));
  assert(entries.length <= 32);
  return Object.fromEntries(entries.map(([key, item]) => [key, text(item)]));
}
function captureVolume(value: unknown) {
  const row = record(value);
  return {
    Name: text(row.Name),
    Driver: text(row.Driver),
    Scope: text(row.Scope),
    Options: strings(row.Options),
    Labels: strings(row.Labels),
  };
}
export async function inspect(transport: DockerTransport, name: string) {
  assert(/^(?:beetle-[a-f0-9]{64}|[a-f0-9]{64})$/.test(name));
  const response = await transport.request({
    method: 'GET',
    path: '/v1.47/containers/' + name + '/json',
    deadline: performance.now() + 2000,
    signal: AbortSignal.timeout(2000),
  });
  assert(response.ok);
  if (response.status === 404) return null;
  assert.equal(response.status, 200);
  const body = record(response.body);
  const state = record(body.State);
  const host = record(body.HostConfig);
  assert.equal(host.NanoCpus, 1000000000);
  assert.equal(host.Memory, 536870912);
  assert.equal(host.MemorySwap, 536870912);
  assert.equal(host.PidsLimit, 128);
  assert(typeof body.Id === 'string' && /^[a-f0-9]{64}$/.test(body.Id));
  assert.equal(state.OOMKilled, false);
  assert(typeof state.StartedAt === 'string' && typeof state.FinishedAt === 'string');
  return {
    id: body.Id,
    running: state.Running === true,
    exitCode: state.ExitCode,
    startedAt: state.StartedAt,
    finishedAt: state.FinishedAt,
  };
}
export function elapsed(start: string, end: string) {
  const value = Date.parse(end) - Date.parse(start);
  assert(Number.isFinite(value) && value >= 1000 && value < 60000);
  return value;
}
export async function removeStopped(
  transport: DockerTransport,
  binding: { id: string; installationId: string; attemptId: string; generation: 1; imageId: string },
) {
  assert(/^[a-f0-9]{64}$/.test(binding.id));
  const response = await transport.request({
    method: 'GET',
    path: '/v1.47/containers/' + binding.id + '/json',
    deadline: performance.now() + 2000,
  });
  assert(response.ok && response.status === 200);
  const row = record(response.body);
  const state = record(row.State);
  const labels = record(record(row.Config).Labels);
  assert.equal(row.Id, binding.id);
  assert.equal(row.Image, binding.imageId);
  assert.equal(state.Running, false);
  assert.equal(state.OOMKilled, false);
  for (const [label, value] of [
    ['installation', binding.installationId],
    ['attempt', binding.attemptId],
    ['generation', String(binding.generation)],
  ])
    assert.equal(labels['dev.beetle.' + label], value);
  const mounts = row.Mounts;
  assert(Array.isArray(mounts));
  const live = mounts.map(record).find((mount) => mount.Destination === '/beetle/live');
  assert(
    live && live.Type === 'volume' && typeof live.Name === 'string' && /^beetle-[a-f0-9]{64}-live$/.test(live.Name),
  );
  const volume = await transport.request({
    method: 'GET',
    path: '/v1.47/volumes/' + live.Name,
    deadline: performance.now() + 2000,
  });
  assert(volume.ok && volume.status === 200);
  const captured = captureVolume(volume.body);
  verifyLiveVolume({ id: binding.installationId, user: '1000:1000' }, live.Name, captured);
  assert.equal(record(captured.Labels)['dev.beetle.attempt'], binding.attemptId);
  const removed = await transport.request({
    method: 'DELETE',
    path: '/v1.47/containers/' + binding.id + '?force=false',
    deadline: performance.now() + 5000,
  });
  assert(removed.ok && removed.status === 204);
  const erased = await transport.request({
    method: 'DELETE',
    path: '/v1.47/volumes/' + live.Name + '?force=false',
    deadline: performance.now() + 5000,
  });
  assert(erased.ok && erased.status === 204);
  return { containerId: binding.id, liveVolume: live.Name, force: false, fixtureCleanup: true, storageRefund: false };
}
