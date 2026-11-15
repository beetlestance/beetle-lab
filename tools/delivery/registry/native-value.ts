import {candidateRoles, imageIdentity} from '../identity.js';
import type {Architecture} from '../identity.js';
import {object} from './descriptors.js';
import {composeEnvironment, planCandidates} from './value.js';
import type {RegistryPlan} from './value.js';
export function installationReferences(environment: Buffer, plan: RegistryPlan): string[] {
  if (environment.toString('utf8') !== composeEnvironment(plan)) throw Error('Installer environment does not match published digests');
  return candidateRoles.map(role => `${plan.repository}@${plan.images.find(image => image.role === role)!.index.digest}`);
}
export function verifyNativeOutcome(input: unknown, plan: RegistryPlan, architecture: Architecture, images: Readonly<Record<string, string>>): void {
  const outcome = object(input);
  verifyNativeIdentity(outcome, plan, architecture);
  const ids = object(outcome.imageIds);
  if (Object.keys(ids).length !== 6 || candidateRoles.some(role => ids[role === 'export' ? 'offline' : role] !== images[role])) throw Error('Native execution image identity changed');
}
function verifyNativeIdentity(outcome: Record<string, unknown>, plan: RegistryPlan, architecture: Architecture): void {
  if (outcome.format !== 'beetle-native-outcome' || outcome.version !== 1 || outcome.status !== 'passed' || outcome.phase !== 'cleanup'
    || outcome.cleanupVerified !== true || outcome.failure !== null || outcome.diagnosis !== null || outcome.revision !== plan.revision || outcome.architecture !== architecture)
    throw Error('Native pulled installation failed');
}
export function verifyLoadedImage(input: unknown, plan: RegistryPlan, role: typeof candidateRoles[number], architecture: Architecture): string {
  const row = object(input); const image = plan.images.find(item => item.role === role)!;
  const native = image.platforms.find(item => item.architecture === architecture)!; const id = imageIdentity(row.Id);
  const labels = object(object(row.Config).Labels);
  if (![image.index.digest, native.digest, native.config].includes(id) || row.Os !== 'linux' || row.Architecture !== architecture
    || labels['org.opencontainers.image.revision'] !== plan.revision) throw Error('Default-store pulled image identity mismatch');
  return id;
}
export function qualificationRecord(plan: RegistryPlan, architecture: Architecture) {
  return {format: 'beetle-anonymous-qualification', version: 1, status: 'passed', revision: plan.revision, sourceRunId: plan.sourceRunId,
    architecture, configs: planCandidates(plan).find(row => row.architecture === architecture)!.configs,
    indexes: Object.fromEntries(plan.images.map(image => [image.role, image.index.digest])), cleanupVerified: true};
}
function equalImages(input: unknown, expected: Readonly<Record<string, string>>): void {
  const images = object(input); const roles = Object.keys(expected);
  if (Object.keys(images).length !== 6 || roles.some(role => images[role] !== expected[role])) throw Error('Anonymous image proof mismatch');
}
export function verifyPullProof(value: unknown, plan: RegistryPlan, architecture: Architecture): void {
  const proof = object(value);
  if (Object.keys(proof).length !== 9 || proof.format !== 'beetle-anonymous-pull' || proof.version !== 1 || proof.status !== 'passed'
    || proof.revision !== plan.revision || proof.sourceRunId !== plan.sourceRunId || proof.architecture !== architecture
    || proof.store !== 'fresh-private-vfs') throw Error('Fresh anonymous pull proof required');
  const expected = qualificationRecord(plan, architecture);
  equalImages(proof.configs, expected.configs); equalImages(proof.indexes, expected.indexes);
}
export function verifyQualification(value: unknown, plan: RegistryPlan, architecture: Architecture): void {
  const proof = object(value);
  if (Object.keys(proof).length !== 9 || proof.format !== 'beetle-anonymous-qualification' || proof.version !== 1 || proof.status !== 'passed'
    || proof.revision !== plan.revision || proof.sourceRunId !== plan.sourceRunId || proof.architecture !== architecture
    || proof.cleanupVerified !== true) throw Error('Anonymous native qualification required');
  const expected = qualificationRecord(plan, architecture);
  equalImages(proof.configs, expected.configs); equalImages(proof.indexes, expected.indexes);
}
