import assert from 'node:assert/strict';
import {basename, isAbsolute, normalize} from 'node:path';
import {validatePrimitive} from '@beetle/contracts';
import {record} from '../values.js';
export function lifecycleOwner(input: unknown) {
  const row = record(input); assert.equal(Object.keys(row).length, 4);
  assert(typeof row.project === 'string' && /^beetle-qual-[a-f0-9]{8}$/.test(row.project));
  assert(typeof row.root === 'string' && isAbsolute(row.root) && normalize(row.root) === row.root);
  assert(/^beetle-compose-evidence-[A-Za-z0-9]{6}$/.test(basename(row.root)));
  assert(typeof row.revision === 'string' && /^[a-f0-9]{40}$/.test(row.revision));
  assert(row.mode === 'crashes' || row.mode === 'cancel');
  return {project: row.project, root: row.root, revision: row.revision, mode: row.mode};
}
export function installationOwner(input: unknown, project: string): string {
  const row = record(input); assert.equal(Object.keys(row).length, 2); assert.equal(row.project, project);
  assert(typeof row.installationId === 'string' && row.installationId === row.installationId.toLowerCase() && validatePrimitive('uuid', row.installationId).ok);
  return row.installationId;
}
export function boundedIds(text: string, maximum: number): string[] {
  const ids = text.split('\n').filter(Boolean); assert(ids.length <= maximum && new Set(ids).size === ids.length);
  assert(ids.every(id => /^[a-f0-9]{64}$/.test(id))); return ids;
}
