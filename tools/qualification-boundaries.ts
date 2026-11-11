const owner = 'tools/qualification/native-application/';
const entrypoints = new Set([
  'app/src/bootstrap/api.js', 'app/src/bootstrap/configuration.js',
  'app/src/ports/events.js',
  'agent/src/bootstrap/index.js', 'agent/src/installation-state/index.js',
  'agent/src/journal/index.js', 'agent/src/backends/docker/index.js',
  'engines/k6/wrapper/live-mailbox/index.js',
  'agent/test/container/fixture.js', 'agent/test/container/docker.js',
  'agent/test/container/assertions.js', 'agent/test/catalog/fixtures.js',
  'agent/test/admission/fixtures.js',
]);

/** Cross-service qualification composes named entrypoints outside either service.
 * Service implementations cannot consume the qualification owner in reverse.
 */
export function qualificationBoundary(file: string, resolved: string): boolean | undefined {
  if (resolved.startsWith(owner) && /^(?:app|agent|web|engines)\//.test(file)) return false;
  if (!file.startsWith(owner) || !/^(?:app|agent|web|engines)\//.test(resolved)) return undefined;
  return entrypoints.has(resolved);
}
