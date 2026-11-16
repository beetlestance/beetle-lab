import { isExportOutput, outputOwnerId } from '../../../../domain/output-owner/index.js';
import type { OutputBinding } from '../../../../domain/output-owner/index.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
export function outputLocation(record: OutputFileRecord<OutputBinding>) {
  const {key} = record.binding; const attempt = key.attempt;
  const components = [attempt.organizationId, attempt.workspaceId, outputOwnerId(record.binding), attempt.attemptId];
  if (isExportOutput(record.binding)) components.unshift('exports');
  return {components, name: record.artifact.token};
}
