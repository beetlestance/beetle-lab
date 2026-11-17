export const candidateRoles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
export type CandidateRole = (typeof candidateRoles)[number];
export type Architecture = 'amd64' | 'arm64';
export const maximumArchiveBytes = 3 * 1024 ** 3;
/** GitHub's ZIP envelope is distinct from the bounded images.tar.gz payload. */
export const maximumArtifactZipBytes = maximumArchiveBytes + 1024 ** 2;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Candidate identity object required');
  return value as Record<string, unknown>;
}
export function revisionIdentity(value: string): string {
  if (value.length !== 40 || !/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid candidate revision');
  return value;
}
export function architectureIdentity(value: string): Architecture {
  if (value !== 'amd64' && value !== 'arm64') throw new Error('Invalid candidate architecture');
  return value;
}
export function imageIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid candidate image ID');
  return value;
}
function qualifiedOutcome(input: unknown, revision: string, architecture: Architecture) {
  const outcome = object(input);
  if (
    outcome.format !== 'beetle-native-outcome' ||
    outcome.version !== 1 ||
    outcome.status !== 'passed' ||
    outcome.cleanupVerified !== true ||
    outcome.phase !== 'cleanup' ||
    outcome.diagnosis !== null ||
    outcome.revision !== revision ||
    outcome.architecture !== architecture
  )
    throw new Error('Native candidate was not qualified');
  const images = object(outcome.imageIds);
  if (Object.keys(images).length !== 6) throw new Error('Incomplete native image identities');
  return images;
}
function inspectedImage(input: unknown, revision: string, architecture: Architecture): string {
  if (!Array.isArray(input) || input.length !== 1) throw new Error('One inspected candidate image required');
  const image = object(input[0]);
  const labels = object(object(image.Config).Labels);
  if (
    image.Os !== 'linux' ||
    image.Architecture !== architecture ||
    labels['org.opencontainers.image.revision'] !== revision
  )
    throw new Error('Inspected candidate identity mismatch');
  if (
    typeof image.Size !== 'number' ||
    !Number.isSafeInteger(image.Size) ||
    image.Size <= 0 ||
    image.Size > 500_000_000
  )
    throw new Error('Candidate image size bound');
  return imageIdentity(image.Id);
}
/** Bounded, parsed JSON only. Bind archives to both successful execution and scans. */
export function captureQualifiedImages(revision: string, architecture: string, outcome: unknown, inspections: unknown) {
  revisionIdentity(revision);
  const arch = architectureIdentity(architecture);
  const native = qualifiedOutcome(outcome, revision, arch);
  const records = object(inspections);
  if (Object.keys(records).length !== 6) throw new Error('Six scanned candidate identities required');
  const images = Object.fromEntries(
    candidateRoles.map((role) => {
      const id = inspectedImage(records[role], revision, arch);
      if (id !== imageIdentity(native[role === 'export' ? 'offline' : role]))
        throw new Error('Tested and scanned image differ');
      return [role, id];
    }),
  ) as Record<CandidateRole, string>;
  return { format: 'beetle-qualified-images', version: 1, revision, architecture: arch, images } as const;
}
