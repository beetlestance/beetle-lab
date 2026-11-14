import type { UploadAction, UploadState } from './workflow.js';

export function UploadRecoveryActions({ state, run }: { state: UploadState; run: (action: UploadAction) => void }) {
  return <>
    {state.phase === 'prepare' && <button onClick={() => run('prepare')}>Retry preparation</button>}
    {state.phase === 'replay-create' && <button onClick={() => run('replay-create')}>Replay identical create</button>}
    {state.phase === 'resume' && <button onClick={() => run('resume')}>Resume upload</button>}
    {state.phase === 'replay-seal' && <button onClick={() => run('replay-seal')}>Replay identical seal</button>}
    {state.record && <button onClick={() => run('refresh')}>Refresh upload status</button>}
    {state.phase === 'refresh' && !state.record && <button onClick={() => run('refresh')}>Refresh upload status</button>}
  </>;
}
