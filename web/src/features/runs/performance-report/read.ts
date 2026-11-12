import { VerifiedArtifactReads } from '../../../lib/verified-artifact.js';
import type { ArtifactReadPorts } from '../../../lib/verified-artifact.js';
export class PerformanceReportReads extends VerifiedArtifactReads<string> {
  constructor(ports?: ArtifactReadPorts) {
    super({kind: 'performance-report', maximumBytes: 262144,
      decode: bytes => new TextDecoder('utf-8', {fatal: true}).decode(bytes)}, ports);
  }
}
export const performanceReportReads = new PerformanceReportReads();
