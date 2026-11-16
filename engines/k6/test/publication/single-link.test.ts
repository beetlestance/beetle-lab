import {lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createPublication} from '../../wrapper/publication/operation.js';
import {clean,fileProxy,input,nodeIo,overrideFile} from './fixtures.js';
it('keeps every visible result file single-linked through writes, sync and actual close',async()=>{
 const options=await input();let scans=0;
 const scan=async()=>{
  for(const name of await readdir(options.directory)){
   const stat=await lstat(join(options.directory,name));
   expect(stat.isFile()).toBe(true);expect(stat.nlink).toBe(1);expect(stat.mode&0o777).toBe(0o600);
  }scans++;
 };
 const io=overrideFile(nodeIo,file=>fileProxy(file,{
  write:async(...args)=>{const value=await file.write(...args);await scan();return value;},
  sync:async()=>{await file.sync();await scan();},close:async()=>{await file.close();await scan();},
 }));
 try{const publication=createPublication(options,io);expect(await publication.result).toMatchObject({ok:true});
  await publication.quiesced;expect(scans).toBeGreaterThanOrEqual(4);
 }finally{await clean(options);}
});
