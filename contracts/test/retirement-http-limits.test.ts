import { expect,it,vi } from 'vitest';
import { createHttpTransport,createRunnerClient } from '../src/index.js';
import type { OutputRetirementRequest } from '../src/index.js';
import { fixture } from './fixtures.js';
const request=await fixture('valid/output-retirement-source.json') as OutputRetirementRequest;
const reply=await fixture('valid/output-retirement-reply-source-pending.json');
const baseUrl='http://retirement.synthetic.invalid';
it('sends the exact request and rejects a reply beyond the retirement bound',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply))
  .mockResolvedValueOnce(new Response(' '.repeat(4097)+JSON.stringify(reply)));
 const client=createRunnerClient(createHttpTransport({baseUrl,fetch:fetcher}));
 expect(await client.retireOutput(request.attemptId,request)).toEqual({ok:true,value:reply});
 expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(request);
 expect(await client.retireOutput(request.attemptId,request)).toEqual({ok:false,error:{kind:'response',status:200}});
});
it('refuses oversized retirement requests before fetch and preserves smaller caller limits',async()=>{
 const fetcher=vi.fn<typeof fetch>();
 const client=createRunnerClient(createHttpTransport({baseUrl,fetch:fetcher}));
 expect((await client.retireOutput(request.attemptId,{...request,padding:'x'.repeat(3072)} as OutputRetirementRequest)).ok).toBe(false);
 const limited=createRunnerClient(createHttpTransport({baseUrl,fetch:fetcher,maximumBytes:32}));
 expect(await limited.retireOutput(request.attemptId,request)).toEqual({ok:false,error:{kind:'request'}});
 expect(fetcher).not.toHaveBeenCalled();
});
