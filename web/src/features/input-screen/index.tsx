import type { Workspace } from '@beetle/contracts/api';
import { InputInventory } from '../inputs/index.js';
import { UploadInput } from '../input-upload/index.js';
import { DirectoryInput } from '../input-directory/index.js';
import { InputDownload } from '../input-download/index.js';

/** The inventory's current-status owner alone supplies download authority. */
export function WorkspaceInputs({ workspace }: { workspace: Workspace }) {
  return <InputInventory workspace={workspace} renderActions={record => <InputDownload record={record} />}>
    <UploadInput workspace={workspace} />
    <DirectoryInput workspace={workspace} />
  </InputInventory>;
}
