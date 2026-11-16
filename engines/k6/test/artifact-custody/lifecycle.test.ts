import * as fs from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { sealExportScript } from '../../wrapper/artifact-custody/index.js';
import { deferred, fixture, pending } from './fixture.js';
vi.mock('node:fs/promises',async importOriginal => {const actual=await importOriginal<typeof fs>(); return {...actual,open:vi.fn(actual.open)};});
afterEach(() => {vi.restoreAllMocks();});
it.each(['file','parent'] as const)('retains the original %s close and prevents success after cancellation', async lane => {
  const f=await fixture(); const hold=deferred(); const entered=deferred(); let closed=false;
  vi.spyOn(fs,'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle=await realFs.open(...args);
    if (args[0] === (lane==='file' ? f.scriptPath : f.directory)) {
      const close=handle.close.bind(handle); handle.close=async () => {entered.resolve(); await hold.promise; await close(); closed=true;};
    }
    return handle;
  });
  const job=sealExportScript(f.input);
  try {
    await entered.promise; expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true); expect(closed).toBe(false);
    if (lane==='parent') f.fence.stop('cancelled');
  } finally {hold.resolve();}
  if (lane==='parent') await expect(job.result).rejects.toMatchObject({reason:'cancelled'}); else expect((await job.result).bytes).toBe(f.input.built.bytes);
  await job.settled; expect(closed).toBe(true);
});
it.each(['file','parent'] as const)('keeps failed %s close explicit and never retries or declares settlement confirmed', async lane => {
  const f=await fixture(); let closes=0;
  vi.spyOn(fs,'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle=await realFs.open(...args);
    if (args[0] === (lane==='file' ? f.scriptPath : f.directory)) {
      const close=handle.close.bind(handle); handle.close=async () => {closes++; await close(); throw new Error('private close canary');};
    }
    return handle;
  });
  const job=sealExportScript(f.input); await expect(job.result).rejects.toMatchObject({reason:'cleanup'});
  await expect(job.settled).rejects.toMatchObject({reason:'cleanup'}); expect(closes).toBe(1);
});
it('reconciles the outer job-root identity after closing the original child directory', async () => {
  const f=await fixture(); let replaced=false;
  vi.spyOn(fs,'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle=await realFs.open(...args);
    if (args[0]===f.directory) {
      const close=handle.close.bind(handle); handle.close=async () => {
        await close(); const moved=join(f.root,'moved-output'); await realFs.rename(f.outputRoot,moved); await realFs.mkdir(f.outputRoot,{mode:0o700});
        await realFs.rename(join(moved,'standalone'),f.directory); replaced=true;
      };
    }
    return handle;
  });
  const job=sealExportScript(f.input); await expect(job.result).rejects.toMatchObject({reason:'artifact'}); await job.settled; expect(replaced).toBe(true);
});
it('rejects bytes mutated after hashing during file sync before declaring a descriptor', async () => {
  const f=await fixture();
  vi.spyOn(fs,'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle=await realFs.open(...args);
    if (args[0]===f.scriptPath) {
      const sync=handle.sync.bind(handle); handle.sync=async () => {await realFs.writeFile(f.scriptPath,Buffer.alloc(f.input.built.bytes,88),{mode:0o600}); await sync();};
    }
    return handle;
  });
  const job=sealExportScript(f.input); await expect(job.result).rejects.toMatchObject({reason:'artifact'}); await job.settled;
});
it('preserves cancellation and confirms actual native cleanup when stopping during an issued file sync', async () => {
  const f=await fixture(); const entered=deferred(); const hold=deferred(); let closes=0;
  vi.spyOn(fs,'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle=await realFs.open(...args); const close=handle.close.bind(handle); handle.close=async () => {await close(); closes++;};
    if (args[0]===f.scriptPath) {const sync=handle.sync.bind(handle); handle.sync=async () => {entered.resolve(); await hold.promise; await sync();};}
    return handle;
  });
  const job=sealExportScript(f.input);
  try {await entered.promise; f.fence.stop('cancelled'); expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);} finally {hold.resolve();}
  await expect(job.result).rejects.toMatchObject({reason:'cancelled'}); await job.settled; expect(closes).toBe(2);
});
it('rejects a root replaced inside the final canonical-path original before it can publish stale identity', async () => {
  const f=await fixture(); let rootReads=0;
  vi.spyOn(fs,'realpath').mockImplementation(async path => {
    const canonical=await realFs.realpath(path);
    if (path===f.outputRoot && ++rootReads===2) {await realFs.rename(f.outputRoot,join(f.root,'late-moved')); await realFs.mkdir(f.outputRoot,{mode:0o700});}
    return canonical;
  });
  const job=sealExportScript(f.input); await expect(job.result).rejects.toMatchObject({reason:'artifact'}); await job.settled;
});
