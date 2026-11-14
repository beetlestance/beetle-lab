const owner = 'tools/qualification/native-application/';
const entrypoints = new Set([
  'app/src/bootstrap/api.js', 'app/src/bootstrap/configuration.js',
  'app/src/ports/events.js', 'app/src/ports/cleanup-control.js',
  'app/src/ports/run-metrics.js', 'app/src/application/run-live-metrics/index.js',
  'app/src/adapters/outbound/runner/index.js', 'app/src/adapters/outbound/sqlite/execution-binding/index.js',
  'app/test/run-live-metrics/fixtures.js', 'app/test/run-results/fixture.js',
  'app/test/runner/fixtures.js', 'app/test/http/run-metrics/fixture.js',
  'agent/src/transport/index.js',
  'agent/src/bootstrap/index.js', 'agent/src/installation-state/index.js',
  'agent/src/journal/index.js', 'agent/src/backends/docker/index.js',
  'engines/k6/wrapper/live-mailbox/index.js',
  'engines/k6/wrapper/export/index.js', 'engines/k6/compiler/suite/index.js',
  'engines/k6/build/index.js', 'agent/src/collection/output/index.js',
  'engines/k6/test/staged-input/fixtures.js',
  'agent/test/container/fixture.js', 'agent/test/container/docker.js',
  'agent/test/container/assertions.js', 'agent/test/catalog/fixtures.js',
  'agent/test/admission/fixtures.js',
]);

const retirementOwner=owner+'retirement/';
const retirementEntrypoints=new Set([
 'app/src/adapters/outbound/sqlite/index.js','app/src/application/output-deletion/index.js',
 'app/src/bootstrap/agent-runtime.js','app/src/ports/output-deletion-metadata.js',
 'agent/src/staging-namespace/index.js','agent/src/cleanup-control/index.js','app/src/bootstrap/output-runtime/index.js',
]);

// Linux seed composes production owners only in this reviewed setup entrypoint.
const seedEntrypoints=new Set(['agent/src/bootstrap/configuration.js','agent/src/staging/index.js',
 'agent/src/guard/index.js','agent/src/timeout/index.js','agent/src/observation/index.js','agent/src/admission/index.js']);
const storageEntrypoints=new Set(['agent/src/journal/schema.js','agent/src/settlement-values/index.js']);
const exactEntrypoints=new Map([[retirementOwner+'no-task-seed.ts',seedEntrypoints],
 [retirementOwner+'settlement-storage.ts',storageEntrypoints],
 [retirementOwner+'retention-storage.ts',new Set(['app/src/domain/retention/index.js'])],
 [retirementOwner+'retention-storage.test.ts',new Set(['app/test/retention/selection-fixture.js',
  'app/src/adapters/outbound/sqlite/retention-manual/index.js','app/src/adapters/outbound/sqlite/retention-apply/index.js',
  'app/src/adapters/outbound/sqlite/retention-progress/index.js'])]]);

/** Cross-service qualification composes named entrypoints outside either service.
 * Service implementations cannot consume the qualification owner in reverse.
 */
export function qualificationBoundary(file: string, resolved: string): boolean | undefined {
  if (resolved.startsWith(owner) && /^(?:app|agent|web|engines)\//.test(file)) return false;
  if (!file.startsWith(owner) || !/^(?:app|agent|web|engines)\//.test(resolved)) return undefined;
  return Boolean(exactEntrypoints.get(file)?.has(resolved))||entrypoints.has(resolved)||(file.startsWith(retirementOwner)&&retirementEntrypoints.has(resolved));
}
