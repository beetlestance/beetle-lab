import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import fixture from '../../../contracts/fixtures/api/valid/export-job.json' with { type: 'json' };
import { projectExport } from '../../src/adapters/outbound/sqlite/export-jobs/reads.js';

it('projects only bounded valid artifact seal times and refuses corrupted sources', () => {
  const checked = validateApi('ExportJob', fixture);
  if (!checked.ok) throw Error('Synthetic fixture');
  const original = checked.value;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE export_artifacts(export_id TEXT,artifact_id TEXT,bytes INTEGER,sha256 TEXT,phase TEXT,writer TEXT,identity TEXT,offset INTEGER); CREATE TABLE export_sources(export_id TEXT,source_json TEXT)',
    );
    db.prepare("INSERT INTO export_artifacts VALUES(?,?,1,?,'published',NULL,'retained',1)").run(
      original.id,
      original.id,
      'a'.repeat(64),
    );
    const source = (sealedAt: unknown) => JSON.stringify({ manifest: { result: { artifact: { sealedAt } } } });
    const made = '2026-11-12T05:42:00+01:00';
    db.prepare('INSERT INTO export_sources VALUES(?,?)').run(original.id, source(made));
    const row = {
      id: original.id,
      intent_json: JSON.stringify(original),
      state: 'ready',
      version: 2,
      cancellation_requested: 0,
      reason: null,
      last_agent_report_at: null,
    };
    expect(projectExport(db, row)).toMatchObject({ madeAt: made, lastAgentReportAt: null });
    for (const invalid of [undefined, null, 1, 'invalid', 'x'.repeat(100000)]) {
      db.prepare('UPDATE export_sources SET source_json=?').run(source(invalid));
      expect(() => projectExport(db, row)).toThrow();
    }
  } finally {
    db.close();
  }
});
