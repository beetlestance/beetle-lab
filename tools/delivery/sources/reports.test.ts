import {mkdtemp, writeFile, readFile, rm, symlink, link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, it} from 'vitest';
import {copySourceReport} from './reports.js';
it('copies exact bytes to an exclusive regular destination under the remaining budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-source-report-'));
  try {
    const source = join(directory, 'source'); const destination = join(directory, 'copy');
    await writeFile(source, '{"synthetic":true}');
    const bytes = await copySourceReport(source, destination, 1024);
    expect(bytes).toBe(18); expect(await readFile(destination)).toEqual(await readFile(source));
    await expect(copySourceReport(source, destination, 1024)).rejects.toThrow('copy failed');
    await expect(copySourceReport(source, join(directory, 'small'), bytes - 1)).rejects.toThrow('copy failed');
    await expect(copySourceReport(source, join(directory, 'none'), 0)).rejects.toThrow('aggregate bound');
    const symbolic = join(directory, 'symbolic'); await symlink(source, symbolic);
    await expect(copySourceReport(symbolic, join(directory, 'refused'), 1024)).rejects.toThrow();
    const hard = join(directory, 'hard'); await link(source, hard);
    await expect(copySourceReport(hard, join(directory, 'refused-hard'), 1024)).rejects.toThrow('copy failed');
  } finally {await rm(directory, {recursive: true});}
});
