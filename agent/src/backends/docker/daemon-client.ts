import { performance } from 'node:perf_hooks';

import { compatibleVersion, record, supportedDaemon } from './inspect.js';
import type { DockerReply, DockerRequest, DockerTransport, FailureReason, Operation } from './types.js';
export async function qualifyDaemon(
  transport: DockerTransport,
  context: Operation,
  runtime: string,
  daemonId?: string,
): Promise<FailureReason | undefined> {
  const version = await requestDocker(transport, { ...context, method: 'GET', path: '/version' });
  if (!version.ok) return version.reason;
  if (version.status !== 200) return 'unavailable';
  if (!compatibleVersion(version.body)) return 'unsupported';
  const info = await requestDocker(transport, { ...context, method: 'GET', path: '/v1.47/info' });
  return qualifyInfo(info, runtime, daemonId);
}
function qualifyInfo(info: DockerReply, runtime: string, daemonId?: string): FailureReason | undefined {
  if (!info.ok) return info.reason;
  if (info.status !== 200) return 'unavailable';
  if (daemonId !== undefined && record(info.body)?.ID !== daemonId) return 'conflict';
  if (!supportedDaemon(info.body) || record(info.body)?.DefaultRuntime !== runtime) return 'unsupported';
  return undefined;
}
export async function requestDocker(transport: DockerTransport, input: DockerRequest): Promise<DockerReply> {
  if (input.signal?.aborted) return { ok: false, reason: 'aborted', dispatched: false };
  if (performance.now() >= input.deadline) return { ok: false, reason: 'deadline', dispatched: false };
  try {
    const reply = await transport.request(input);
    if (input.signal?.aborted) return { ok: false, reason: 'aborted', dispatched: true };
    if (performance.now() >= input.deadline) return { ok: false, reason: 'deadline', dispatched: true };
    return reply;
  } catch {
    return { ok: false, reason: 'unavailable', dispatched: true };
  }
}
