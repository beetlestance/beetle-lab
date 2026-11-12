import type {OutputBinding} from '../../../../domain/output-owner/index.js';
import type {EventBinding} from '../../../../ports/events.js';
import type {OutputArtifactClaim,OutputArtifactProgress} from '../../../../ports/output-artifacts.js';
export type ArtifactOperation<B extends OutputBinding=EventBinding> = {kind: 'outputClaimArtifact'; request: OutputArtifactClaim<B>}
  | {kind: 'outputBeginPublication'; request: OutputArtifactClaim<B>}
  | {kind: 'outputRecordProgress'; request: OutputArtifactProgress<B>}
  | {kind: 'outputRecordPublication'; request: OutputArtifactProgress<B>};
