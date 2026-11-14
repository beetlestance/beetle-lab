import {expect, it} from 'vitest';
import source from '../fixtures/valid/k6-diagnostics.json' with {type: 'json'};
import {captureK6Diagnostics, decodeK6Diagnostics, diagnosticText, K6_DIAGNOSTIC_BYTES} from '../src/k6-diagnostics/index.js';
it('detaches safe enums and rejects raw payloads, unknown codes and contradictory counters', () => {
  const input = structuredClone(source); const report = captureK6Diagnostics(input); input.records.length = 0;
  expect(report.records).toHaveLength(1); expect(Object.isFrozen(report.records[0])).toBe(true);
  for (const bad of [
    {...source, raw: 'SECRET_URL'}, {...source, records: [{...source.records[0], msg: 'SECRET'}]},
    {...source, records: [{...source.records[0], level: 'SECRET'}]}, {...source, records: [{...source.records[0], code: 'SECRET'}]},
    {...source, records: [{...source.records[0], sequence: 2}]}, {...source, observedRecords: 2}, {...source, observedBytes: 0},
    {...source, records: [], droppedRecords: 1},
    {...source, records: [{...source.records[0], code: 'insufficient-vus'}], redactedRecords: 0},
    {...source, records: [{...source.records[0], code: 'invalid'}], redactedRecords: 0, invalidSegments: 1, coverage: 'partial'},
    {...source, records: [{...source.records[0], level: 'unknown'}]},
    {...source, redactedRecords: 0}, {...source, invalidSegments: 1}, {...source, droppedRecords: 1},
  ]) expect(() => captureK6Diagnostics(bad)).toThrow('Diagnostic evidence rejected');
  expect(diagnosticText(report.records[0]!.code)).toBe('Native diagnostic details redacted.');
});
it('fits the worst permitted retained prefix within its actual serialized reservation', () => {
  const records = Array.from({length: 256}, (_, i) => ({sequence: i + 1, level: 'warning', code: 'maximum-duration'}));
  const report = captureK6Diagnostics({...source, observedRecords: Number.MAX_SAFE_INTEGER, observedBytes: Number.MAX_SAFE_INTEGER,
    droppedRecords: Number.MAX_SAFE_INTEGER - records.length, redactedRecords: 0, records, coverage: 'partial'});
  const bytes = new TextEncoder().encode(JSON.stringify(report) + '\n');
  expect(bytes.length).toBeLessThanOrEqual(K6_DIAGNOSTIC_BYTES); expect(decodeK6Diagnostics(bytes)).toEqual(report);
  for (const bad of [new Uint8Array(K6_DIAGNOSTIC_BYTES + 1), Uint8Array.of(255), new TextEncoder().encode('{')]) expect(() => decodeK6Diagnostics(bad)).toThrow();
});
