import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { capturePublishedPlan, planCandidates } from './value.js';
import { object } from './descriptors.js';
import { readDeliveryJson } from '../files.js';
import { privateDocker, verifyPrivateStore } from '../private-store.js';
import { archiveProducer } from '../producer.js';
import { architectureIdentity } from '../identity.js';
import type { RegistryPlan } from './value.js';
import type { Architecture, CandidateRole } from '../identity.js';
function argumentsFor(argv: string[]) {
  const [publication, output, socket, store, extra] = argv;
  if (
    !publication ||
    !output ||
    !socket ||
    !store ||
    extra ||
    ![publication, output, store].every(isAbsolute) ||
    !/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(socket)
  )
    throw Error('Expected publication, new output, private socket and store');
  return { publication, output, socket, store };
}
function verifyPulled(rows: unknown, plan: RegistryPlan, role: CandidateRole, architecture: Architecture): void {
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('Pulled image inspection required');
  const value = object(rows[0]);
  const labels = object(object(value.Config).Labels);
  const config = planCandidates(plan).find((row) => row.architecture === architecture)!.configs[role];
  if (
    value.Id !== config ||
    value.Os !== 'linux' ||
    value.Architecture !== architecture ||
    labels['org.opencontainers.image.revision'] !== plan.revision
  )
    throw Error('Anonymous pulled config mismatch');
}
async function main(): Promise<void> {
  const { publication, output, socket, store } = argumentsFor(process.argv.slice(2));
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const architecture = architectureIdentity(process.arch === 'x64' ? 'amd64' : process.arch);
  await mkdir(output, { mode: 0o700 });
  const config = join(output, 'empty-docker');
  await mkdir(config, { mode: 0o700 });
  await writeFile(join(config, 'config.json'), '{}', { flag: 'wx', mode: 0o600 });
  const command = privateDocker(socket, config);
  verifyPrivateStore(command, { root: store, architecture });
  const candidate = planCandidates(plan).find((item) => item.architecture === architecture)!;
  for (const image of plan.images) {
    const reference = `${plan.repository}@${image.index.digest}`;
    await archiveProducer({
      executable: 'docker',
      args: ['--host', socket, '--config', config, 'image', 'pull', '--quiet', reference],
      destination: join(output, `${image.role}-pull.log`),
      maximumBytes: 65536,
    });
    const rows: unknown = JSON.parse(command(['image', 'inspect', reference]).toString('utf8'));
    verifyPulled(rows, plan, image.role, architecture);
  }
  await writeFile(
    join(output, 'pull.json'),
    JSON.stringify(
      {
        format: 'beetle-anonymous-pull',
        version: 1,
        status: 'passed',
        revision: plan.revision,
        sourceRunId: plan.sourceRunId,
        architecture,
        configs: candidate.configs,
        indexes: Object.fromEntries(plan.images.map((image) => [image.role, image.index.digest])),
        store: 'fresh-private-vfs',
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ anonymous: true, architecture, verifiedImages: 6 }));
}
main().catch(() => {
  console.error('Anonymous fresh-store pull failed; image availability is not qualified.');
  process.exitCode = 1;
});
