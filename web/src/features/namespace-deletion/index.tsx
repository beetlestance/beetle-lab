import { useState } from 'react';
import { useEditor } from '../../components/Editor.js';
import { useToast } from '../../components/Toast.js';
import { ConfirmDeletion } from './ConfirmDeletion.js';
import type { Target } from './useDeletion.js';

export type { Target } from './useDeletion.js';

/** Row action on namespace lists; opens the typed-name confirmation and refreshes the list when done. */
export function DeleteNamespace({
  target,
  refresh,
  disabled = false,
}: {
  target: Target;
  refresh: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const editor = useEditor();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        disabled={disabled || editor.busy}
        aria-label={`Delete ${target.entity.name}`}
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
      {open && (
        <ConfirmDeletion
          target={target}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast.show(`${target.entity.name} is deleted.`);
            void refresh();
          }}
        />
      )}
    </>
  );
}
