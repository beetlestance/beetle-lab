import { readFile } from 'node:fs/promises';
import type { ApiTypes } from '../../src/api/index.js';

interface Vector { path: string; schema: keyof ApiTypes; valid: boolean }
const root = new URL('../../fixtures/api/', import.meta.url);
export async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as unknown;
}
export async function vectors(): Promise<Vector[]> {
  return JSON.parse(await readFile(new URL('vectors.json', root), 'utf8')) as Vector[];
}
