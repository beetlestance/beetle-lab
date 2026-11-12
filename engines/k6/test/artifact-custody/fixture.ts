import { afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttemptFence } from '../../wrapper/lifecycle/index.js';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {await Promise.all(cleanups.splice(0).map(clean => clean()));});
export async function fixture(content = Buffer.from('export const options = {};\n')) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'beetle-export-custody-'))); cleanups.push(() => rm(root,{recursive:true,force:true}));
  const outputRoot = join(root,'output'); const directory = join(outputRoot,'standalone'); await mkdir(directory,{recursive:true,mode:0o700}); await chmod(outputRoot,0o700);
  const scriptPath = join(directory,'suite.js'); await writeFile(scriptPath,content,{mode:0o600});
  const fence = new AttemptFence({wall:Date.now,monotonic:()=>performance.now()},new AbortController().signal,10000); cleanups.push(() => fence.dispose());
  return {root,outputRoot,directory,scriptPath,fence,input:{outputRoot,uid:process.getuid!(),built:{scriptPath,bytes:content.length,peakBytes:content.length+512},maximumBuildBytes:content.length+1024,fence}};
}
export function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve=done;}); return {promise,resolve};}
export async function pending(value: Promise<unknown>) {let done=false; void value.then(()=>{done=true;},()=>{done=true;}); await new Promise<void>(resolve => setImmediate(resolve)); return !done;}
