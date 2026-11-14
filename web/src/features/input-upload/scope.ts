import type { Workspace } from '@beetle/contracts/api';
const owners = new WeakMap<object, number>();
let nextOwner = 0;
function ownerId(owner: object) {
  let id = owners.get(owner);
  if (id === undefined) { id = ++nextOwner; owners.set(owner, id); }
  return id;
}

export function inputScopeKey(workspace: Workspace, api: object, transfers: object): string {
  return `${workspace.scope.organizationId}:${workspace.id}:${ownerId(api)}:${ownerId(transfers)}`;
}
