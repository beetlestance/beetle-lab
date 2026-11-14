const owners = ['tools/install/', 'tools/recovery/'];
const entrypoints = new Set([
  'agent/src/bootstrap/index.js', 'agent/src/installation-state/index.js',
  'agent/src/journal/index.js', 'agent/src/catalog/index.js',
  'agent/src/admission/index.js', 'agent/src/backends/docker/index.js',
  'app/src/bootstrap/api.js', 'app/src/bootstrap/historical.js', 'app/src/bootstrap/configuration.js', 'app/src/adapters/outbound/sqlite/index.js',
  'app/src/adapters/outbound/sqlite/cold-inspection/index.js', 'agent/src/journal/cold-inspection/index.js',
  'app/src/adapters/outbound/files/outputs/index.js','app/src/adapters/outbound/files/inputs/index.js', 'app/src/bootstrap/recovery-control/index.js',
]);
/** Privileged offline composition only; runtime services cannot import installers. */
export function installationBoundary(file: string, resolved: string): boolean | undefined {
  if (file.startsWith('tools/recovery/test/') && resolved === 'app/test/storage/fixture.js') return true;
  if (owners.some(owner => resolved.startsWith(owner)) && /^(?:app|agent|web|engines)\//.test(file)) return false;
  if (!owners.some(owner => file.startsWith(owner)) || !/^(?:app|agent|web|engines)\//.test(resolved)) return undefined;
  return entrypoints.has(resolved);
}
