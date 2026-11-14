/** Packaged cold-restore/read-only HTTP checks; consumes retained synthetic evidence. */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import { Docker } from '../../../agent/test/container/docker.js';
import { RecoveryIO } from '../../recovery/src/io.js';
import { verifyArchive } from '../../recovery/src/archive.js';
import { copyFile, createDirectory, child } from '../../recovery/src/files.js';
import { ownedOrigin, pause } from './public-api.js';
import { automaticSession, readContent, hash } from './compose/public.js';
import { verifyHistoricalClient } from './recovery.js';
const [image, frontend, source, context = 'desktop-linux'] = process.argv.slice(2);
assert(image && frontend && source && process.argv.length <= 6 && isAbsolute(source) && resolve(source) === source);
assert(/^[a-zA-Z0-9_./:@-]{1,256}$/.test(image) && /^[a-zA-Z0-9_./:@-]{1,256}$/.test(frontend));
assert(/^beetle-agent-evidence-[A-Za-z0-9]+$/.test(source.split('/').at(-1)!));
const raw = await readFile(join(source, 'restart-evidence.json')); assert(raw.length <= 1048576);
const prior = JSON.parse(raw.toString()) as Record<string, unknown>; const run = validateApi('Run', prior.run); assert(run.ok && prior.cleanupVerified);
const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-history-container-')));
const docker = new Docker(context, 2); const id = randomUUID(); const network = 'beetle-history-' + id;
const ingress = 'beetle-history-ingress-' + id;
const backend = 'beetle-history-backend-' + id; const ui = 'beetle-history-frontend-' + id;
const limits = {maximumBytes: 134217728, maximumEntries: 2000}; const uid = process.getuid!(); const gid = process.getgid!();
const images = [image, frontend].map(name => docker.json<{Id: string; Os: string; Architecture: string}[]>(['image','inspect',name])[0]!);
assert(images.every(item => item.Os === 'linux' && item.Architecture === images[0]!.Architecture));
const record: Record<string, unknown> = {status: 'running', priorEvidenceSha256: createHash('sha256').update(raw).digest('hex'), root,
  images: images.map(item => ({id: item.Id, architecture: item.Architecture})), transport: 'actual Linux containers and frontend proxy', cleanupVerified: false, fixtureUser: `${uid}:${gid}`};
console.log(JSON.stringify({status: 'started', root}));
async function clone() {
  const io = new RecoveryIO({signal: new AbortController().signal, deadline: performance.now() + 60000});
  try {
    const archive = await verifyArchive(io, source! + '-archive', limits); await createDirectory(io, join(root, 'archive'));
    for (const entry of archive.entries) {
      const to = child(join(root, 'archive'), entry.path);
      if (entry.kind === 'directory') await createDirectory(io, to);
      else await copyFile(io, child(source! + '-archive', entry.path), to, entry.bytes);
    }
    for (const name of ['manifest.ndjson','archive-control.sqlite']) await copyFile(io, join(source! + '-archive', name), join(root, 'archive', name), 33554432);
  } finally {await io.closeAll();}
}
function cli(path: string) {
  return docker.json<{historyId: string; operationId: string; phase: string}>(['run','--rm','--pull','never','--network','none','--read-only',
    '--cap-drop','ALL','--security-opt','no-new-privileges:true','--cpus','0.5','--memory','256m','--pids-limit','64','--user',`${uid}:${gid}`,
    '--label',`dev.beetle.qualification=${id}`,'--mount',`type=bind,source=${root},target=${root}`,'--entrypoint','node',image!,
    '/beetle/install/recovery.js','--request',path]);
}
try {
  await clone(); const operationId = randomUUID(); const history = join(root, 'history');
  const request = {version: 1, command: 'restore', archive: join(root, 'archive'), destination: history, operationId, limits, timeoutMs: 60000};
  await writeFile(join(root, 'restore.json'), JSON.stringify(request), {mode: 0o600}); record.restored = cli(join(root, 'restore.json'));
  const metadata = join(history, 'data/metadata.sqlite'); const before = createHash('sha256').update(await readFile(metadata)).digest('hex');
  const origin = await ownedOrigin(); const port = new URL(origin).port;
  docker.run(['network','create','--internal','--label',`dev.beetle.qualification=${id}`,network]);
  docker.run(['network','create','--label',`dev.beetle.qualification=${id}`,ingress]);
  docker.run(['run','-d','--pull','never','--name',backend,'--label',`dev.beetle.qualification=${id}`,'--network',network,'--network-alias','backend',
    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--pids-limit','64','--user',`${uid}:${gid}`,
    '--mount',`type=bind,source=${history},target=${history}`,'-e',`BEETLE_HISTORY_ROOT=${history}`,'-e',`BEETLE_HISTORY_EXTERNAL_ORIGIN=${origin}`,
    '-e',`BEETLE_HISTORY_MAXIMUM_BYTES=${limits.maximumBytes}`,'--entrypoint','node',image!, '/beetle/install/history.js']);
  docker.run(['run','-d','--pull','never','--name',ui,'--label',`dev.beetle.qualification=${id}`,'--network',ingress,'--publish',`127.0.0.1:${port}:8080`,
    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--cpus','0.1','--pids-limit','32',
    '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16777216',frontend!]);
  docker.run(['network','connect',network,ui]);
  const client = await automaticSession(origin);
  assert.equal(hash(await readContent(await fetch(origin, {signal: AbortSignal.timeout(3000)}), 1048576)), hash(await readFile('web/dist/index.html'))); record.currentFrontendIndex = true; assert.equal(client.session.readOnly, true); record.reads = await verifyHistoricalClient(client, run.value);
  docker.run(['restart','--time','30',backend]);
  for (let n = 0; n < 80; n++) {const result = await client.api.getBrowserSession(); if (result.ok) {assert.deepEqual(result.value, client.session); record.authRestart = true; break;} await pause();}
  assert(record.authRestart); docker.run(['stop','--time','30',backend]);
  await writeFile(join(root, 'resume.json'), JSON.stringify({...request, resume: true}), {mode: 0o600});
  assert.deepEqual(cli(join(root, 'resume.json')), record.restored);
  assert.equal(createHash('sha256').update(await readFile(metadata)).digest('hex'), before);
  record.metadataUnchanged = true; record.completedResumeUnchanged = true; record.status = 'passed';
} catch (error) {record.status = 'failed'; record.failure = error instanceof Error ? error.message.slice(0, 512) : 'Unknown failure'; process.exitCode = 1;}
finally {
  for (const name of [backend, ui]) {try {const actual = docker.json<{Id: string; State: {Status: string; ExitCode: number}}[]>(['inspect',name])[0]!;
    await writeFile(join(root, name + '-logs.txt'), docker.logs(actual.Id), {mode: 0o600}); record[name === backend ? 'backendState' : 'frontendState'] = actual.State;} catch {record.logCollectionUnavailable = true;}}
  try {docker.cleanup(id); record.cleanupVerified = true;} catch {record.status = 'failed'; process.exitCode = 1;}
  await writeFile(join(root, 'evidence.json'), JSON.stringify(record, null, 2), {mode: 0o600}); console.log(JSON.stringify(record));
}
