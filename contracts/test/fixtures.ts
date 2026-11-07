import { readFile } from 'node:fs/promises';
import type { ProtocolName } from '../src/index.js';

export const fixtureRoot = new URL('../fixtures/', import.meta.url);
export interface Vector { path: string; schema: ProtocolName; valid: boolean }
export async function vectors(): Promise<Vector[]> {
  return JSON.parse(await readFile(new URL('manifest.json', fixtureRoot), 'utf8')) as Vector[];
}
export async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, fixtureRoot), 'utf8')) as unknown;
}
