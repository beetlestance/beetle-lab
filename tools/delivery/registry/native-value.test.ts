import {expect, it} from 'vitest';
import {publicationFixture} from './fixture.js';
import {composeEnvironment, planCandidates} from './value.js';
import {installationReferences, qualificationRecord, verifyQualification, verifyPullProof, verifyNativeOutcome, verifyLoadedImage} from './native-value.js';
it('rejects modified installer fields and binds anonymous proofs to both architecture and complete image sets', () => {
  const {plan} = publicationFixture(); expect(installationReferences(Buffer.from(composeEnvironment(plan)), plan)).toHaveLength(6);
  expect(() => installationReferences(Buffer.from(composeEnvironment(plan) + 'EXTRA=1\n'), plan)).toThrow();
  const passed = qualificationRecord(plan, 'amd64'); expect(() => verifyQualification(passed, plan, 'amd64')).not.toThrow();
  expect(() => verifyQualification(passed, plan, 'arm64')).toThrow();
  const pull = {...passed, format: 'beetle-anonymous-pull', store: 'fresh-private-vfs'};
  delete (pull as Partial<typeof passed>).cleanupVerified;
  expect(() => verifyPullProof(pull, plan, 'amd64')).not.toThrow();
  expect(() => verifyPullProof({...pull, store: 'default'}, plan, 'amd64')).toThrow();
  expect(() => verifyQualification({...passed, configs: {}}, plan, 'amd64')).toThrow('proof mismatch');
});
it('accepts only cryptographically mapped default-store image IDs and clean native execution', () => {
  const {plan} = publicationFixture(); const image = plan.images[0]!; const configs = planCandidates(plan)[0]!.configs;
  const inspected = {Id: image.index.digest, Os: 'linux', Architecture: 'amd64', Config: {Labels: {'org.opencontainers.image.revision': plan.revision}}};
  expect(verifyLoadedImage(inspected, plan, image.role, 'amd64')).toBe(image.index.digest);
  expect(() => verifyLoadedImage({...inspected, Id: 'sha256:' + 'f'.repeat(64)}, plan, image.role, 'amd64')).toThrow();
  const imageIds = Object.fromEntries(Object.entries(configs).map(([role, id]) => [role === 'export' ? 'offline' : role, id]));
  const native = {format: 'beetle-native-outcome', version: 1, status: 'passed', failure: null, phase: 'cleanup', cleanupVerified: true,
    diagnosis: null, revision: plan.revision, architecture: 'amd64', imageIds};
  expect(() => verifyNativeOutcome(native, plan, 'amd64', configs)).not.toThrow();
  expect(() => verifyNativeOutcome({...native, cleanupVerified: false}, plan, 'amd64', configs)).toThrow();
  expect(() => verifyNativeOutcome({...native, imageIds: {...imageIds, offline: configs.frontend}}, plan, 'amd64', configs)).toThrow('identity changed');
});
