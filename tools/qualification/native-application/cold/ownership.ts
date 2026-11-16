import assert from 'node:assert/strict';
import {basename, isAbsolute, normalize} from 'node:path';
import {validatePrimitive} from '@beetle/contracts';
import {record} from '../../resources/values.js';
export function coldOwner(input: unknown) {
  const owner = record(input);
  assert.equal(Object.keys(owner).sort().join(','), 'owner,project,revision,root');
  assert(typeof owner.root === 'string' && isAbsolute(owner.root) && normalize(owner.root) === owner.root && /^beetle-compose-evidence-[A-Za-z0-9]{6}$/.test(basename(owner.root)));
  assert(typeof owner.project === 'string' && /^beetle-qual-[a-f0-9]{8}$/.test(owner.project));
  assert(typeof owner.revision === 'string' && /^[a-f0-9]{40}$/.test(owner.revision));
  assert(typeof owner.owner === 'string' && owner.owner === owner.owner.toLowerCase() && validatePrimitive('uuid', owner.owner).ok);
  return {root: owner.root, project: owner.project, revision: owner.revision, owner: owner.owner};
}
