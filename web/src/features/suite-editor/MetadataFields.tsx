import type { Workspace } from '@beetle/contracts/api';
import { TextInput } from '../../components/Fields.js';
import { FolderPicker } from '../suites/FolderPicker.js';
import type { MetadataValues } from './metadata.js';
import { fieldId } from './problems.js';
import type { Problem } from './problems.js';

/** Current suite details are saved with the configuration through one versioned request. */
export function MetadataFields({
  workspace,
  value,
  change,
  problems,
}: {
  workspace: Workspace;
  value: MetadataValues;
  change: (value: MetadataValues) => void;
  problems: readonly Problem[];
}) {
  const error = (field: string) => problems.find((problem) => problem.path === '/metadata/' + field)?.message;
  return (
    <>
      <div className="suite-about-fields">
        <TextInput
          id={fieldId('/metadata/name')}
          label="Name"
          maxLength={512}
          value={value.name}
          error={error('name')}
          onChange={(event) => change({ ...value, name: event.target.value })}
        />
        <div>
          <FolderPicker
            workspace={workspace}
            id={fieldId('/metadata/folderId')}
            relative
            selected={value.folderId}
            choose={(folderId) => change({ ...value, folderId })}
            label="Folder"
            hint=""
          />
          {error('folderId') && <p className="field-error">{error('folderId')}</p>}
        </div>
      </div>
      <TextInput
        id={fieldId('/metadata/description')}
        label="What this suite checks"
        maxLength={1120}
        value={value.description}
        error={error('description')}
        onChange={(event) => change({ ...value, description: event.target.value })}
      />
    </>
  );
}
