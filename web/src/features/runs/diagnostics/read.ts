import {decodeK6Diagnostics, K6_DIAGNOSTIC_BYTES} from '@beetle/contracts/k6-diagnostics';
import type {K6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import {VerifiedArtifactReads} from '../../../lib/verified-artifact.js';
import type {ArtifactRead, ArtifactReadPorts} from '../../../lib/verified-artifact.js';
export class DiagnosticReads extends VerifiedArtifactReads<K6Diagnostics> {
  constructor(ports?: ArtifactReadPorts) {super({kind: 'k6-diagnostics', maximumBytes: K6_DIAGNOSTIC_BYTES, decode: decodeK6Diagnostics}, ports);}
  override async read(input: ArtifactRead): Promise<K6Diagnostics> {
    const expected = {...input.params}; const report = await super.read(input);
    for (const key of ['organizationId', 'workspaceId', 'attemptId'] as const) {
      if (report.scope[key].toLowerCase() !== expected[key].toLowerCase()) throw new Error('Diagnostic scope mismatch');
    }
    return report;
  }
}
export const diagnosticReads = new DiagnosticReads();
