import type { EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import { PhoneDisclosure } from './PhoneDisclosure.js';
import { RunNote, useResultNote } from './RunNote.js';

export function useResultLayout({
  run,
  engine,
  phone,
  readOnly,
  phaseView,
  samplingIntervalMs,
}: {
  run: Run;
  engine: EngineResult | null;
  phone: boolean;
  readOnly: boolean;
  phaseView: boolean;
  samplingIntervalMs: number | null;
}) {
  const incomplete = run.reason === 'artifact_incomplete';
  const nativeLayout = incomplete && !!engine?.nativeOverview;
  const recordedTarget = engine?.artifacts.some((artifact) => artifact.kind === 'target-runtime') === true;
  const showTarget = phaseView || !nativeLayout || samplingIntervalMs !== null || recordedTarget;
  const state = useResultNote(run);
  const note = (
    <PhoneDisclosure
      id="result-notes"
      title="Notes"
      description="One note per run"
      expanded={!phone && !incomplete}
      className="result-note-disclosure"
    >
      <RunNote state={state} readOnly={readOnly} />
    </PhoneDisclosure>
  );
  return {
    showTarget,
    recordedTarget,
    nativeLayout,
    beforeNote: !phone && !incomplete ? note : null,
    afterNote: !phone && incomplete ? note : null,
    phoneNote: phone ? note : null,
  };
}
