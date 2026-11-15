import {expect, it} from 'vitest';
import {readQualifiedRun} from './github.js';

it('validates caller identities before issuing any API request', async () => {
  let calls = 0; const api = async () => {calls++; return {};};
  await expect(readQualifiedRun(-1, 'a'.repeat(40), api)).rejects.toThrow('run ID');
  await expect(readQualifiedRun(1, 'main', api)).rejects.toThrow('revision');
  expect(calls).toBe(0);
});
it('issues only four fixed repository paths and joins peers after one request fails', async () => {
  const paths: string[] = []; let release!: () => void; let finished = false;
  const held = new Promise<void>(resolve => {release = resolve;});
  const work = readQualifiedRun(17, 'a'.repeat(40), async path => {
    paths.push(path);
    if (path.endsWith('/ci.yml')) throw Error('private transport detail');
    await held; return {};
  });
  void work.then(() => {finished = true;}, () => {finished = true;});
  await Promise.resolve(); expect(finished).toBe(false); expect(paths).toEqual([
    'repos/beetlestance/beetle-lab/actions/workflows/ci.yml',
    'repos/beetlestance/beetle-lab/actions/runs/17',
    'repos/beetlestance/beetle-lab/actions/runs/17/jobs?per_page=100&filter=all',
    'repos/beetlestance/beetle-lab/actions/runs/17/artifacts?per_page=100']);
  release(); await expect(work).rejects.toThrow('metadata unavailable');
});
it('refuses inactive or differently named workflow metadata', async () => {
  for (const workflow of [{id: 23, path: '.github/workflows/other.yml', state: 'active'},
    {id: 23, path: '.github/workflows/ci.yml', state: 'disabled_manually'}]) {
    await expect(readQualifiedRun(17, 'a'.repeat(40), async () => workflow)).rejects.toThrow('workflow identity mismatch');
  }
});
