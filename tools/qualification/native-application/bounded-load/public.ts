import assert from 'node:assert/strict';
import { record } from '../../resources/values.js';
import { array, count } from '../conformance/values.js';
import { memoryFacts } from './memory.js';
const requestedOutputBytes = 8388608;
const cleanupAllowanceBytes = 65536;
const originalAllocationBytes = requestedOutputBytes + cleanupAllowanceBytes;
const kinds = [
  'k6-diagnostics',
  'k6-warnings',
  'metric-index',
  'metric-windows',
  'metrics-csv',
  'native-summary',
  'numeric-final',
  'performance-report',
];
function artifacts(input: unknown) {
  const rows = array(input, 8).map((value) => {
    const row = record(value);
    assert(typeof row.kind === 'string' && kinds.includes(row.kind));
    assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
    return { kind: row.kind, bytes: count(row.bytes, 16777216), sha256: row.sha256 };
  });
  assert.deepEqual(rows.map((row) => row.kind).sort(), [...kinds].sort());
  return rows;
}
/** Closed evidence only; private configuration and raw runtime identities stay local. */
export function repeatedFacts(input: unknown) {
  const row = record(input);
  assert.equal(row.unchangedInstallation, true);
  assert.deepEqual(row.settingsAfter, row.settingsBefore);
  const settings = record(row.settingsBefore);
  assert(count(settings.version) > 0);
  const pool = record(record(settings.values).pool);
  assert.equal(pool.outputBytes, 134217728);
  const retained = array(row.retained, 4).map((value) => {
    const item = record(value);
    assert.equal(item.executionReleased, true);
    assert.equal(item.originalAllocationChargedBytes, originalAllocationBytes);
    return {
      executionReleased: true,
      requestedOutputBytes,
      cleanupAllowanceBytes,
      originalAllocationChargedBytes: originalAllocationBytes,
    };
  });
  const trials = array(row.trials, 4).map((value, index) => {
    const trial = record(value);
    const target = record(trial.target);
    assert.equal(target.ready, index + 1);
    assert.equal(target.work, (index + 1) * 400);
    assert.equal(target.unexpected, 0);
    const unique = count(target.unique, 1600);
    assert(unique >= 64);
    const final = record(trial.final);
    assert.equal(final.terminalLiveUnavailable, true);
    return { index, requests: count(target.work, 1600), unique, artifacts: artifacts(final.artifacts) };
  });
  const memory = memoryFacts(row.trials);
  assert(memory.met, 'Repeated memory/latency target missed');
  return { unchangedInstallation: true, retained, trials, memory };
}
