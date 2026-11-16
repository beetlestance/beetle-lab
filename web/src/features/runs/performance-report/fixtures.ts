import type { ArtifactRead, ArtifactReadPorts } from '../../../lib/verified-artifact.js';
import { PerformanceReportReads } from './read.js';
export const report = 'Beetle Lab performance report\nOutcome: passed\n<script>evil()</script>\n';
export const params = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003', attemptId: '00000000-0000-4000-8000-000000000004', artifactId: '00000000-0000-4000-8000-000000000005'};
export const bytes = new TextEncoder().encode(report);
export const artifact = {artifactId: params.artifactId, kind: 'performance-report', relativePath: 'performance-report.txt',
  bytes: bytes.length, sha256: '2a26acc321fe43db0e62fd9d998edeb0c26816de2d6415e49d7f2a1209a46d60', sealedAt: '2026-01-01T00:00:00.000Z'};
export function input(): ArtifactRead {return {params: {...params}, artifact: {...artifact}, signal: new AbortController().signal};}
export function reader(ports?: ArtifactReadPorts) {return new PerformanceReportReads(ports);}
export function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};}
