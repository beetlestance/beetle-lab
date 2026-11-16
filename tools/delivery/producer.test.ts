import {afterEach, expect, it} from 'vitest';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {archiveProducer, ArchiveProducerError} from './producer.js';

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture() {const root = await mkdtemp(join(tmpdir(), 'beetle-archive-producer-')); roots.push(root); return {root, file: join(root, 'archive')};}
it('streams exact bytes through backpressure and refuses to overwrite an existing output', async () => {
  const f = await fixture(); const input = {executable: process.execPath, args: ['-e', 'process.stdout.write(Buffer.alloc(262144,7))'], destination: f.file, maximumBytes: 262144};
  expect(await archiveProducer(input)).toBe(262144); expect((await stat(f.file)).size).toBe(262144);
  await expect(archiveProducer(input)).rejects.toThrow();
  expect((await stat(f.file)).size).toBe(262144);
});
it('stops a flooding producer before writing beyond the ceiling and joins the real close', async () => {
  const f = await fixture(); const pidFile = join(f.root, 'pid');
  const script = "require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});process.stdout.on('error',()=>{});process.stdout.write(Buffer.alloc(1048576));setInterval(()=>{},1000);";
  let failure: unknown;
  try {await archiveProducer({executable: process.execPath, args: ['-e', script, pidFile], destination: f.file, maximumBytes: 1024});}
  catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ArchiveProducerError); expect(failure).toMatchObject({kind: 'limit', exit: {signal: 'SIGKILL'}});
  expect((await stat(f.file)).size).toBeLessThanOrEqual(1024);
  const pid = Number(await readFile(pidFile, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
});
it('enforces the producer deadline, escalates an ignored TERM and joins before failure', async () => {
  const f = await fixture(); const pidFile = join(f.root, 'pid');
  const script = "require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);";
  await expect(archiveProducer({executable: process.execPath, args: ['-e', script, pidFile], destination: f.file, maximumBytes: 1024, timeoutMs: 1000}))
    .rejects.toMatchObject({kind: 'timeout', exit: {signal: 'SIGKILL'}});
  const pid = Number(await readFile(pidFile, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
});
it('does not certify nonzero-exit output and retains a private partial file', async () => {
  const f = await fixture();
  await expect(archiveProducer({executable: process.execPath, args: ['-e', 'process.stdout.write("partial");process.exitCode=7;'], destination: f.file, maximumBytes: 1024}))
    .rejects.toMatchObject({kind: 'exit', exit: {code: 7}});
  expect(await readFile(f.file, 'utf8')).toBe('partial');
});
it('bounds stderr without exposing its content in the producer failure', async () => {
  const f = await fixture(); let failure: unknown;
  try {await archiveProducer({executable: process.execPath,
    args: ['-e', 'process.stderr.write("SYNTHETIC_SECRET".repeat(10000));setInterval(()=>{},1000);'], destination: f.file, maximumBytes: 1024});}
  catch (error) {failure = error;}
  expect(failure).toMatchObject({kind: 'stderr'}); expect(String(failure)).not.toContain('SYNTHETIC_SECRET');
});
