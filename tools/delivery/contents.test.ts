import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {candidateRoles} from './identity.js';
import {archiveConfigs} from './contents.js';
import {archiveReferences} from './references.js';
import type {ImageReferences} from './references.js';
const sha=(bytes:Buffer)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const revision='a'.repeat(40);const references=archiveReferences('00000000-0000-4000-8000-000000000001');
 const members=new Map<string,Buffer>();const images={} as Record<keyof ImageReferences,string>;
 const entries:unknown[]=[];const manifests:unknown[]=[];
 for(const role of candidateRoles){
  const config=Buffer.from(JSON.stringify({os:'linux',architecture:'arm64',config:{Labels:{'org.opencontainers.image.revision':revision,role}}}));
  const id=sha(config);images[role]=id;const path='blobs/sha256/'+id.slice(7);members.set(path,config);
  entries.push({Config:path,RepoTags:[references[role]],Layers:[]});
  const manifest=Buffer.from(JSON.stringify({config:{digest:id},layers:[]}));const manifestId=sha(manifest);
  members.set('blobs/sha256/'+manifestId.slice(7),manifest);manifests.push({digest:manifestId});
 }
 members.set('manifest.json',Buffer.from(JSON.stringify(entries)));members.set('index.json',Buffer.from(JSON.stringify({manifests})));
 const read=(name:string)=>{const bytes=members.get(name);if(!bytes)throw Error('Missing member');return bytes;};
 return{revision,references,images,members,entries,manifests,read};
}
it('binds six named archive roles to exact config digests and source identities',()=>{
 const f=fixture();expect(archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toEqual(f.images);
});
it('rejects the observed hybrid archive with six legacy entries but only one OCI index entry',()=>{
 const f=fixture();f.members.set('index.json',Buffer.from(JSON.stringify({manifests:f.manifests.slice(0,1)})));
 expect(()=>archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('six images');
});
it.each(['tag','config','source','platform','manifest'] as const)('refuses changed archive %s identity',kind=>{
 const f=fixture();const identity={revision:f.revision,architecture:kind==='platform'?'amd64':'arm64',images:{...f.images}};
 if(kind==='tag')f.members.set('manifest.json',Buffer.from(JSON.stringify(f.entries).replace(f.references.frontend,'unbound:tag')));
 if(kind==='config'){const path='blobs/sha256/'+f.images.frontend.slice(7);f.members.set(path,Buffer.from('{}'));}
 if(kind==='source')identity.images.frontend='sha256:'+'f'.repeat(64);
 if(kind==='manifest'){const row=f.manifests[0] as {digest:string};f.members.set('blobs/sha256/'+row.digest.slice(7),Buffer.from('{}'));}
 expect(()=>archiveConfigs(f.read,f.references,identity)).toThrow();
});
