import { expect, it } from 'vitest';
import { responseBody } from './response-body.js';
it('keeps the artifact ceiling while permitting the explicit bounded history profile', async () => {
  const bytes = new Uint8Array(1048577);
  const refused = new Response(bytes);
  await expect(responseBody(refused, { maximum: 2097152 }, new AbortController().signal)).rejects.toThrow();
  await refused.body?.cancel();
  expect(
    (
      await responseBody(
        new Response(bytes),
        { maximum: 2097152, profile: 'api-history' },
        new AbortController().signal,
      )
    ).length,
  ).toBe(bytes.length);
});

it('requires an explicit export profile for larger script bytes and caps it at64MiB',async()=>{
 const data=new Uint8Array(1048577);
 const actual=await responseBody(new Response(data),{profile:'export-script',maximum:data.length,expected:data.length},new AbortController().signal);
 expect(actual.byteLength).toBe(data.length);
 const refused=new Response(data);
 await expect(responseBody(refused,{profile:'export-script',maximum:67108865},new AbortController().signal)).rejects.toThrow();await refused.body?.cancel();
});
