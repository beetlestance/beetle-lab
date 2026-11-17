import { execFileSync } from 'node:child_process';
import { hash } from '../compose/public.js';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, lstat, unlink, rmdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import { readDeliveryJson, readDeliveryBytes, deliveryDigest } from '../../../delivery/files.js';
import { candidate } from '../load/candidate.js';
import { coldOwner } from '../cold/ownership.js';
import { installationOwner } from '../../resources/lifecycle/ownership.js';
import { record } from '../../resources/values.js';
import { readLongReport } from '../soak/report.js';
import { composeProcesses } from '../compose/process.js';
export function environment(text: string) {
  const rows = new Map<string, string>();
  const allowed = new Set([
    'BEETLE_HOME',
    'BEETLE_INSTANCE',
    'BEETLE_PORT',
    'BEETLE_FRONTEND_IMAGE',
    'BEETLE_BACKEND_IMAGE',
    'BEETLE_AGENT_IMAGE',
    'BEETLE_INSTALLER_IMAGE',
    'BEETLE_ENGINE_IMAGE',
    'BEETLE_EXPORT_IMAGE',
    'COMPOSE_PARALLEL_LIMIT',
  ]);
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([A-Z_]+)='([^'\r\n]*)'$/.exec(line);
    assert(match && allowed.has(match[1]!) && !rows.has(match[1]!));
    rows.set(match[1]!, match[2]!);
  }
  assert.equal(rows.size, 10);
  return rows;
}
async function snapshots(home: string, output: string) {
  const results = [];
  for (const [role, relative] of [
    ['backend', 'backend/metadata.sqlite'],
    ['agent', 'agent/journal/journal.sqlite'],
  ] as const) {
    const path = join(home, 'data', relative);
    const before = await deliveryDigest(path, 16777216);
    const target = join(output, 'before-' + role + '.sqlite');
    await copyFile(path, target, constants.COPYFILE_EXCL);
    assert.deepEqual(await deliveryDigest(target, 16777216), before);
    try {
      const wal = await lstat(path + '-wal');
      assert(wal.isFile() && !wal.isSymbolicLink() && wal.nlink === 1 && wal.size === 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    assert.deepEqual(await deliveryDigest(path, 16777216), before);
    results.push({ role, ...before });
  }
  return results;
}
export async function resume(bundlePath: string, evidence: string, output: string, context: string, override: string) {
  const { owner, installation, proof, original, oldRun, artifacts } = await readResumeEvidence(evidence);
  const bound = await candidate(bundlePath, context);
  assert.equal(bound.f.revision, owner.revision);
  assert.deepEqual(bound.f.imageIds, proof.imageIds);
  assert.deepEqual(bound.f.imageIds, original.imageIds);
  const recipe = await readAcceptedRecipe(owner.revision);
  const envPath = join(owner.root, 'compose.env');
  const environmentBytes = await readDeliveryBytes(envPath);
  const env = environment(environmentBytes.toString());
  const instance = env.get('BEETLE_INSTANCE')!;
  assert.equal('beetle-' + instance, owner.project);
  const home = env.get('BEETLE_HOME')!;
  assert.equal(home, join(owner.root, 'home/long-profile'));
  const port = env.get('BEETLE_PORT')!;
  assert(/^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535);
  const origin = 'http://127.0.0.1:' + port;
  const keys = ['FRONTEND', 'BACKEND', 'AGENT', 'INSTALLER', 'ENGINE', 'EXPORT'];
  const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'];
  const images = bound.f.docker.json<{ Id: string }[]>([
    'image',
    'inspect',
    ...keys.map((key) => env.get('BEETLE_' + key + '_IMAGE')!),
  ]);
  images.forEach((image, index) => assert.equal(image.Id, bound.f.imageIds[roles[index]!]));
  const config = record(await readDeliveryJson(join(home, 'data/config/agent.json')));
  assert.equal(record(config.installation).installationId, installation);
  const docker = bound.f.docker;
  const ids = () =>
    docker
      .run(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${owner.project}`])
      .split('\n')
      .filter(Boolean);
  assert.equal(ids().length, 0);
  assert.equal(docker.ownedIds(installation).length, 0);
  const before = await snapshots(home, output);
  const args = [
    'compose',
    '--project-name',
    owner.project,
    '--env-file',
    envPath,
    '--file',
    resolve('docker-compose.yml'),
    '--file',
    join(owner.root, 'target.json'),
    '--file',
    override,
  ];
  const processes = composeProcesses(context, args, owner.root);
  const f = {
    ...bound.f,
    root: owner.root,
    home,
    instance,
    project: owner.project,
    origin,
    agent: `beetle-${instance}-agent`,
    ids,
    ...processes,
  };
  // candidate() created only these two unused template leaves before any containers.
  assert.deepEqual((await readdir(bound.f.root)).sort(), ['compose.env', 'target.json']);
  for (const name of ['compose.env', 'target.json']) await unlink(join(bound.f.root, name));
  await rmdir(bound.f.root);
  assert.deepEqual(await readDeliveryBytes(envPath), environmentBytes);
  return { f, installation, oldRun, artifacts, before, sourceOwner: owner, recipeSha256: hash(recipe) };
}

async function readResumeEvidence(evidence: string) {
  const owner = coldOwner(await readDeliveryJson(join(evidence, 'owner.json')));
  const installation = installationOwner(
    await readDeliveryJson(join(evidence, 'installation-owner.json')),
    owner.project,
  );
  const proof = record(await readLongReport(join(evidence, 'outcome-private.json')));
  assert.equal(proof.status, 'passed');
  assert.equal(proof.cleanupVerified, true);
  assert.equal(proof.sourceRevision, owner.revision);
  assert(typeof proof.sourceTrial === 'string');
  const original = record(await readLongReport(join(proof.sourceTrial, 'outcome-private.json')));
  const checked = validateApi('Run', record(record(original.results).stream).run);
  assert(checked.ok);
  const oldRun = checked.value;
  const final = record(record(proof.results).final);
  assert(Array.isArray(final.artifacts) && final.artifacts.length === 8);

  return { owner, installation, proof, original, oldRun, artifacts: final.artifacts };
}
async function readAcceptedRecipe(revision: string) {
  const recipe = await readDeliveryBytes(resolve('docker-compose.yml'));
  const acceptedRecipe = execFileSync('git', ['show', revision + ':docker-compose.yml'], {
    timeout: 10000,
    maxBuffer: 262144,
  });
  assert.equal(hash(recipe), hash(acceptedRecipe));

  return recipe;
}
