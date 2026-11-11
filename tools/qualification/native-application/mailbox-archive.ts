import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { UnixDockerTransport } from '../../../agent/src/backends/docker/index.js';
import { captureMailboxImage } from '@beetle/contracts/live-mailbox';

type Docker = (args: string[]) => string;
function absent(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'stderr' in error && /no such (?:object|container|volume)/i.test(String(error.stderr));
}
function argumentsList() {
  const [image, directory, socket, extra] = process.argv.slice(2);
  if (!image || !directory || !socket || extra) throw new Error('Expected cached image, task-owned proof directory and local Unix socket');
  if (!isAbsolute(socket) || !isAbsolute(directory) || directory.includes(',')) throw new Error('Invalid proof paths');
  return {image, directory, socket};
}
function removeOwned(docker: Docker, kind: 'container' | 'volume', target: string, nonce: string): void {
  let value: string;
  try {value = docker(kind === 'container' ? ['inspect', target] : ['volume', 'inspect', target]);}
  catch (error) {
    if (absent(error)) return;
    throw error;
  }
  const entries = JSON.parse(value) as {Id: string; Name: string; Labels?: Record<string, string>; Config?: {Labels: Record<string, string>}}[];
  assert.equal(entries.length, 1); const entry = entries[0]!;
  const labels = kind === 'container' ? entry.Config?.Labels : entry.Labels;
  assert.equal(labels?.['dev.beetle.qualification'], nonce);
  if (kind === 'container') {assert.match(entry.Id, /^[a-f0-9]{64}$/); docker(['rm', '--force', entry.Id]);}
  else {assert.equal(entry.Name, target); docker(['volume', 'rm', target]);}
}
async function main(): Promise<void> {
  const {image, directory, socket} = argumentsList(); assert.equal(await realpath(directory), directory);
  const docker: Docker = args => execFileSync('docker', ['--host', `unix://${socket}`, ...args], {encoding: 'utf8', timeout: 15000, maxBuffer: 1048576}).trim();
  const digest = docker(['image', 'inspect', '--format', '{{.Id}}', image]); assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const nonce = randomUUID(); const name = `beetle-mailbox-archive-${nonce}`; const volume = `${name}-live`;
  try {
    docker(['volume', 'create', '--driver', 'local', '--label', `dev.beetle.qualification=${nonce}`,
      '--opt', 'type=tmpfs', '--opt', 'device=tmpfs', '--opt', 'o=rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=10001,gid=10001,mode=0700', volume]);
    const id = docker(['run', '-d', '--pull', 'never', '--name', name, '--label', `dev.beetle.qualification=${nonce}`,
      '--network', 'none', '--cpus', '0.5', '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '32', '--shm-size', '1m',
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '10001:10001',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=917504,mode=1777',
      '--mount', `type=volume,src=${volume},dst=/beetle/live,volume-nocopy`,
      '--mount', `type=bind,src=${directory},dst=/proof,readonly`, '--entrypoint', 'node', digest, '/proof/producer.mjs']);
    assert.match(id, /^[a-f0-9]{64}$/); const transport = new UnixDockerTransport(socket);
    const deadline = performance.now() + 5000; let reply = await transport.readMailboxArchive({containerId: id, deadline});
    for (let waits = 0; reply.ok && reply.status === 404 && waits < 20; waits++) {
      await delay(100); reply = await transport.readMailboxArchive({containerId: id, deadline});
    }
    if (!reply.ok) throw new Error(`Archive proof failed: ${reply.reason}`);
    if (reply.status !== 200) {
      const state = docker(['inspect', '--format', '{{.State.Status}}/{{.State.ExitCode}}', id]);
      const logs = docker(['logs', '--tail', '10', id]).slice(0, 2000);
      throw new Error(`Archive status ${reply.status}; fixture ${state}; ${logs}`);
    }
    assert.ok(reply.image); const mailbox = captureMailboxImage(reply.image, bytes => createHash('sha256').update(bytes).digest('hex'));
    const source: unknown = JSON.parse(new TextDecoder().decode(mailbox.frame));
    assert.ok(source && typeof source === 'object'); assert.equal(Reflect.get(source, 'kind'), 'mailbox-proof');
    assert.equal(Reflect.get(source, 'platform'), 'linux'); assert.equal(Reflect.get(source, 'uid'), 10001);
    docker(['stop', '--time', '0', id]);
    const stopped = await transport.readMailboxArchive({containerId: id, deadline: performance.now() + 5000});
    assert.equal(stopped.ok, true);
    console.log(JSON.stringify({image: digest, platform: 'linux', architecture: Reflect.get(source, 'architecture'),
      mailboxRevision: mailbox.revision, boundedArchive: true, physicalHttpClose: true,
      archiveStatusAfterStop: stopped.ok ? stopped.status : null}));
  } finally {
    try {removeOwned(docker, 'container', name, nonce);}
    finally {removeOwned(docker, 'volume', volume, nonce);}
  }
}
main().catch((error: unknown) => {console.error(error instanceof Error ? error.message : 'Archive proof failed'); process.exitCode = 1;});
