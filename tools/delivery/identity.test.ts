import {expect, it} from 'vitest';
import {candidateRoles, captureQualifiedImages} from './identity.js';
import type {CandidateRole} from './identity.js';

const revision = 'a'.repeat(40);
interface Inspection {Id: string; Os: string; Architecture: string; Size: number; Config: {Labels: Record<string, string>}}
function fixture() {
  const ids = Object.fromEntries(candidateRoles.map((role, index) => [role, `sha256:${String(index + 1).repeat(64)}`])) as Record<CandidateRole, string>;
  const inspections: Record<string, Inspection[]> = Object.fromEntries(candidateRoles.map(role => [role, [{Id: ids[role], Os: 'linux', Architecture: 'arm64', Size: 100,
    Config: {Labels: {'org.opencontainers.image.revision': revision}}}]]));
  const outcome = {format: 'beetle-native-outcome', version: 1, revision, architecture: 'arm64', status: 'passed', phase: 'cleanup', cleanupVerified: true,
    diagnosis: null, imageIds: {frontend: ids.frontend, backend: ids.backend, agent: ids.agent, installer: ids.installer, engine: ids.engine, offline: ids.export}};
  return {ids, outcome, inspections};
}
it('binds every archive role to the exact executed and scanned ID, including offline export', () => {
  const f = fixture(); const bundle = captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections);
  expect(bundle.images).toEqual(f.ids); expect(bundle.images.export).toBe(f.outcome.imageIds.offline);
  f.outcome.imageIds.offline = f.ids.engine;
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow('Tested and scanned image differ');
});
it.each(['failed', 'running'])('refuses a %s native outcome despite matching image labels', status => {
  const f = fixture(); f.outcome.status = status;
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow('not qualified');
});
it('refuses incomplete cleanup and mixed revisions or architectures', () => {
  const f = fixture(); f.outcome.cleanupVerified = false;
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow();
  f.outcome.cleanupVerified = true; f.inspections.backend![0]!.Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow();
  f.inspections.backend![0]!.Config.Labels['org.opencontainers.image.revision'] = revision;
  f.inspections.backend![0]!.Architecture = 'amd64';
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow();
});
it('refuses a substituted image with the correct revision label', () => {
  const f = fixture(); f.inspections.agent![0]!.Id = `sha256:${'f'.repeat(64)}`;
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow('Tested and scanned image differ');
});
it('refuses missing scan files, extra roles and oversized images before archive work', () => {
  const f = fixture();
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, {...f.inspections, extra: []})).toThrow();
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, {...f.inspections, frontend: undefined})).toThrow();
  f.inspections.frontend![0]!.Size = 500_000_001;
  expect(() => captureQualifiedImages(revision, 'arm64', f.outcome, f.inspections)).toThrow('size bound');
});
it.each([['a'.repeat(40) + '\n', 'arm64'], [revision, 'arm64\n'], ['latest', 'amd64']])('rejects noncanonical source/architecture %j/%j', (source, arch) => {
  const f = fixture(); expect(() => captureQualifiedImages(source!, arch!, f.outcome, f.inspections)).toThrow();
});
