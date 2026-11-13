import type { RetentionPreviewRequest,WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionSnapshot } from '../domain/retention/index.js';
export type WorkspaceRetentionPreviewRequest=Omit<RetentionPreviewRequest,'scope'>&{readonly scope:WorkspaceScope};
export interface WorkspaceRetentionPreviewCommand {readonly id:string;readonly capturedAt:string;readonly request:WorkspaceRetentionPreviewRequest}
/** One bounded immutable page. This interface does not claim parent-scope traversal. */
export interface WorkspaceRetentionStore {preview(command:WorkspaceRetentionPreviewCommand):Promise<RetentionSnapshot>}
