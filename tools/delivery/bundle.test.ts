import {expect,it} from 'vitest';
import {candidateRoles} from './identity.js';
import {captureBundle} from './bundle.js';
import {archiveReferences} from './references.js';
function fixture(){
 const ids=Object.fromEntries(candidateRoles.map((role,index)=>[role,'sha256:'+String(index+1).repeat(64)]));
 return {format:'beetle-qualified-images',version:2,revision:'a'.repeat(40),architecture:'arm64',images:ids,configs:{...ids},
  references:{...archiveReferences('00000000-0000-4000-8000-000000000001')},archive:{name:'images.tar.gz',bytes:100,uncompressedBytes:1000,sha256:'b'.repeat(64)}};
}
it('captures explicit source IDs, canonical config identities and closed role transport refs',()=>{
 const source=fixture();expect(captureBundle(source)).toEqual(source);
});
it.each(['old-version','unknown-field','foreign-ref','role-swap','size','hash','missing-image'] as const)('refuses malformed bundle %s',kind=>{
 const source:Record<string,unknown>=fixture();
 if(kind==='old-version')source.version=1;
 if(kind==='unknown-field')source.untrusted=true;
 if(kind==='foreign-ref')(source.references as Record<string,string>).frontend='ghcr.io/foreign/image:latest';
 if(kind==='role-swap'){const refs=source.references as Record<string,string>;refs.frontend=refs.backend!;}
 if(kind==='size')(source.archive as Record<string,unknown>).bytes=Number.MAX_SAFE_INTEGER;
 if(kind==='hash')(source.archive as Record<string,unknown>).sha256='bad';
 if(kind==='missing-image')delete(source.images as Record<string,string>).frontend;
 expect(()=>captureBundle(source)).toThrow();
});
