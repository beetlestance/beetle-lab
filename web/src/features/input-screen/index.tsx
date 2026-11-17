import { useState } from 'react';
import type { Workspace } from '@beetle/contracts/api';
import { useInputTransfers } from '../../app/api.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { InputInventory } from '../inputs/index.js';
import type { InventoryContext } from '../inputs/index.js';
import { UploadInput } from '../input-upload/index.js';
import { DirectoryInput } from '../input-directory/index.js';
import { InputDownload } from '../input-download/index.js';
import { AddSampleFile } from '../input-sample/index.js';

type Open = 'upload' | 'directory' | 'sample' | null;

/** The inventory's current-status owner alone supplies download authority. */
export function WorkspaceInputs({ workspace }: { workspace: Workspace }) {
  const transfers = useInputTransfers();
  const [open, setOpen] = useState<Open>(null);
  const [context, setContext] = useState<InventoryContext>({ items: [], complete: false });
  const close = () => setOpen(null);
  const unavailable = transfers ? undefined : 'Input transfer is unavailable for this session.';
  return (
    <>
      <InputInventory
        workspace={workspace}
        renderActions={(record) => <InputDownload record={record} />}
        actions={(current) => (
          <>
            <Button
              variant="primary"
              disabled={!transfers}
              title={unavailable}
              onClick={() => {
                setContext(current);
                setOpen('upload');
              }}
            >
              Upload files
            </Button>
            <Button
              disabled={!transfers}
              title={unavailable}
              onClick={() => {
                setContext(current);
                setOpen('sample');
              }}
            >
              Add a sample file
            </Button>
            <Button variant="text" disabled={!transfers} title={unavailable} onClick={() => setOpen('directory')}>
              Import a folder
            </Button>
          </>
        )}
      >
        {unavailable && <p className="muted">{unavailable}</p>}
      </InputInventory>
      {open === 'upload' && <UploadInput workspace={workspace} onClose={close} />}
      {open === 'sample' && (
        <AddSampleFile
          workspace={workspace}
          names={context.items.filter((item) => item.state !== 'deleted').map((item) => item.name)}
          complete={context.complete}
          onClose={close}
        />
      )}
      {open === 'directory' && (
        <Dialog
          title="Import a folder"
          onClose={close}
          actions={
            <Button variant="text" onClick={close}>
              Close import
            </Button>
          }
        >
          <DirectoryInput workspace={workspace} />
        </Dialog>
      )}
    </>
  );
}
