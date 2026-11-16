import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {candidateRoles} from './identity.js';
import {archiveConfigs,archiveLocalIds} from './contents.js';
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

it('binds config and containerd manifest IDs per role without accepting foreign manifests',()=>{
 const f=fixture();const ids=archiveLocalIds(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images});
 expect(ids.frontend.config).toBe(f.images.frontend);expect(ids.frontend.manifest).toBe((f.manifests[0] as {digest:string}).digest);
 expect(ids.frontend.manifest).not.toBe(ids.backend.manifest);
 const row=f.manifests[0] as {digest:string};f.members.set('blobs/sha256/'+row.digest.slice(7),Buffer.from('{}'));
 expect(()=>archiveLocalIds(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('hash mismatch');
});

it('confines restored tags to the declared nonce including its canonical Docker Hub spelling',()=>{
 const f=fixture();const row=f.entries[0] as {RepoTags:string[]};row.RepoTags.push('docker.io/'+f.references.frontend);
 f.members.set('manifest.json',Buffer.from(JSON.stringify(f.entries)));
 expect(archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toEqual(f.images);
 row.RepoTags[1]='someone-else/service:latest';f.members.set('manifest.json',Buffer.from(JSON.stringify(f.entries)));
 expect(()=>archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('transport tag');
});

it.each(['io.containerd.image.name', 'org.opencontainers.image.ref.name'])('confines OCI %s annotations to each config-bound role', key=>{
 const f=fixture();const row=f.manifests[0] as {digest:string;annotations?:Record<string,string>};
 row.annotations={[key]:'docker.io/'+f.references.frontend};
 f.members.set('index.json',Buffer.from(JSON.stringify({manifests:f.manifests})));
 expect(archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toEqual(f.images);
 row.annotations[key]=f.references.backend;f.members.set('index.json',Buffer.from(JSON.stringify({manifests:f.manifests})));
 expect(()=>archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('OCI transport name');
});
it('rejects unsupported OCI naming annotations before archive restoration',()=>{
 const f=fixture();(f.manifests[0] as {annotations?:Record<string,string>}).annotations={'other.registry.name':'foreign/service:latest'};
 f.members.set('index.json',Buffer.from(JSON.stringify({manifests:f.manifests})));
 expect(()=>archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('Unsupported archive naming');
});

it('accepts the hybrid tag-only OCI ref only with its exact bound containerd name',()=>{
 const f=fixture();const row=f.manifests[0] as {annotations?:Record<string,string>};
 row.annotations={'io.containerd.image.name':'docker.io/'+f.references.frontend,'org.opencontainers.image.ref.name':'transport'};
 const update=()=>f.members.set('index.json',Buffer.from(JSON.stringify({manifests:f.manifests})));update();
 expect(archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toEqual(f.images);
 delete row.annotations['io.containerd.image.name'];update();
 expect(()=>archiveConfigs(f.read,f.references,{revision:f.revision,architecture:'arm64',images:f.images})).toThrow('OCI transport name');
});
