import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../compiler/suite/validation.js';
interface Manifest { generator: string; generatorSha256: string; sources: Record<string, string>; outputs: string[]; outputSha256: Record<string, string> }
const root = new URL('../../../../', import.meta.url);
describe('schema-derived compiler provenance', () => {
  it('pins every source, generator and output identity with no omitted generated files', async () => {
    const directory = new URL('engines/k6/compiler/generated/', root);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as Manifest;
    expect(sha256(await readFile(new URL(manifest.generator, root), 'utf8'))).toBe(manifest.generatorSha256);
    for (const [path, hash] of Object.entries(manifest.sources)) expect(sha256(await readFile(new URL(path, root), 'utf8'))).toBe(hash);
    for (const [path, hash] of Object.entries(manifest.outputSha256)) expect(sha256(await readFile(new URL(path, directory), 'utf8'))).toBe(hash);
    expect((await readdir(directory)).sort()).toEqual(manifest.outputs);
    const schemaFiles = await readdir(new URL('contracts/engines/k6/v1/', root));
    expect(schemaFiles.filter(name => name.endsWith('.schema.json')).sort()).toEqual(Object.keys(manifest.sources).map(path => path.split('/').at(-1)!).sort());
    expect(Object.keys(manifest.outputSha256).sort()).toEqual(manifest.outputs.filter(name => name !== 'manifest.json'));
  });
});
