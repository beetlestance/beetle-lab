import {afterEach,expect,it,vi} from 'vitest';
import {exportJob,deferred} from './fixtures.js';
import {readScriptBytes,readVerifiedDownload,maximumExportScriptBytes} from './script-bytes.js';
import type {ExportJob} from '@beetle/contracts/api';
const nativeCrypto=globalThis.crypto;
afterEach(()=>vi.unstubAllGlobals());
const bytes=Uint8Array.from([239,187,191,...new TextEncoder().encode('export default function() {}\n')]);
async function job():Promise<ExportJob>{const hash=await nativeCrypto.subtle.digest('SHA-256',bytes);const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');return {...exportJob(),state:'ready',reason:null,artifact:{artifactId:exportJob().id,name:'suite.js',mediaType:'text/javascript',bytes:bytes.length,sha256:digest}};}
function response(data=bytes){return new Response(data,{headers:{'Content-Length':String(data.length)}});}
it('checks the exact published byte count and digest while retaining original BOM bytes',async()=>{
 vi.stubGlobal('crypto',nativeCrypto);const fetcher=vi.fn<typeof fetch>(async()=>response());vi.stubGlobal('fetch',fetcher);
 expect(await readVerifiedDownload(await job(),new AbortController().signal)).toEqual(bytes);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'same-origin',redirect:'error',cache:'no-store'});
});
it('refuses oversize metadata before IO and refuses truncated or mismatched bytes before a save can exist',async()=>{
 vi.stubGlobal('crypto',nativeCrypto);const fetcher=vi.fn<typeof fetch>(async()=>response());vi.stubGlobal('fetch',fetcher);
 const large=await job();large.artifact!.bytes=maximumExportScriptBytes+1;
 await expect(readVerifiedDownload(large,new AbortController().signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 const wrong=await job();wrong.artifact!.sha256='f'.repeat(64);
 await expect(readVerifiedDownload(wrong,new AbortController().signal)).rejects.toThrow('SHA-256');
 fetcher.mockImplementation(async()=>response(bytes.subarray(1)));
 await expect(readVerifiedDownload(await job(),new AbortController().signal)).rejects.toThrow();
});
it('keeps an aborted fetch original admitted until its response cleanup actually settles',async()=>{
 vi.stubGlobal('crypto',nativeCrypto);const held=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>held.promise));
 const controller=new AbortController();const first=readVerifiedDownload(await job(),controller.signal);controller.abort();
 try{await expect(readVerifiedDownload(await job(),new AbortController().signal)).rejects.toThrow('still finishing');}
 finally{held.resolve(response());await expect(first).rejects.toThrow();}
 vi.stubGlobal('fetch',vi.fn(async()=>response()));expect(await readVerifiedDownload(await job(),new AbortController().signal)).toEqual(bytes);
});
it('keeps an aborted hash original admitted until the digest promise settles',async()=>{
 const held=deferred<ArrayBuffer>();vi.stubGlobal('crypto',{subtle:{digest:vi.fn(()=>held.promise)}});vi.stubGlobal('fetch',vi.fn(async()=>response()));
 const controller=new AbortController();const first=readVerifiedDownload(await job(),controller.signal);
 await vi.waitFor(()=>expect(globalThis.crypto.subtle.digest).toHaveBeenCalled());controller.abort();
 try{await expect(readVerifiedDownload(await job(),new AbortController().signal)).rejects.toThrow('still finishing');}
 finally{held.resolve(new ArrayBuffer(32));await expect(first).rejects.toThrow();}
});
it('captures the publication before awaiting the network and preserves the viewer one-MiB limit',async()=>{
 vi.stubGlobal('crypto',nativeCrypto);const held=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>held.promise));
 const value=await job();const original=readScriptBytes(value,new AbortController().signal,1048576);value.artifact!.sha256='f'.repeat(64);
 held.resolve(response());expect(await original).toEqual(bytes);
 const big=await job();big.artifact!.bytes=1048577;await expect(readScriptBytes(big,new AbortController().signal,1048576)).rejects.toThrow();
});
