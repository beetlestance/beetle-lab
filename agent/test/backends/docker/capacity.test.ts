import { describe, expect, it } from 'vitest';
import { daemonResources } from '../../../src/backends/docker/index.js';

const version = () => ({ ok: true, status: 200, body: { ApiVersion: '1.47', MinAPIVersion: '1.24' } });
function info(fields: Record<string, unknown> = {}) {
  return { ok: true, status: 200, body: { ID: 'synthetic-daemon', OSType: 'linux', KernelVersion: '6.6.0',
    MemoryLimit: true, SwapLimit: true, CpuCfsPeriod: true, CpuCfsQuota: true, PidsLimit: true,
    NCPU: 14, MemTotal: 16 * 1024 ** 3, ...fields } };
}
describe('bounded Docker capacity evidence', () => {
  it('reports pinned daemon totals without inferring idle CPU, free memory or physical PIDs', () => {
    expect(daemonResources(version(), info(), 'synthetic-daemon')).toEqual({ ok: true,
      value: { daemonId: 'synthetic-daemon', cpuMillis: 14000, memoryBytes: 16 * 1024 ** 3 } });
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, null, '14'])(
    'rejects unsafe CPU and memory values %j', value => {
      expect(daemonResources(version(), info({ NCPU: value }), 'synthetic-daemon').ok).toBe(false);
      expect(daemonResources(version(), info({ MemTotal: value }), 'synthetic-daemon').ok).toBe(false);
    });
  it.each([{ ID: 'foreign' }, { PidsLimit: false }, { SwapLimit: false }, { OSType: 'windows' }, { KernelVersion: '5.11.0' }])(
    'rejects foreign identity or unsupported controls %j', fields => {
      expect(daemonResources(version(), info(fields), 'synthetic-daemon').ok).toBe(false);
    });
  it('rejects non200, incompatible API, oversized data and accessors before reading them', () => {
    expect(daemonResources({ ...version(), status: 500 }, info(), 'synthetic-daemon').ok).toBe(false);
    expect(daemonResources({ ...version(), body: { ApiVersion: '1.46', MinAPIVersion: '1.24' } }, info(), 'synthetic-daemon').ok).toBe(false);
    expect(daemonResources(version(), info({ extra: 'x'.repeat(1_048_577) }), 'synthetic-daemon').ok).toBe(false);
    let calls = 0;
    expect(daemonResources(version(), { get ok() { calls++; return true; } }, 'synthetic-daemon').ok).toBe(false);
    expect(calls).toBe(0);
  });
});
