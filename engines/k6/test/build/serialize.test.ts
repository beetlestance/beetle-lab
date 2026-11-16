import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePlanData } from '../../build/serialize.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))); });
async function path() { const root = await mkdtemp(join(tmpdir(),'beetle-plan-data-'));roots.push(root);return join(root,'plan.json'); }
it('streams a large literal while preserving JSON escapes, paired and unpaired surrogates', async () => {
  const file = await path();const value = { body: {kind: 'scalar', value: 'text { css } "\\\n🙂'.repeat(40000)}, broken: '\ud800' };
  const expected = JSON.stringify(value);expect(expected.length).toBeGreaterThan(700000);
  expect(await writePlanData(file,value,4*1048576)).toBe(Buffer.byteLength(expected));
  expect(await readFile(file,'utf8')).toBe(expected);
});
it('refuses expanded byte overflow before creating a file', async () => {
  const file=await path();await expect(writePlanData(file,{body:'🙂'.repeat(20000)},10000)).rejects.toThrow('script_limit');
  await expect(lstat(file)).rejects.toMatchObject({code:'ENOENT'});
});
it('keeps individual expanded strings and keys bounded before file creation', async () => {
  for (const value of [{kind:'scalar',value:'\u0000'.repeat(1400000)},{['x'.repeat(65537)]:true}]) {
    const file=await path();await expect(writePlanData(file,value)).rejects.toThrow('script_limit');
    await expect(lstat(file)).rejects.toMatchObject({code:'ENOENT'});
  }
});

it('rechecks output admission during the second pass even if foreign data changes', async () => {
  const file=await path();let reads=0;const value=Object.defineProperty({},'text',{enumerable:true,
    get:()=>++reads===1?'small':'x'.repeat(50000)});
  await expect(writePlanData(file,value,100)).rejects.toThrow('script_limit');
  expect((await lstat(file)).size).toBeLessThanOrEqual(100);expect(reads).toBe(2);
});
