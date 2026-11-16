import type { DatabaseSync } from 'node:sqlite';
import type { ParentRetentionScope,RetentionSnapshot } from '../../../../domain/retention/index.js';
import { horizon,workspaceWindow } from './rows.js';
function capturedHorizon(db:DatabaseSync,scope:ParentRetentionScope,previous:RetentionSnapshot|null){return previous?.traversal?.horizon??horizon(db,scope);}
export function parentWindow(db:DatabaseSync,scope:ParentRetentionScope,previous:RetentionSnapshot|null){
 const last=capturedHorizon(db,scope,previous);if(!last)return null;
 const rows=workspaceWindow(db,scope,last,previous?.scope??null);
 if(previous?.hasMore)return{selected:previous.scope,next:rows[0]??null,last,previousWindow:previous};
 const selected=rows[0];if(!selected)return null;return{selected,next:rows[1]??null,last,previousWindow:null};
}
