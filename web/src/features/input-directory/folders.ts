import type { ApiClient, CreateFolderRequest, Folder, Workspace, WorkspaceScope } from '@beetle/contracts/api';
import { directoryLimits, DirectoryError, pathKey } from './plan.js';
export class DirectoryFolders {
  private initialized = false;
  private readonly rows = new Map<string, Folder>();
  private readonly siblings = new Map<string, Folder>();
  private readonly resolved = new Map<string, string>();
  private readonly intents = new Map<string, CreateFolderRequest>();
  private depth = 0;
  readonly scope: WorkspaceScope;
  private readonly params: {organizationId: string; workspaceId: string};
  constructor(private readonly api: ApiClient, private readonly workspace: Workspace, private readonly destination: string,
    private readonly invalidate: () => void) {
    this.scope = Object.freeze({kind: 'workspace', organizationId: workspace.scope.organizationId, workspaceId: workspace.id});
    this.params = {organizationId: this.scope.organizationId, workspaceId: this.scope.workspaceId};
    this.resolved.set('', destination);
  }
  async initialize(maximumDepth: number, signal: AbortSignal): Promise<void> {
    if (this.initialized) return;
    this.rows.clear(); this.siblings.clear(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      this.check(signal);
      const reply = await this.api.listFolders({params: this.params, query: {limit: 100, ...(cursor ? {cursor} : {})}, signal});
      this.check(signal); if (!reply.ok) throw new DirectoryError('Folder inventory could not be confirmed. Retry explicitly.');
      if (!this.sameScope(reply.value.scope)) throw new DirectoryError('Folder inventory belongs to another workspace.');
      for (const folder of reply.value.items) this.remember(folder);
      cursor = reply.value.nextCursor ?? undefined;
      if (!cursor) {this.destinationDepth(maximumDepth); this.initialized = true; return;}
    }
    throw new DirectoryError('Directory import can inspect at most 2000 workspace folders.');
  }
  private destinationDepth(maximumDepth: number): void {
    const selected = this.rows.get(this.destination); const root = this.rows.get(this.workspace.rootFolderId);
    if (!selected || !root || root.parentFolderId !== null) throw new DirectoryError('The selected destination is no longer available.');
    let current = selected; let depth = 0; const seen = new Set<string>();
    while (current.id !== root.id) {
      if (seen.has(current.id) || depth >= directoryLimits.depth) throw new DirectoryError('Destination ancestry could not be confirmed.');
      seen.add(current.id); const parent = current.parentFolderId === null ? undefined : this.rows.get(current.parentFolderId);
      if (!parent) throw new DirectoryError('Destination ancestry could not be confirmed.'); current = parent; depth++;
    }
    this.depth = depth;
    if (depth + maximumDepth > directoryLimits.depth) throw new DirectoryError('The selected directory would exceed eight folder levels at this destination.');
  }
  async resolve(parts: readonly string[], signal: AbortSignal): Promise<string> {
    if (!this.initialized || parts.length + this.depth > directoryLimits.depth) throw new DirectoryError('Folder preparation is incomplete.');
    let parent = this.destination; let path = '';
    for (const name of parts) {
      this.check(signal); path = path ? path + '/' + name : name;
      const known = this.resolved.get(path);
      parent = known ?? await this.folder(path, name, parent, signal); this.resolved.set(path, parent);
    }
    return parent;
  }
  private async folder(path: string, name: string, parentFolderId: string, signal: AbortSignal): Promise<string> {
    let intent = this.intents.get(path);
    if (!intent) {
      const existing = this.siblings.get(parentFolderId + ':' + pathKey(name));
      if (existing) {
        if (existing.name !== name) throw new DirectoryError('An existing folder conflicts with the selected spelling. No folder was replaced.');
        return existing.id;
      }
      if (this.intents.size >= directoryLimits.folders) throw new DirectoryError('Folder creation exceeds the import limit.');
      intent = Object.freeze({scope: this.scope, name, parentFolderId, requestId: crypto.randomUUID()}); this.intents.set(path, intent);
    }
    const reply = await this.api.createFolder({params: this.params, body: intent, signal});
    this.check(signal);
    if (!reply.ok) throw new DirectoryError('Folder creation is unconfirmed or refused. Explicit retry keeps its original request; no folder is overwritten.');
    const folder = reply.value;
    if (!this.sameScope(folder.scope) || folder.name !== name || folder.parentFolderId !== parentFolderId) throw new DirectoryError('Created folder identity does not match this import.');
    this.remember(folder); this.invalidate(); return folder.id;
  }
  private sameScope(scope: WorkspaceScope): boolean {return scope.organizationId === this.scope.organizationId && scope.workspaceId === this.scope.workspaceId;}
  private remember(folder: Folder): void {
    if (!this.sameScope(folder.scope) || this.rows.has(folder.id)) throw new DirectoryError('Folder inventory has a conflicting identity.');
    if (this.rows.size >= directoryLimits.workspaceFolders + directoryLimits.folders) throw new DirectoryError('Folder inventory exceeds the import limit.');
    if (folder.parentFolderId !== null) {
      const key = folder.parentFolderId + ':' + pathKey(folder.name);
      if (this.siblings.has(key)) throw new DirectoryError('Folder inventory has conflicting sibling names.'); this.siblings.set(key, folder);
    }
    this.rows.set(folder.id, folder);
  }
  private check(signal: AbortSignal): void {if (signal.aborted) throw new DirectoryError('Import cancelled. Partial backend folders or inputs may remain.');}
}
