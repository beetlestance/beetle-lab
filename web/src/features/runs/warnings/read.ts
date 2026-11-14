import { decodeK6Warnings, K6_WARNING_BYTES } from '@beetle/contracts/k6-warnings';
import type { K6WarningArtifact } from '@beetle/contracts/k6-warnings';
import { VerifiedArtifactReads } from '../../../lib/verified-artifact.js';
import type { ArtifactRead, ArtifactReadPorts } from '../../../lib/verified-artifact.js';
export class WarningReads extends VerifiedArtifactReads<K6WarningArtifact> {
  constructor(ports?: ArtifactReadPorts) { super({kind: 'k6-warnings', maximumBytes: K6_WARNING_BYTES, decode: decodeK6Warnings}, ports); }
  override async read(input: ArtifactRead): Promise<K6WarningArtifact> {
    const {organizationId, workspaceId, attemptId} = input.params;
    const report = await super.read(input);
    const expected = {organizationId, workspaceId, attemptId};
    for (const key of ['organizationId', 'workspaceId', 'attemptId'] as const) {
      if (report.scope[key].toLowerCase() !== expected[key].toLowerCase()) throw new Error('Warning scope mismatch');
    }
    return report;
  }
}
export const warningReads = new WarningReads();
