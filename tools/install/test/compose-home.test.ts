import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,chmod,stat,rename,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {ComposeHome,homeNative} from '../compose/home.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const parent=await realpath(await mkdtemp(join(tmpdir(),'beetle-compose-home-')));roots.push(parent);const path=join(parent,'home');await mkdir(path,{mode:0o700});
 const identity={uid:process.getuid!(),gid:process.getgid!()};const context={signal:new AbortController().signal,deadline:performance.now()+30000};
 return {parent,path,identity,context,home:new ComposeHome(path,identity,context)};
}
it('preserves an already-private home without changing ownership, mode or data',async()=>{
 const e=await fixture();await mkdir(join(e.path,'data'));await writeFile(join(e.path,'bootstrap.sqlite'),'synthetic');const before=await stat(e.path);
 try{await e.home.prepare();expect(await e.home.adopt()).toBe(false);const after=await stat(e.path);expect([after.uid,after.gid,after.mode]).toEqual([before.uid,before.gid,before.mode]);}
 finally{await e.home.close();}
});
it('refuses an unrelated non-Docker-created empty skeleton without permission repair',async()=>{
 const e=await fixture();await chmod(e.path,0o755);await mkdir(join(e.path,'data'));const before=await stat(e.path);
 // Normal test runners are non-root; actual root-created positive preparation is a native container check.
 if(before.uid===0){await chmod(e.path,0o777);}
 try{await expect(e.home.prepare()).rejects.toMatchObject({code:'unsafe_root'});const after=await stat(e.path);expect(after.uid).toBe(before.uid);expect(after.mode&0o777).toBe(before.uid===0?0o777:0o755);}
 finally{await e.home.close();}
});
it('rejects root substitution between capture and identity adoption',async()=>{
 const e=await fixture();try{await e.home.prepare();await rename(e.path,join(e.parent,'original'));await mkdir(e.path,{mode:0o700});
  await expect(e.home.adopt()).rejects.toMatchObject({code:'unsafe_root'});
 }finally{await e.home.close();}
});
it('rejects symlink roots and partial private layouts',async()=>{
 const e=await fixture();const link=join(e.parent,'link');await symlink(e.path,link);
 const linked=new ComposeHome(link,e.identity,e.context);try{await expect(linked.prepare()).rejects.toMatchObject({code:'unsafe_root'});}finally{await linked.close();}
 await mkdir(join(e.path,'data'));try{await e.home.prepare();await expect(e.home.adopt()).rejects.toMatchObject({code:'unsafe_root'});}finally{await e.home.close();}
});

it('keeps uncertain descriptor close sticky without retrying its original',async()=>{
 const e=await fixture();await mkdir(join(e.path,'data'));await writeFile(join(e.path,'bootstrap.sqlite'),'synthetic');
 const original=homeNative.open;let calls=0;const cleanup:(()=>Promise<void>)[]=[];
 const spy=vi.spyOn(homeNative,'open').mockImplementation(async(...args)=>{const handle=await original(...args);cleanup.push(handle.close.bind(handle));
  Object.defineProperty(handle,'close',{value:async()=>{calls++;throw Error('Injected close uncertainty');}});return handle;});
 try{await e.home.prepare();await e.home.adopt();const close=e.home.close();await expect(close).rejects.toMatchObject({code:'cleanup'});
  expect(e.home.close()).toBe(close);await expect(e.home.close()).rejects.toMatchObject({code:'cleanup'});expect(calls).toBe(1);
 }finally{spy.mockRestore();for(const close of cleanup)await close();}
});
