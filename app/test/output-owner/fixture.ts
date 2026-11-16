import type {ExportOutputBinding} from '../../src/domain/output-owner/index.js';
import {record,id} from '../files/output-bytes/fixture.js';
export function exportBinding(): ExportOutputBinding {
 const run=record().binding;
 return {purpose:'standalone_export',key:{exportId:id(3),attempt:run.key.attempt},journalAuthority:run.journalAuthority,
 expectation:{exportId:id(3),attemptId:run.key.attempt.attemptId,organizationId:run.key.attempt.organizationId,
 workspaceId:run.key.attempt.workspaceId,assignmentDigest:'c'.repeat(64),maximumBuildBytes:1048576}};
}
