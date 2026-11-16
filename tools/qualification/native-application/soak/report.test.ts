import {expect, it} from 'vitest';
import {mkdtemp, writeFile, link, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLongReport, maximumLongReportBytes} from './report.js';
it('reads a bounded larger timing report and rejects aliasing, broad permissions or oversized input', async () => {
 const root = await mkdtemp(join(tmpdir(), 'beetle-long-report-'));
 try {
  const file = join(root, 'report.json'); const value = {fixed: 'x'.repeat(745856)};
  await writeFile(file, JSON.stringify(value), {mode: 0o600}); expect(await readLongReport(file)).toEqual(value);
  await symlink(file, join(root, 'alias.json')); await expect(readLongReport(join(root, 'alias.json'))).rejects.toThrow();
  await link(file, join(root, 'hard.json')); await expect(readLongReport(file)).rejects.toThrow();
  const broad = join(root, 'broad.json'); await writeFile(broad, '{}', {mode: 0o644}); await expect(readLongReport(broad)).rejects.toThrow();
  const large = join(root, 'large.json'); await writeFile(large, Buffer.alloc(maximumLongReportBytes + 1), {mode: 0o600}); await expect(readLongReport(large)).rejects.toThrow();
 } finally {await rm(root, {recursive: true, force: true});}
});
