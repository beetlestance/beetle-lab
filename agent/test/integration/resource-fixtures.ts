import type { DockerReply, DockerTransport } from '../../src/backends/docker/index.js';

/** Synthetic daemon replies; filesystem and observer/guard/journal components remain real. */
export const resourceVersion: DockerReply = { ok: true, status: 200, body: { MinAPIVersion: '1.24', ApiVersion: '1.47' } };
export const resourceInfo: DockerReply = { ok: true, status: 200, body: { ID: 'synthetic-daemon', OSType: 'linux', KernelVersion: '6.6.0',
  NCPU: 14, MemTotal: 16 * 1024 ** 3, MemoryLimit: true, SwapLimit: true, CpuCfsPeriod: true, CpuCfsQuota: true, PidsLimit: true } };
export function resourceTransport(): DockerTransport {
  return { request: async input => input.path === '/version' ? resourceVersion : resourceInfo };
}
