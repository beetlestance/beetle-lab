import { expect, it, vi } from 'vitest';
import { frame } from '../run-live-metrics/fixtures.js';
import { setup, originalIdentity } from './source-fixtures.js';
import { turns } from './fixtures.js';
const current = () => {const now = Date.now(); const {organizationId, workspaceId, attemptId, generation} = originalIdentity();
  return frame({scope: {organizationId, workspaceId, attemptId, generation}, capturedAtMs: now,
  publishedAtMs: now, startTimeMs: now - 1000, endTimeMs: now});};
it('reads only the fixed private path and retains the original until native close', async () => {
  const e = setup(); const value = current(); let settled = false;
  const read = e.gateway.liveMetrics(originalIdentity()).then(value => {settled = true; return value;});
  await turns(); const io = e.native.originals[0]!;
  expect(io.options.path).toBe(`/runner/v1/attempts/${originalIdentity().attemptId}/live-metrics`);
  expect(io.options.headers).toMatchObject({'x-beetle-journal-authority': originalIdentity().journalAuthority});
  io.response.headers['x-beetle-live-fresh-for-ms']='6000';
  io.body(value); await turns(); expect(settled).toBe(false);
  io.close(); const result=await read;expect(result).toMatchObject({ok:true,value});
  if(result.ok)expect(result.freshUntilMonotonicMs).toBeGreaterThan(performance.now());
});
it.each(['scope', 'stale', 'future', 'digest', 'bytes'] as const)('rejects invalid advisory responses: %s', async cause => {
  const e = setup(); const value = current();
  if (cause === 'scope') value.scope = {...value.scope, generation: 2};
  if (cause === 'stale') value.capturedAtMs -= 10000;
  if (cause === 'future') value.publishedAtMs += 10000;
  if (cause === 'digest') value.subsetDigest = 'f'.repeat(64);
  const read = e.gateway.liveMetrics(originalIdentity()); await turns(); const io = e.native.originals[0]!;
  io.response.headers['x-beetle-live-fresh-for-ms']='6000';
  io.body(cause === 'bytes' ? {...value, padding: 'x'.repeat(65536)} : value); io.close();
  expect((await read).ok).toBe(false);
});
it('retains the live2 subset through abort while source transfer keeps its own credits', async () => {
  const e = setup(true); const abort = new AbortController();
  const first = e.gateway.liveMetrics(originalIdentity(), abort.signal); const second = e.gateway.liveMetrics(originalIdentity());
  abort.abort(); await turns();
  expect(await e.gateway.liveMetrics(originalIdentity())).toMatchObject({ok: false});
  const source = e.client.source(); await turns(); expect(e.native.lookups).toHaveLength(3);
  const closing = e.gateway.close(); e.native.releaseDns();
  expect((await first).ok).toBe(false); expect((await second).ok).toBe(false); expect((await source).ok).toBe(false); await closing;
});

it.each([-30000,30000])('accepts attested frames from a source clock offset by %ims',async offset=>{
 const e=setup();const value=current();for(const key of ['capturedAtMs','publishedAtMs','startTimeMs','endTimeMs'] as const)value[key]+=offset;
 const read=e.gateway.liveMetrics(originalIdentity());await turns();const io=e.native.originals[0]!;io.response.headers['x-beetle-live-fresh-for-ms']='6000';io.body(value);io.close();
 expect(await read).toMatchObject({ok:true,value});
});
it.each([undefined,'0','-1','6001','NaN','1.2','1, 2'])('refuses absent or malformed source freshness: %s',async budget=>{
 const e=setup();const read=e.gateway.liveMetrics(originalIdentity());await turns();const io=e.native.originals[0]!;if(budget!==undefined)io.response.headers['x-beetle-live-fresh-for-ms']=budget;io.body(current());io.close();
 expect((await read).ok).toBe(false);
});
it('charges time held before physical socket close against the source budget',async()=>{
 let now=1000;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
 try{const e=setup();const read=e.gateway.liveMetrics(originalIdentity());await turns();const io=e.native.originals[0]!;io.response.headers['x-beetle-live-fresh-for-ms']='5';io.body(current());await turns();now=1010;io.close();expect((await read).ok).toBe(false);}
 finally{clock.mockRestore();}
});
