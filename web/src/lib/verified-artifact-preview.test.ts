import { expect, it } from 'vitest';
import { VerifiedArtifactReads } from './verified-artifact.js';
import type { ArtifactReadPorts } from './verified-artifact.js';
import { artifactPreview, previewLimit } from '../features/runs/artifacts/preview.js';
const id='11111111-1111-4111-8111-111111111111';
async function digest(bytes:Uint8Array){
 const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function selection(bytes:Uint8Array,signal=new AbortController().signal){return {
 params:{organizationId:id,workspaceId:id,runId:id,attemptId:id,artifactId:id},signal,
 artifact:{artifactId:id,kind:'metric-windows',relativePath:'metric-windows.ndjson',sealedAt:'2026-11-19T00:00:00Z',bytes:bytes.length,sha256:await digest(bytes)},
};}
function ports(bytes:Uint8Array<ArrayBuffer>):ArtifactReadPorts{return {fetch:async()=>new Response(bytes),digest:async value=>digest(value),monotonic:()=>0};}
const policy={kind:'metric-windows',profile:'artifact-preview' as const,maximumBytes:32*1048576,decode:artifactPreview};
it('requires the explicit profile and refuses above 32MiB without issuing I/O',async()=>{
 const ordinary={kind:policy.kind,maximumBytes:policy.maximumBytes,decode:policy.decode};
 expect(()=>new VerifiedArtifactReads(ordinary)).toThrow();
 expect(()=>new VerifiedArtifactReads({...policy,maximumBytes:32*1048576+1})).toThrow();
 const data=new Uint8Array([65]);let calls=0;
 const reader=new VerifiedArtifactReads(policy,{...ports(data),fetch:async()=>{calls++;return new Response(data)}});
 await expect(reader.read({...await selection(data),artifact:{...(await selection(data)).artifact,bytes:32*1048576+1}})).rejects.toThrow();
 expect(calls).toBe(0);
});
it('verifies the whole artifact over 1MiB, displays only the prefix and rejects corruption past it',async()=>{
 const data=new Uint8Array(1048577).fill(65);const input=await selection(data);
 expect((await new VerifiedArtifactReads(policy,ports(data)).read(input)).length).toBe(previewLimit);
 const corrupted=data.slice();corrupted[corrupted.length-1]=66;
 await expect(new VerifiedArtifactReads(policy,ports(corrupted)).read(input)).rejects.toThrow('integrity mismatch');
});
it('shares existing two-original admission and retains an ignored hash after retirement',async()=>{
 const data=new Uint8Array([65]);let finish!:()=>void;
 const held=new Promise<void>(resolve=>{finish=resolve});let hashing=0;
 const reader=new VerifiedArtifactReads(policy,{...ports(data),digest:async value=>{hashing++;await held;return digest(value)}});
 const controller=new AbortController();
 const first=reader.read(await selection(data,controller.signal));const second=reader.read(await selection(data,controller.signal));
 const stopped=Promise.allSettled([first,second]);
 for(let i=0;i<20&&hashing!==2;i++)await new Promise(resolve=>setTimeout(resolve,1));
 expect(hashing).toBe(2);controller.abort();
 await expect(reader.read(await selection(data))).rejects.toThrow('capacity unavailable');
 finish();expect((await stopped).every(reply=>reply.status==='rejected')).toBe(true);
 await expect(new VerifiedArtifactReads(policy,ports(data)).read(await selection(data))).resolves.toBe('A');
});
