import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import type {OutputAdoptRequest,OutputCustodyState} from '../../../../ports/output-custody.js';
import type {OutputFileRecord} from '../../../../ports/output-bytes.js';
import type {Owned,SourceEnvelope} from '@beetle/contracts/output-source';
import type {ArtifactOperation} from '../output-artifacts/operations.js';
export type ExportArtifactOperation=ArtifactOperation<ExportOutputBinding>;
import type {ExportArtifacts,ExportKey} from '../../../../ports/exports.js';
import type {ExportJob} from '@beetle/contracts/api';
export type ExportOutputCommand={method:'load'|'source';binding:ExportOutputBinding}
 |{method:'adopt';request:OutputAdoptRequest<ExportOutputBinding>}
 |{method:'artifact';operation:ExportArtifactOperation}
 |{method:'published';key:ExportKey}
 |{method:'absence';request:Parameters<ExportArtifacts['settleAbsence']>[0]};
export type ExportOutputValue=OutputCustodyState<ExportOutputBinding>|OutputFileRecord<ExportOutputBinding>|Owned<SourceEnvelope>|ExportJob|null;
