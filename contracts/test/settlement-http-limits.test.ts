import { expect,it,vi } from 'vitest';
import { createHttpTransport,createRunnerClient } from '../src/index.js';
import type { OutputSettlementRequest } from '../src/index.js';
import { fixture } from './fixtures.js';
const request=await fixture('valid/output-settlement-request.json') as OutputSettlementRequest;
const reply=await fixture('valid/output-settlement-reply.json');
const baseUrl='http://settlement.synthetic.invalid';
it('uses the generated settlement route and enforces request/reply bounds',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply))
  .mockResolvedValueOnce(new Response(' '.repeat(513)+JSON.stringify(reply)));
 const client=createRunnerClient(createHttpTransport({baseUrl,fetch:fetcher}));
 expect(await client.settleOutput(request.retirement.attemptId,request)).toEqual({ok:true,value:reply});
 expect(String(fetcher.mock.calls[0]![0])).toContain('/output-settlement');
 expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(request);
 expect(await client.settleOutput(request.retirement.attemptId,request)).toEqual({ok:false,error:{kind:'response',status:200}});
 const oversized={...request,padding:'x'.repeat(3584)} as OutputSettlementRequest;
 expect(await client.settleOutput(request.retirement.attemptId,oversized)).toEqual({ok:false,error:{kind:'request'}});
 const limited=createRunnerClient(createHttpTransport({baseUrl,fetch:fetcher,maximumBytes:32}));
 expect(await limited.settleOutput(request.retirement.attemptId,request)).toEqual({ok:false,error:{kind:'request'}});
 expect(fetcher).toHaveBeenCalledTimes(2);
});
