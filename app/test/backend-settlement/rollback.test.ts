import { expect,it } from 'vitest';
import { fixture,snapshot } from './fixture.js';
it.each(['backend_cleanup_controls','runs'])('rolls back tombstone, original rows and both counters on late %s failure',table=>{
 const f=fixture();const before=snapshot(f);
 f.db.exec(`CREATE TRIGGER synthetic_late_abort BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic late failure');END`);
 expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
 expect(f.db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys).toBe(0);
 f.db.exec('DROP TRIGGER synthetic_late_abort');expect(f.settle().kind).toBe('source');
});
it('keeps FK enforcement through COMMIT and rolls back an unknown retained child',()=>{
 const f=fixture();f.db.exec('CREATE TABLE synthetic_retained_child(run_id TEXT REFERENCES runs(id))');
 f.db.prepare('INSERT INTO synthetic_retained_child VALUES(?)').run(f.key.runId);const before=snapshot(f);
 expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
 expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
 expect(f.db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys).toBe(0);
 f.db.exec('DROP TABLE synthetic_retained_child');expect(f.settle().kind).toBe('source');
});
it.each(["UPDATE settings SET version=version+1",'DELETE FROM receipts',
 'UPDATE installation_storage_usage SET charged_bytes=0','UPDATE backend_replay_storage SET original_count=1,charged_bytes=2560'])('refuses nested mutation outside the active original and exact counter phase: %s',sql=>{
 const f=fixture();const before=snapshot(f);
 f.db.exec(`CREATE TRIGGER synthetic_nested AFTER DELETE ON backend_output_cleanup_acks BEGIN ${sql};END`);
 expect(()=>f.settle()).toThrow();expect(snapshot(f)).toBe(before);
});
