import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Test-only native COMMIT observation; never changes the exclusive database policy. */
export async function commitProbe(root: string, actual: URL): Promise<URL> {
  const path = join(root, 'observed-metadata-worker.mjs');
  await writeFile(path, `
import { DatabaseSync } from 'node:sqlite';
import { workerData } from 'node:worker_threads';
import { writeFileSync, renameSync } from 'node:fs';
const execute = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function(sql) {
  const result = execute.call(this, sql);
  if (sql === 'COMMIT' && this.prepare("SELECT 1 FROM sqlite_master WHERE name='event_cursors'").get()) {
    const cursors = this.prepare('SELECT attempt_id,durable_through,event_count,retained_bytes FROM event_cursors LIMIT 2').all();
    if (cursors.length > 1) throw new Error('Commit probe attempt bound');
    const cursor = cursors[0];
    const rows = cursor ? this.prepare('SELECT count(*) n,sum(charged_bytes) bytes FROM run_events WHERE attempt_id=?').get(cursor.attempt_id) : null;
    const text = JSON.stringify({cursor,rows});
    if (Buffer.byteLength(text) > 4096) throw new Error('Commit probe byte bound');
    writeFileSync(workerData.path+'.commit-next', text);
    renameSync(workerData.path+'.commit-next',workerData.path+'.commit-observed');
  }
  return result;
};
await import(${JSON.stringify(actual.href)});
`);
  return pathToFileURL(path);
}
/** The probe producer writes <=4KiB atomically before replying to the parent. */
export function committed(path: string): unknown {
  const bytes = readFileSync(path + '.commit-observed');
  if (bytes.length > 4096) throw new Error('Commit probe byte bound');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
