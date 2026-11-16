import assert from 'node:assert/strict';
import {record} from '../../resources/values.js';
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'];
const kinds = ['k6-diagnostics', 'k6-warnings', 'metric-index', 'metric-windows', 'metrics-csv', 'native-summary', 'numeric-final', 'performance-report'];
function count(value: unknown, maximum: number): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum); return value;
}
export function publicColdOutcome(input: unknown) {
  const source = record(input); const result = record(source.results); const seed = record(result.seed);
  assert(typeof source.revision === 'string' && /^[a-f0-9]{40}$/.test(source.revision));
  assert(source.architecture === 'amd64' || source.architecture === 'arm64');
  const imageIds = images(source.imageIds);
  const artifacts = seed.artifacts; assert(Array.isArray(artifacts) && artifacts.length === 8);
  const descriptors = artifacts.map(item => {const row = record(item); assert(typeof row.kind === 'string' && kinds.includes(row.kind));
    assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256)); return {kind: row.kind, bytes: count(row.bytes, 4194304)};});
  assert.deepEqual(descriptors.map(item => item.kind).sort(), kinds);
  const requests = record(seed.requests); assert.deepEqual(requests, {ready: 1, work: 1, unexpected: 0});
  const viewer = record(result.viewer); assert.equal(viewer.downloadedArtifacts, 8);
  const downloadedBytes = count(viewer.downloadedBytes, 33554432); assert.equal(downloadedBytes, descriptors.reduce((sum, item) => sum + item.bytes, 0));
  const backup = record(result.backup); const files = count(backup.files, 2000); const directories = count(backup.directories, 2000);
  const payloadBytes = count(backup.payloadBytes, 134217728); const manifestBytes = count(backup.manifestBytes, 134217728);
  assert(files > 0 && payloadBytes > 0 && manifestBytes > 0 && backup.controlAllowanceBytes === 65536);
  assert(payloadBytes + manifestBytes + 65536 <= 134217728 && files + directories <= 2000);
  const passed = complete(source, result, viewer);
  return {format: 'beetle-cold-qualification', version: 1, status: passed ? 'passed' : 'failed', sourceRevision: source.revision,
    architecture: source.architecture, imageIds, cleanupVerified: source.cleanupVerified === true,
    downloadedArtifacts: 8, downloadedBytes, backup: {files, directories, payloadBytes, manifestBytes},
    sourceMainFilesUnchanged: result.sourceMainFilesUnchanged === true, metadataUnchanged: result.metadataUnchanged === true,
    completedResumeUnchanged: result.completedResumeUnchanged === true, mutationsRefused: viewer.mutationsRefused === true,
    sessionPersisted: viewer.sessionPersisted === true};
}

function images(input: unknown) {
  const raw = record(input); const output: Record<string, string> = {};
  for (const role of roles) {const id = raw[role]; assert(typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id)); output[role] = id;}
  return output;
}
function complete(source: Record<string, unknown>, result: Record<string, unknown>, viewer: Record<string, unknown>): boolean {
  const preserved = [source.cleanupVerified, result.sourceMainFilesUnchanged, result.metadataUnchanged,
    result.completedResumeUnchanged, viewer.mutationsRefused, viewer.sessionPersisted].every(value => value === true);
  return source.status === 'passed' && source.phase === 'completed-resume' && source.user === '1000:1000'
    && preserved && Array.isArray(result.cleanupFailures) && result.cleanupFailures.length === 0;
}
