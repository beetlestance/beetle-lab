import { decodeTargetRuntimeReport, TARGET_RUNTIME_REPORT_BYTES } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { VerifiedArtifactReads } from '../../../lib/verified-artifact.js';
import type { ArtifactReadPorts } from '../../../lib/verified-artifact.js';
export type { ArtifactRead as TargetRead, ArtifactReadPorts as TargetReadPorts } from '../../../lib/verified-artifact.js';
/** Target decoding uses the shared original-call, body, integrity and deadline owner. */
export class TargetReportReads extends VerifiedArtifactReads<TargetRuntimeReport> {
  constructor(ports?: ArtifactReadPorts) {
    super({kind: 'target-runtime', maximumBytes: TARGET_RUNTIME_REPORT_BYTES, decode: decodeTargetRuntimeReport}, ports);
  }
}
export const targetReportReads = new TargetReportReads();
