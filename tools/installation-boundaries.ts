const owner = 'tools/install/';
const entrypoints = new Set([
  'agent/src/bootstrap/index.js', 'agent/src/installation-state/index.js',
  'agent/src/journal/index.js', 'agent/src/catalog/index.js',
  'agent/src/admission/index.js', 'agent/src/backends/docker/index.js',
  'app/src/bootstrap/configuration.js',
]);
/** Privileged offline composition only; runtime services cannot import installers. */
export function installationBoundary(file: string, resolved: string): boolean | undefined {
  if (resolved.startsWith(owner) && /^(?:app|agent|web|engines)\//.test(file)) return false;
  if (!file.startsWith(owner) || !/^(?:app|agent|web|engines)\//.test(resolved)) return undefined;
  return entrypoints.has(resolved);
}
