import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, link, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { exportStandaloneScript } from '../../export/index.js';
import { sealExportScript } from '../../wrapper/artifact-custody/index.js';
import { suite } from '../export/fixtures.js';
import { fixture } from './fixture.js';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
it('seals the actual shared compiler/builder output without invoking a load engine or using a supplied checksum', async () => {
  const f = await fixture(); await rm(f.directory,{recursive:true}); const maximumBuildBytes=2 * 1048576;
  const built=await exportStandaloneScript({suite:suite({embedded:true}),outputDirectory:f.directory,timeoutMs:60000,maximumBuildBytes});
  const job=sealExportScript({...f.input,built,maximumBuildBytes}); const artifact=await job.result; await job.settled;
  expect(artifact).toMatchObject({kind:'standalone-k6-script',relativePath:'standalone/suite.js',bytes:built.bytes,sha256:hash(await readFile(built.scriptPath))});
});
it('handles >2MiB scripts without the old32-read/full-file-buffer path and captures builder scalars before async work', async () => {
  const bytes=Buffer.alloc(3 * 1048576+17,83); const f=await fixture(bytes); const input={...f.input,built:{...f.input.built}};
  const job=sealExportScript(input); input.built.bytes=1; input.built.scriptPath=join(f.root,'foreign'); input.maximumBuildBytes=1;
  const artifact=await job.result; await job.settled; expect(artifact.bytes).toBe(bytes.length); expect(artifact.sha256).toBe(hash(bytes));
});
it.each(['path','peak','uid'] as const)('rejects invalid %s before native file effects', async variant => {
  const f=await fixture(); const input={...f.input,built:{...f.input.built}};
  if (variant==='path') input.built.scriptPath=join(f.outputRoot,'suite.js');
  if (variant==='peak') input.built.peakBytes=input.maximumBuildBytes+1;
  if (variant==='uid') input.uid=-1;
  expect(() => sealExportScript(input)).toThrow(); expect(await readFile(f.scriptPath,'utf8')).toBe('export const options = {};\n');
});
it.each(['symlink','hardlink','mode','length'] as const)('refuses invalid native script custody: %s', async variant => {
  const f=await fixture();
  if (variant==='symlink') {await rm(f.scriptPath); await symlink(join(f.root,'missing'),f.scriptPath);}
  if (variant==='hardlink') await link(f.scriptPath,join(f.root,'second'));
  if (variant==='mode') await chmod(f.scriptPath,0o644);
  const input=variant==='length' ? {...f.input,built:{...f.input.built,bytes:f.input.built.bytes+1}} : f.input;
  const job=sealExportScript(input); await expect(job.result).rejects.toMatchObject({reason:'artifact'}); await job.settled;
});
it('rejects a stopped original without producing or deleting its script', async () => {
  const f=await fixture(); f.fence.stop('cancelled'); const job=sealExportScript(f.input);
  await expect(job.result).rejects.toMatchObject({reason:'cancelled'}); await job.settled; expect(await readFile(f.scriptPath,'utf8')).toBe('export const options = {};\n');
});
