import { Button } from '../../../components/Button.js';
import type { EngineVersionRead } from './data.js';
export function EngineStartLabel({ id, version }: { id: string; version: string | null | undefined }) {
  return (
    <span>
      Starting {id}
      {version ? ` ${version}` : ''} in its own container
    </span>
  );
}
/** Optional metadata failure never changes the startup or metrics owner. */
export function EngineVersionNotice({ read }: { read: EngineVersionRead | undefined }) {
  if (read?.value) return null;
  return (
    <p className="live-note" role="status">
      {read?.pending ? 'Reading engine version…' : 'Engine version unavailable.'}
      {read && !read.pending && (
        <Button size="sm" variant="text" disabled={read.busy} onClick={read.retry}>
          Retry engine version
        </Button>
      )}
    </p>
  );
}
