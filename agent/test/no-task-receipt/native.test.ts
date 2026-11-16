import { expect,it } from 'vitest';
import { mkdir,readdir,symlink,writeFile } from 'node:fs/promises';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { retirementRoot } from '../../src/staging/index.js';
import { fixture } from './fixtures.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('commits only after real root/marker closes, repeats native proof for exact receipt replay and leaves the root untouched',async()=>{
 const e=await f.ready();const before=await readdir(e.rootPath);const work=e.native.finalizeWithPorts(e.token,operation(),e.ports);
 const first=await work.result;await work.quiesced;expect(first.ok).toBe(true);expect(e.closed).toHaveLength(e.opened.length);
 const calls=e.docker.calls.length;const retry=e.native.finalizeWithPorts(e.token,operation(),e.ports);expect(await retry.result).toEqual(first);await retry.quiesced;
 expect(e.docker.calls.length).toBe(calls*2);expect(e.docker.calls.every(call=>call.method==='GET')).toBe(true);
 expect(await readdir(e.rootPath)).toEqual(before);expect(nativeCustody.status().cleanup).toBe(0);
 const root=retirementRoot(e.options.root);const binding={request:e.request,namespaceIdentity:root.namespaceIdentity,taskName:e.name,daemonId:e.configuration.expectedDaemonId,root:root.native,markerDigest:root.marker.sha256};
 expect(await e.owner.noTaskReceipts.read(binding)).toEqual(first.ok?first.stored:null);
 await expect(e.owner.noTaskReceipts.commit({} as never)).rejects.toBeDefined();
});
it.each(['directory','symlink','file'] as const)('refuses a present %s without deleting or minting a receipt',async kind=>{
 const e=await f.ready();if(kind==='directory')await mkdir(e.task,{mode:0o700});else if(kind==='symlink')await symlink(e.rootPath,e.task);else await writeFile(e.task,'unexpected');
 const work=e.native.finalizeWithPorts(e.token,operation(),e.ports);expect(await work.result).toMatchObject({ok:false});await work.quiesced;
 expect(e.closed.length).toBe(e.opened.length);expect((await readdir(e.rootPath)).includes(e.name)).toBe(true);
});
it.each(['container','volume','daemon'] as const)('refuses conflicting native %s evidence',async kind=>{
 const e=await f.ready();if(kind==='daemon')e.docker.daemonId='other-daemon';else e.docker[kind]=200;
 const work=e.native.finalizeWithPorts(e.token,operation(),e.ports);expect(await work.result).toMatchObject({ok:false});await work.quiesced;
 expect(e.docker.calls.every(call=>call.method==='GET')).toBe(true);
});
it('rechecks native task absence after the actual original root close',async()=>{
 const e=await f.ready();let swapped=false;const ports={...e.ports,filesystem:{...e.ports.filesystem,open:async(...args:Parameters<typeof e.ports.filesystem.open>)=>{
  const handle=await e.ports.filesystem.open(...args);const close=handle.close.bind(handle);
  if(String(args[0])===e.rootPath)handle.close=async()=>{await close();await mkdir(e.task,{mode:0o700});swapped=true;};return handle;
 }}};
 const work=e.native.finalizeWithPorts(e.token,operation(),ports);expect(await work.result).toMatchObject({ok:false});await work.quiesced;expect(swapped).toBe(true);
 expect(e.closed.length).toBe(e.opened.length);
});
