import { useState } from 'react';
import type { Workspace } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { MetadataEditor } from './MetadataEditor.js';

/** k6 is the only engine the API accepts (`engineId` const k6); the rest are product copy, labelled Planned. */
const engines = [
  { id: 'k6', name: 'k6 load tests', text: 'HTTP traffic against a running service, at the rate the suite plans.' },
  { id: 'unit', name: 'Unit tests', text: 'Vitest, Jest or pytest suites inside a pinned container.' },
  {
    id: 'integration',
    name: 'Integration tests',
    text: 'Tests against real dependencies started from a compose file.',
  },
  { id: 'lint', name: 'Lint checks', text: 'ESLint, Ruff or golangci-lint on a revision of the code.' },
  { id: 'format', name: 'Formatting', text: 'Prettier, Black or gofmt in check mode.' },
  {
    id: 'mutation',
    name: 'Mutation testing',
    text: 'Stryker or mutmut change the code and check that the tests notice.',
  },
] as const;

/** New suite: Overlay / Engine picker, then the suite details form. */
export function NewSuite({
  workspace,
  folderId,
  close,
}: {
  workspace: Workspace;
  folderId: string;
  close: () => void;
}) {
  const [engine, setEngine] = useState<'k6' | null>(null);
  if (engine) return <MetadataEditor workspace={workspace} folderId={folderId} close={close} />;
  return <EnginePicker choose={() => setEngine('k6')} close={close} />;
}
export function EnginePicker({ choose, close }: { choose: () => void; close: () => void }) {
  return (
    <Dialog
      title="What should this suite run?"
      onClose={close}
      actions={
        <Button variant="text" onClick={close}>
          Not now
        </Button>
      }
    >
      <ul className="engine-picker" role="list">
        {engines.map((engine) => (
          <li key={engine.id} className={engine.id === 'k6' ? 'engine-option engine-option-ready' : 'engine-option'}>
            <div>
              <p className="engine-option-name">{engine.name}</p>
              <p className="engine-option-text">{engine.text}</p>
            </div>
            {engine.id === 'k6' ? (
              <Button variant="text" size="sm" onClick={choose} aria-label={`Choose ${engine.name}`}>
                Choose
              </Button>
            ) : (
              <span className="engine-option-planned">Planned</span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
