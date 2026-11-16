import { runtimeName } from '../../../agent/src/backends/docker/index.js';
import type { DockerTransport } from '../../../agent/src/backends/docker/index.js';
import type { RecoveryOperation } from './types.js';
import { check, RecoveryError } from './types.js';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RecoveryError('not_cold'); return value as Record<string, unknown>;
}
async function get(transport: DockerTransport, path: string, operation: RecoveryOperation): Promise<unknown> {
  check(operation); const response = await transport.request({method: 'GET', path, ...operation}); check(operation);
  if (!response.ok || response.status !== 200) throw new RecoveryError('not_cold'); return response.body;
}
/** Read-only daemon facts under both offline leases; no stop/start/create fallback. */
export async function inspectPhysical(input: {transport: DockerTransport; operation: RecoveryOperation;
  installationId: string; daemonId: string; agentContainer: string; agentImage: string;
  matchRuntime: (input: {attemptId: string; organizationId: string; workspaceId: string; intentDigest: string; imageDigest: string}) => void}) {
  const {transport, operation} = input;
  const info = object(await get(transport, '/v1.47/info', operation));
  if (info.ID !== input.daemonId || !['linux'].includes(String(info.OSType))) throw new RecoveryError('not_cold');
  const agent = object(await get(transport, `/v1.47/containers/${encodeURIComponent(input.agentContainer)}/json`, operation));
  if (agent.Image !== input.agentImage) throw new RecoveryError('not_cold');
  stopped(object(agent.State));
  const filter = encodeURIComponent(JSON.stringify({label: [`dev.beetle.installation=${input.installationId}`]}));
  const engines = await get(transport, `/v1.47/containers/json?all=1&filters=${filter}`, operation);
  if (!Array.isArray(engines) || engines.length > 4096) throw new RecoveryError('not_cold');
  for (const value of engines) {
    const engine = object(value);
    if (engine.Id === agent.Id) continue;
    if (engine.State !== 'exited') throw new RecoveryError('not_cold');
    const labels = object(engine.Labels);
    if (labels['dev.beetle.installation'] !== input.installationId) throw new RecoveryError('not_cold');
    await inspectEngine(input, engine, labels);
  }
  return Object.freeze({daemonId: input.daemonId, stoppedEngines: engines.length});
}

async function inspectEngine(input: Parameters<typeof inspectPhysical>[0], summary: Record<string, unknown>, labels: Record<string, unknown>): Promise<void> {
  if (typeof summary.Id !== 'string' || !/^[a-f0-9]{64}$/.test(summary.Id)) throw new RecoveryError('not_cold');
  const fields = {attemptId: labels['dev.beetle.attempt'], organizationId: labels['dev.beetle.organization'],
    workspaceId: labels['dev.beetle.workspace'], intentDigest: labels['dev.beetle.intent'], imageDigest: summary.ImageID};
  if (!Object.values(fields).every(value => typeof value === 'string') || labels['dev.beetle.generation'] !== '1') throw new RecoveryError('not_cold');
  const key = fields as {attemptId: string; organizationId: string; workspaceId: string; intentDigest: string; imageDigest: string};
  input.matchRuntime(key);
  const native = object(await get(input.transport, `/v1.47/containers/${summary.Id}/json`, input.operation));
  const host = object(native.HostConfig); const restart = object(host.RestartPolicy);
  if (native.Image !== key.imageDigest || native.Name !== '/' + runtimeName({...key, installationId: input.installationId, generation: 1})
) throw new RecoveryError('not_cold');
  stopped(object(native.State));
  if (restart.Name !== 'no' || restart.MaximumRetryCount !== 0 || host.AutoRemove !== false) throw new RecoveryError('not_cold');
}

function stopped(state: Record<string, unknown>): void {
  if (state.Status !== 'exited' || state.Running !== false || state.Restarting !== false || state.Dead !== false || state.Pid !== 0) throw new RecoveryError('not_cold');
}
