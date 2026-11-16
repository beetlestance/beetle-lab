import {expect,it} from 'vitest';
import {candidateRoles} from './identity.js';
import {ArchiveNames,archiveReferences} from './references.js';
import type {DockerCommand,ImageReferences} from './references.js';
function fixture(){
 const images=Object.fromEntries(candidateRoles.map((role,index)=>[role,'sha256:'+String(index+1).repeat(64)])) as Record<keyof ImageReferences,string>;
 const refs=new Map<string,string>();const removed:string[]=[];
 const command:DockerCommand=args=>{
  if(args[1]==='ls'){const ref=args[3]!.slice('reference='.length);return Buffer.from(refs.get(ref)??'');}
  if(args[1]==='tag'){refs.set(args[3]!,args[2]!);return Buffer.alloc(0);}
  if(args[1]==='rm'){removed.push(args[2]!);refs.delete(args[2]!);return Buffer.alloc(0);}
  if(args[1]==='inspect'){const ref=args[2]!;const id=refs.get(ref)??ref;return Buffer.from(JSON.stringify([{Id:id,RepoTags:[ref,'original:source']} ]));}
  throw Error('Unexpected Docker command');
 };
 return{images,refs,removed,command};
}
it('creates six owned transport names, verifies IDs and removes only those names',()=>{
 const f=fixture();const names=new ArchiveNames(f.images,f.command);names.create();expect(f.refs.size).toBe(6);names.verify();names.release();
 expect(f.refs.size).toBe(0);expect(f.removed.sort()).toEqual(Object.values(names.references).sort());
});
it('refuses cleanup of a changed reference rather than deleting foreign bindings',()=>{
 const f=fixture();const names=new ArchiveNames(f.images,f.command);names.create();f.refs.set(names.references.frontend,'sha256:'+'f'.repeat(64));
 expect(()=>names.release()).toThrow('Refuse changed');expect(f.removed).toEqual([]);
});
it('refuses a preexisting transport name without tagging over it',()=>{
 const f=fixture();const names=new ArchiveNames(f.images,f.command);f.refs.set(names.references.frontend,'sha256:'+'f'.repeat(64));
 expect(()=>names.create()).toThrow('collision');expect(f.refs.size).toBe(1);
});
it('refuses arbitrary reference namespaces',()=>{
 expect(()=>archiveReferences('foreign/name')).toThrow('nonce');
});
it('retains a transport name when removing it would erase the source image last name',()=>{
 const f=fixture();const command:DockerCommand=args=>{
  const reply=f.command(args);
  if(args[1]==='inspect'){const rows=JSON.parse(reply.toString()) as {RepoTags:string[]}[];rows[0]!.RepoTags=[args[2]!];return Buffer.from(JSON.stringify(rows));}
  return reply;
 };
 const names=new ArchiveNames(f.images,command);names.create();names.release();expect(f.refs.size).toBe(6);expect(f.removed).toEqual([]);
});
it('owns a tag that was created before its command returned an uncertain failure',()=>{
 const f=fixture();let failed=false;const command:DockerCommand=args=>{
  const reply=f.command(args);if(args[1]==='tag'&&!failed){failed=true;throw Error('Lost tag reply');}return reply;
 };
 const names=new ArchiveNames(f.images,command);expect(()=>names.create()).toThrow('Lost tag reply');names.release();
 expect(f.refs.size).toBe(0);expect(f.removed).toEqual([names.references.frontend]);
});
