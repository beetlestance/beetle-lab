import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {ComposeHome,homeNative} from '../compose/home.js';
it('keeps directory-enumeration close uncertainty in sticky home drain so the parent cannot release its gate',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'beetle-compose-dir-close-')));await mkdir(join(root,'data'));await writeFile(join(root,'bootstrap.sqlite'),'synthetic');
 const home=new ComposeHome(root,{uid:process.getuid!(),gid:process.getgid!()},{signal:new AbortController().signal,deadline:performance.now()+30000});
 const original=homeNative.opendir;let attempts=0;const cleanup:(()=>Promise<void>)[]=[];
 const spy=vi.spyOn(homeNative,'opendir').mockImplementation(async(...args)=>{const directory=await original(...args);cleanup.push(directory.close.bind(directory));
  Object.defineProperty(directory,'close',{value:async()=>{attempts++;throw Error('Injected directory close uncertainty');}});return directory;});
 try{
  await home.prepare();await expect(home.adopt()).rejects.toMatchObject({code:'cleanup'});
  const drain=home.close();await expect(drain).rejects.toMatchObject({code:'cleanup'});expect(home.close()).toBe(drain);expect(attempts).toBe(1);
 }finally{spy.mockRestore();for(const close of cleanup)await close();await rm(root,{recursive:true,force:true});}
});
