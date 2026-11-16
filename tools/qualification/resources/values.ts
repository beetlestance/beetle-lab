import assert from 'node:assert/strict';
export function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
export function counter(value: unknown): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); return value;
}
export function programReport(logs: string, kind: string, architecture: string) {
  assert(Buffer.byteLength(logs) <= 65536);
  const matches = logs.split('\n').filter(line => line.startsWith('{')).map(line => record(JSON.parse(line) as unknown)).filter(row => row.kind === kind);
  assert.equal(matches.length, 1); const row = matches[0]!;
  assert.equal(row.platform, 'linux'); assert.equal(row.architecture, architecture); assert.equal(row.uid, 1000);
  assert(typeof row.node === 'string' && row.node.length <= 80); assert.match(row.node, /^v24\.\d+\.\d+(?:[-+A-Za-z0-9.]+)?$/);
  assert(counter(row.vmMemoryAvailableKiB) >= 1572864);
  const security = record(row.security); assert.equal(security.noNewPrivs, 1); assert.match(String(security.capEff), /^0+$/);
  assert.deepEqual(row.controls, {cpu: '100000 100000', memory: '536870912', swap: '0', pids: '128'});
  return row;
}
export function cpuEvidence(row: Record<string, unknown>) {
  const before = record(row.before); const after = record(row.after);
  const elapsedMs = counter(Math.ceil(Number(row.elapsedMs))); assert(elapsedMs >= 8000 && elapsedMs <= 15000);
  const usedUsec = counter(after.usage_usec) - counter(before.usage_usec);
  const throttledPeriods = counter(after.nr_throttled) - counter(before.nr_throttled);
  // One cgroup period plus 50ms accounting tolerance; not a throughput minimum.
  assert(usedUsec >= 0 && usedUsec <= elapsedMs * 1000 + 150000); assert(throttledPeriods > 0);
  return {elapsedMs, usedUsec, oneCorePercent: usedUsec / (elapsedMs * 10), throttledPeriods, accountingAllowanceUsec: 150000};
}
export function pidEvidence(row: Record<string, unknown>) {
  const before = record(row.before); const after = record(row.after);
  assert.equal(row.refusal, 'EAGAIN'); const children = counter(row.children); assert(children > 0 && children <= 160);
  const current = counter(row.current); assert(current <= 128);
  const limitEvents = counter(after.max) - counter(before.max); assert(limitEvents > 0);
  return {children, current, limitEvents, refusal: 'EAGAIN'};
}

export function qualificationArchitecture(host: string, expected?: string): 'amd64' | 'arm64' {
  const architecture = host === 'x64' ? 'amd64' : host;
  assert(architecture === 'amd64' || architecture === 'arm64');
  if (expected !== undefined) assert.equal(architecture, expected, 'Qualification matrix architecture mismatch');
  return architecture;
}
