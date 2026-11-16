import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {debt} from './backend.js';
import {inventory} from './files.js';
it('uses authoritative credits for current debt rather than summing historical allocations',()=>{
 expect(debt(33816576,33064679,262144,0,1014041).currentChargedBytes).toBe(1014041);
 expect(()=>debt(33816576,33064679,262144,0,33816576)).toThrow();
 expect(()=>debt(1,2,0,0,0)).toThrow();
});
it('bounds file enumeration and hashes empty files without following symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'beetle-cold-accounting-'));try{
  await writeFile(join(root,'empty'),'');const budget={entries:0,bytes:0,deadline:performance.now()+1000};
  expect((await inventory(root,budget)).files.get('empty')).toEqual({bytes:0,sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'});
  await expect(inventory(root,{entries:1024,bytes:0,deadline:performance.now()+1000})).rejects.toThrow();
  await symlink('empty',join(root,'alias'));await expect(inventory(root,{entries:0,bytes:0,deadline:performance.now()+1000})).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
