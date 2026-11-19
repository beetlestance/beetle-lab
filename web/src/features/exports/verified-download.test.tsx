// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,screen,waitFor} from '@testing-library/react';
import type {ExportJob} from '@beetle/contracts/api';
import {environment,exportJob,testClient,deferred} from './fixtures.js';
import {VerifiedExportDownload} from './VerifiedDownload.js';
const OriginalURL=globalThis.URL;
const bytes=Uint8Array.from([239,187,191,...new TextEncoder().encode('export default function() {}\n')]);
const created=vi.fn<(blob:Blob)=>string>();const revoked=vi.fn<(url:string)=>void>();
const saves:{href:string;name:string}[]=[];
function job(id=exportJob().id):ExportJob{return {...exportJob(),id,state:'ready',reason:null,artifact:{artifactId:exportJob().id,name:'suite.js',mediaType:'text/javascript',bytes:bytes.length,sha256:'ab'.repeat(32)}};}
function response(){return new Response(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),{headers:{'Content-Length':String(bytes.length)}});}
beforeEach(()=>{
 saves.length=0;created.mockReset();revoked.mockReset();let next=0;created.mockImplementation(()=>`blob:checked-${++next}`);
 class DownloadURL extends OriginalURL{}
 Object.defineProperty(DownloadURL,'createObjectURL',{value:created});Object.defineProperty(DownloadURL,'revokeObjectURL',{value:revoked});
 vi.stubGlobal('URL',DownloadURL);vi.stubGlobal('crypto',{subtle:{digest:vi.fn(async()=>new Uint8Array(32).fill(171).buffer)}});
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){saves.push({href:this.href,name:this.download});});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(node:React.ReactNode){const api=testClient(()=>{throw Error('Unexpected JSON read')});return environment(api.client).mount(node);}
it('saves only checked original bytes and keeps a verified fallback link without claiming OS success',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>response());vi.stubGlobal('fetch',fetcher);
 const view=mount(<VerifiedExportDownload job={job()}/>);
 expect(fetcher).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Download script'}));
 const link=await screen.findByRole('link',{name:'Save checked script'});expect(link).toHaveAttribute('href','blob:checked-1');
 expect(saves).toEqual([{href:'blob:checked-1',name:'suite.js'}]);
 const original=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>reader.result instanceof ArrayBuffer?resolve(reader.result):reject(Error('Missing file bytes'));reader.readAsArrayBuffer(created.mock.calls[0]![0]);});
 expect(new Uint8Array(original)).toEqual(bytes);
 expect(screen.getByRole('status')).toHaveTextContent('save requested');view.unmount();expect(revoked).toHaveBeenCalledWith('blob:checked-1');
});
it('never offers a save or creates a URL for mismatched bytes',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response()));const wrong=job();wrong.artifact!.sha256='f'.repeat(64);
 mount(<VerifiedExportDownload job={wrong}/>);fireEvent.click(screen.getByRole('button',{name:'Download script'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('SHA-256');expect(created).not.toHaveBeenCalled();expect(saves).toHaveLength(0);
});
it('retires old publication URLs on identity changes and keeps at most one URL across controls',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response()));
 mount(<><VerifiedExportDownload job={job()} label="First"/><VerifiedExportDownload job={job('99999999-9999-4999-8999-999999999999')} label="Second"/></>);
 fireEvent.click(screen.getByRole('button',{name:'First'}));await screen.findByRole('link',{name:'Save checked script'});
 fireEvent.click(screen.getByRole('button',{name:'Second'}));await waitFor(()=>expect(revoked).toHaveBeenCalledWith('blob:checked-1'));
 await waitFor(()=>expect(screen.getByRole('link',{name:'Save checked script'})).toHaveAttribute('href','blob:checked-2'));
 expect(screen.getAllByRole('link',{name:'Save checked script'})).toHaveLength(1);
});
it('aborts on retirement and cannot create a save after an ignored abort finally resolves',async()=>{
 const held=deferred<Response>();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn<typeof fetch>((_url,init)=>{signal=init?.signal as AbortSignal;return held.promise;}));
 const view=mount(<VerifiedExportDownload job={job()}/>);fireEvent.click(screen.getByRole('button',{name:'Download script'}));view.unmount();expect(signal?.aborted).toBe(true);
 await act(async()=>{held.resolve(response());await new Promise(resolve=>setTimeout(resolve,0));});
 expect(created).not.toHaveBeenCalled();expect(saves).toHaveLength(0);
});

it('keeps the checked fallback when automatic saving is refused',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response()));
 vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(()=>{throw Error('Blocked automatic save');});
 mount(<VerifiedExportDownload job={job()}/>);fireEvent.click(screen.getByRole('button',{name:'Download script'}));
 expect(await screen.findByRole('link',{name:'Save checked script'})).toHaveAttribute('href','blob:checked-1');
 expect(screen.getByRole('alert')).toHaveTextContent('Your browser did not start saving');
});
