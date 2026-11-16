import {expect, it} from 'vitest';
import {cpuEvidence, pidEvidence, programReport} from './values.js';
it('uses cumulative CPU deltas, the one-core denominator and a bounded period allowance', () => {
  expect(cpuEvidence({elapsedMs: 8000, before: {usage_usec: 1000, nr_throttled: 4}, after: {usage_usec: 8001000, nr_throttled: 80}}))
    .toMatchObject({usedUsec: 8000000, oneCorePercent: 100, throttledPeriods: 76});
  expect(() => cpuEvidence({elapsedMs: 8000, before: {usage_usec: 0, nr_throttled: 0}, after: {usage_usec: 9000000, nr_throttled: 80}})).toThrow();
  expect(() => cpuEvidence({elapsedMs: 8000, before: {usage_usec: 0, nr_throttled: 0}, after: {usage_usec: 8000000, nr_throttled: 0}})).toThrow();
});
it('requires a kernel PID limit event as well as EAGAIN, never just an arbitrary spawn failure', () => {
  expect(pidEvidence({children: 119, refusal: 'EAGAIN', current: 128, before: {max: 0}, after: {max: 1}})).toMatchObject({limitEvents: 1});
  expect(() => pidEvidence({children: 119, refusal: 'EAGAIN', current: 128, before: {max: 0}, after: {max: 0}})).toThrow();
});
it('rejects foreign or unsupported native reports and excessive diagnostic output', () => {
  expect(() => programReport('x'.repeat(65537), 'cpu', 'arm64')).toThrow();
  expect(() => programReport(JSON.stringify({kind: 'cpu', platform: 'linux', architecture: 'amd64'}), 'cpu', 'arm64')).toThrow();
});
it('requires effective controls and kernel security facts on an otherwise valid native report', () => {
  const report = {kind: 'cpu', platform: 'linux', architecture: 'arm64', uid: 1000, node: 'v24.22.3',
    vmMemoryAvailableKiB: 2000000, controls: {cpu: '100000 100000', memory: '536870912', swap: '0', pids: '128'},
    security: {noNewPrivs: 1, capEff: '0000000000000000'}};
  expect(programReport(JSON.stringify(report), 'cpu', 'arm64')).toMatchObject({kind: 'cpu'});
  const amd64 = {...report, architecture: 'amd64'};
  expect(programReport(JSON.stringify(amd64), 'cpu', 'amd64')).toMatchObject({architecture: 'amd64'});
  expect(() => programReport(JSON.stringify(amd64), 'cpu', 'arm64')).toThrow();
  for (const security of [{noNewPrivs: 0, capEff: '0'}, {noNewPrivs: 1, capEff: '1'}]) {
    expect(() => programReport(JSON.stringify({...report, security}), 'cpu', 'arm64')).toThrow();
  }
  expect(() => programReport(JSON.stringify({...report, controls: {...report.controls, swap: 'max'}}), 'cpu', 'arm64')).toThrow();
});
