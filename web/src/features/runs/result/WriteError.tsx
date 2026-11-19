import { errorMessage } from '../../../app/api.js';
import { Button } from '../../../components/Button.js';
import type { Write } from './useWrite.js';

export function WriteError({ write, label }: { write: Write; label: string }) {
  if (!write.error) return null;
  return (
    <p role="alert" className="result-inline-error">
      {errorMessage(write.error.failure)}
      {write.error.unknown && (
        <>
          {' '}
          The outcome is unknown.{' '}
          <Button variant="text" size="sm" onClick={write.retry} disabled={write.pending}>
            {label}
          </Button>
        </>
      )}
    </p>
  );
}
