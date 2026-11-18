import {expect,it} from 'vitest';
import {captureLiveMetricHistory} from '@beetle/contracts/api';
import data from '../../../contracts/fixtures/api/valid/live-target-history.json' with {type:'json'};
import {hash} from '../run-live-metrics/fixtures.js';
import {setup,originalIdentity} from './source-fixtures.js';
import {turns} from './fixtures.js';
function current(){const value=captureLiveMetricHistory(data,hash);const {organizationId,workspaceId,attemptId,generation}=originalIdentity();value.scope={organizationId,workspaceId,attemptId,generation};value.prefix.scope={...value.scope};if(value.prefix.target)value.prefix.target.scope={...value.scope};return value;}
it('uses the fixed private read and retains its native socket original through actual close',async()=>{
 const e=setup();const value=current();let settled=false;const read=e.gateway.liveHistory(originalIdentity()).then(result=>{settled=true;return result});await turns();const io=e.native.originals[0]!;
 expect(io.options.path).toBe(`/runner/v1/attempts/${originalIdentity().attemptId}/live-history`);expect(io.options.headers).toMatchObject({'x-beetle-journal-authority':originalIdentity().journalAuthority});io.body(value);await turns();expect(settled).toBe(false);io.close();expect(await read).toEqual({ok:true,value});
});
it.each(['scope','digest','padding'] as const)('rejects malformed history %s',async kind=>{
 const e=setup();const value=current();if(kind==='scope')value.scope.generation=2;if(kind==='digest')value.subsetDigest='f'.repeat(64);
 const read=e.gateway.liveHistory(originalIdentity());await turns();const io=e.native.originals[0]!;io.body(kind==='padding'?{...value,padding:'invalid'}:value);io.close();expect((await read).ok).toBe(false);
});
it('retains one cancelled history DNS original while other read lanes remain available',async()=>{
 const e=setup(true);const abort=new AbortController();const history=e.gateway.liveHistory(originalIdentity(),abort.signal);abort.abort();await turns();expect(await e.gateway.liveHistory(originalIdentity())).toMatchObject({ok:false});
 const live=e.gateway.liveMetrics(originalIdentity());const source=e.client.source();await turns();expect(e.native.lookups).toHaveLength(3);const closing=e.gateway.close();e.native.releaseDns();expect((await history).ok).toBe(false);expect((await live).ok).toBe(false);expect((await source).ok).toBe(false);await closing;
});
