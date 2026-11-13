import { expect,it } from 'vitest';
import original from '../../../contracts/fixtures/valid/output-retirement-absence.json' with {type:'json'};
import source from '../../../contracts/fixtures/valid/output-retirement-source.json' with {type:'json'};
import { encodeCanonicalJson } from '@beetle/contracts';
import { rejectedCleanupLimits,rejectedCleanupPeakBytes,rejectedControlValue,captureRejectedControl,rejectedControlDigest } from '../../src/rejected-cleanup-values/index.js';
const expected={request:original,namespaceIdentity:'a'.repeat(64),taskName:'beetle-'+'f'.repeat(121)};
it('bounds the complete prepaid peak and the maximal closed control row including its allowance',()=>{
 const row=rejectedControlValue(expected);const bytes=Buffer.byteLength(encodeCanonicalJson(row,1024));
 expect(expected.taskName).toHaveLength(128);expect(bytes+512).toBeLessThanOrEqual(rejectedCleanupLimits.controlRowBytes);
 expect(rejectedCleanupPeakBytes).toBe(13312);expect(rejectedCleanupPeakBytes).toBeLessThanOrEqual(rejectedCleanupLimits.reservedBytes);
 expect(captureRejectedControl(row,expected)).toEqual(row);expect(rejectedControlDigest(row,expected)).toMatch(/^[a-f0-9]{64}$/);
});
it('refuses source, unknown fields, insufficient reservation and substituted original/namespace/name commitments',()=>{
 const row=rejectedControlValue(expected);
 for(const patch of [{version:2},{reservedBytes:4096},{extra:true},{attemptId:original.runId},{requestDigest:'f'.repeat(64)},
  {namespaceIdentity:'f'.repeat(64)},{taskName:'other'}])expect(()=>captureRejectedControl({...row,...patch},expected)).toThrow();
 expect(()=>rejectedControlValue({...expected,request:source})).toThrow();
 expect(()=>rejectedControlValue({...expected,taskName:'../outside'})).toThrow();
 expect(()=>rejectedControlValue({...expected,taskName:'x'.repeat(129)})).toThrow();
});
it('rejects caller accessors before observing their values',()=>{
 const row={...rejectedControlValue(expected)};let read=false;
 Object.defineProperty(row,'taskName',{get(){read=true;return expected.taskName;}});
 expect(()=>captureRejectedControl(row,expected)).toThrow();expect(read).toBe(false);
});
