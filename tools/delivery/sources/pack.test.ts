import {mkdtemp, mkdir, writeFile, chmod, utimes, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {expect, it} from 'vitest';
import {archiveProducer} from '../producer.js';
import {deliveryDigest} from '../files.js';
const script = fileURLToPath(new URL('./pack.py', import.meta.url));
function pack(payload: string, output: string) {
  return archiveProducer({executable: 'python3', args: [script, payload], destination: output, maximumBytes: 1024 ** 2});
}
it('normalizes owner/times/readability, keeps executable recipes and preserves safe links deterministically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-source-pack-'));
  try {
    const payload = join(directory, 'payload'); await mkdir(payload);
    const file = join(payload, 'data'); const executable = join(payload, 'install.sh');
    await writeFile(file, 'synthetic'); await writeFile(executable, '# synthetic recipe'); await chmod(executable, 0o755);
    await symlink('install.sh', join(payload, 'upgrade.sh'));
    const first = join(directory, 'first.tar.gz'); const second = join(directory, 'second.tar.gz');
    await pack(payload, first); await utimes(file, 100, 100); await chmod(file, 0o600); await pack(payload, second);
    expect(await deliveryDigest(first, 1024 ** 2)).toEqual(await deliveryDigest(second, 1024 ** 2));
    const probe = 'import tarfile,json,sys; t=tarfile.open(sys.argv[1]); print(json.dumps([{ "name":x.name,"uid":x.uid,"gid":x.gid,"user":x.uname,"group":x.gname,"mtime":x.mtime,"mode":x.mode,"link":x.linkname} for x in t]))';
    const metadata = JSON.parse(execFileSync('python3', ['-c', probe, first], {timeout: 5000, maxBuffer: 65536}).toString()) as
      {name: string; uid: number; gid: number; user: string; group: string; mtime: number; mode: number; link: string}[];
    expect(metadata.every(row => row.uid === 0 && row.gid === 0 && row.user === '' && row.group === '' && row.mtime === 0)).toBe(true);
    expect(metadata.find(row => row.name === 'install.sh')?.mode).toBe(0o755);
    expect(metadata.find(row => row.name === 'data')?.mode).toBe(0o644);
    expect(metadata.find(row => row.name === 'upgrade.sh')?.link).toBe('install.sh');
  } finally {await rm(directory, {recursive: true});}
});
it('refuses escaping links and excessive entries without extracting or executing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-source-pack-bound-'));
  try {
    const payload = join(directory, 'payload'); await mkdir(payload); await symlink('../outside', join(payload, 'escape'));
    await expect(pack(payload, join(directory, 'bad.tar.gz'))).rejects.toThrow();
    await rm(join(payload, 'escape'));
    for (let index = 0; index < 513; index++) await writeFile(join(payload, `empty-${index}`), '');
    await expect(pack(payload, join(directory, 'excessive.tar.gz'))).rejects.toThrow();
  } finally {await rm(directory, {recursive: true});}
});
