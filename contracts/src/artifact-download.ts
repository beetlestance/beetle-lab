import { validatePrimitive } from './validate.js';
import type { Artifact } from './generated/types.js';
/** Fixed safe media/extension policy. Engine filenames never become attachment paths. */
export function artifactDownload(artifact: Pick<Artifact, 'artifactId' | 'kind'>) {
  if (!validatePrimitive('uuid', artifact.artifactId).ok) throw new Error('Invalid artifact ID');
  const format = artifactFormat(artifact.kind);
  return {...format, filename: `artifact-${artifact.artifactId.toLowerCase()}.${format.extension}`};
}
function artifactFormat(kind: string) {
  switch (kind) {
    case 'standalone-k6-script': return {contentType: 'text/javascript; charset=utf-8', extension: 'js'};
    case 'performance-report': return {contentType: 'text/plain; charset=utf-8', extension: 'txt'};
    case 'metrics-csv': return {contentType: 'text/csv; charset=utf-8', extension: 'csv'};
    case 'k6-warnings':
    case 'numeric-final': return {contentType: 'application/json; charset=utf-8', extension: 'json'};
    default: return {contentType: 'application/octet-stream', extension: 'bin'};
  }
}
