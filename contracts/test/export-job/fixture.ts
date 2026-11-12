import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { StandaloneExportAssignment, StandaloneExportResult } from '../../src/index.js';
import { sealStandaloneExportResult } from '../../src/index.js';
export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const root = new URL('../../fixtures/export-v1/', import.meta.url);
export const text = (name: string) => readFile(new URL(name, root), 'utf8');
export async function assignment() {return JSON.parse(await text('assignment.json')) as StandaloneExportAssignment;}
export async function result() {return JSON.parse(await text('result.json')) as StandaloneExportResult;}
export async function body() {const {assignmentDigest, ...value} = await assignment(); if (!assignmentDigest) throw new Error('Missing digest'); return value;}
export async function reseal(patch: Record<string, unknown>) {
  const {seal,...value} = await result(); const sealed = sealStandaloneExportResult({...value,...patch},seal.sealedAt,hash);
  if (!sealed.ok) throw new Error('Synthetic result was structurally invalid'); return sealed.value;
}
