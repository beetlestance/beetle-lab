import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { candidateRoles, maximumArchiveBytes } from '../identity.js';
import type { CandidateRole } from '../identity.js';
import { captureBundle } from '../bundle.js';
import { readDeliveryJson, deliveryDigest } from '../files.js';
import { archiveMember, archiveConfigs } from '../contents.js';
import { RegistryTool } from './tool.js';
import {
  archivePlatformImages,
  captureImageManifest,
  captureRoleIndex,
  verifyImportedConfig,
  object,
} from './descriptors.js';
import type { PlatformImage } from './descriptors.js';
import { registrySources } from './sources.js';
function sourceRunId(value: unknown, revision: string): number {
  const source = object(value);
  if (
    source.revision !== revision ||
    typeof source.runId !== 'number' ||
    !Number.isSafeInteger(source.runId) ||
    source.runId < 1
  )
    throw Error('Source CI identity missing');
  return source.runId;
}
async function stagedInputs(directory: string) {
  const staged = object(await readDeliveryJson(join(directory, 'staged.json')));
  if (
    staged.format !== 'beetle-staged-delivery' ||
    staged.version !== 1 ||
    !Array.isArray(staged.candidates) ||
    staged.candidates.length !== 2
  )
    throw Error('Complete staged candidate required');
  const bundles = staged.candidates.map(captureBundle);
  const revision = bundles[0]!.revision;
  if (new Set(bundles.map((row) => row.architecture)).size !== 2 || bundles.some((row) => row.revision !== revision))
    throw Error('Mixed registry candidate');
  return { bundles, revision, runId: sourceRunId(staged.source, revision) };
}
async function importPlatforms(
  tool: RegistryTool,
  staging: string,
  layout: string,
  bundles: Awaited<ReturnType<typeof stagedInputs>>['bundles'],
) {
  const roles = Object.fromEntries(
    candidateRoles.map<[CandidateRole, PlatformImage[]]>((role) => [role, []]),
  ) as Record<CandidateRole, PlatformImage[]>;
  for (const bundle of bundles) {
    const archive = join(staging, bundle.architecture, 'images', bundle.archive.name);
    const digest = await deliveryDigest(archive, maximumArchiveBytes);
    if (digest.sha256 !== bundle.archive.sha256 || digest.bytes !== bundle.archive.bytes)
      throw Error('Registry source archive hash mismatch');
    const read = archiveMember(archive);
    const configs = archiveConfigs(read, bundle.references, bundle);
    if (candidateRoles.some((role) => configs[role] !== bundle.configs[role]))
      throw Error('Registry source archive config mismatch');
    const images = archivePlatformImages(read, bundle);
    for (const role of candidateRoles) {
      const image = images[role];
      const reference = `ocidir://${layout}@${image.digest}`;
      await tool.command(['image', 'import', reference, archive]);
      captureImageManifest(await tool.raw(['manifest', 'get', reference, '--format', 'raw-body']), image);
      verifyImportedConfig(await tool.raw(['blob', 'get', reference, image.config]), image, bundle.revision);
      roles[role].push(image);
    }
  }
  return roles;
}
async function main(): Promise<void> {
  const [staging, sourceDirectory, output, executable, extra] = process.argv.slice(2);
  if (
    !staging ||
    !sourceDirectory ||
    !output ||
    !executable ||
    extra ||
    ![staging, sourceDirectory, output, executable].every((path) => isAbsolute(path) && path.length <= 4096)
  )
    throw Error('Expected staged, source, new output and pinned tool absolute paths');
  const inputs = await stagedInputs(staging);
  const sources = await registrySources(sourceDirectory, inputs.bundles, inputs.runId);
  await mkdir(output, { mode: 0o700 });
  const tool = await RegistryTool.open(executable, join(output, 'private-tool'));
  const layout = join(output, 'layout');
  const roles = await importPlatforms(tool, staging, layout, inputs.bundles);
  const images = [];
  for (const role of candidateRoles) {
    const reference = `ocidir://${layout}:${role}`;
    const children = roles[role].flatMap((image) => ['--ref', `ocidir://${layout}@${image.digest}`]);
    await tool.command([
      'index',
      'create',
      reference,
      ...children,
      '--annotation',
      `org.opencontainers.image.revision=${inputs.revision}`,
      '--annotation',
      'org.opencontainers.image.source=https://github.com/beetlestance/beetle-lab',
      '--annotation',
      `org.opencontainers.image.documentation=https://github.com/beetlestance/beetle-lab/releases/tag/rewrite-${inputs.revision}-${inputs.runId}`,
      '--annotation',
      `dev.beetlestance.sources=${sources.url}`,
    ]);
    const index = captureRoleIndex(await tool.raw(['manifest', 'get', reference, '--format', 'raw-body']), roles[role]);
    images.push({ role, tag: `rewrite-${inputs.revision}-${inputs.runId}-${role}`, index, platforms: roles[role] });
  }
  await writeFile(
    join(output, 'publication-plan.json'),
    JSON.stringify(
      {
        format: 'beetle-registry-plan',
        version: 1,
        revision: inputs.revision,
        sourceRunId: inputs.runId,
        repository: 'ghcr.io/beetlestance/beetle-lab',
        sources,
        images,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ revision: inputs.revision, platforms: 12, indexes: 6, registryWrites: 0 }));
}
main().catch(() => {
  console.error('Registry plan failed; private partial state is not publication authority.');
  process.exitCode = 1;
});
