import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { UploadWorkflow } from '../input-upload/workflow.js';
import type { UploadAction, UploadState } from '../input-upload/workflow.js';
import { DirectoryFolders } from './folders.js';
import { DirectoryError } from './plan.js';
import type { DirectoryPlan } from './plan.js';
export interface DirectoryRow {readonly path: string; readonly status: 'pending' | 'current' | 'published' | 'skipped'; readonly bytes: number}
export interface DirectoryState {
  readonly busy: boolean; readonly retained: boolean; readonly message: string; readonly rows: readonly DirectoryRow[];
  readonly current?: UploadState; readonly complete: boolean;
}
interface Options {api: ApiClient; transfers: InputTransferClient; workspace: Workspace; changed: (state: DirectoryState) => void; invalidate: () => void}
/** One parent intent, one file workflow; no batch bytes, retries or rollback. */
export class DirectoryWorkflow {
  state: DirectoryState = {busy: false, retained: false, message: '', rows: [], complete: false};
  private plan: DirectoryPlan | undefined;
  private folders: DirectoryFolders | undefined;
  private index = 0;
  private child: UploadWorkflow | undefined;
  private active: AbortController | undefined;
  private departed = false;
  constructor(private readonly options: Options) {}
  start(plan: DirectoryPlan, destination: string): Promise<void> | undefined {
    if (this.plan || this.departed) return;
    this.plan = plan; this.folders = new DirectoryFolders(this.options.api, this.options.workspace, destination, this.options.invalidate);
    this.update({retained: true, rows: plan.files.map(file => ({path: file.path, bytes: file.file.size, status: 'pending'}))});
    return this.run();
  }
  async run(action?: UploadAction): Promise<void> {
    if (!this.ready()) return;
    const controller = new AbortController(); this.active = controller; this.update({busy: true, message: 'Importing directory…'});
    try {
      await this.folders!.initialize(Math.max(...this.plan!.files.map(file => file.folders.length)), controller.signal);
      if (this.child && action) await this.child.run(action);
      await this.advance(controller.signal);
    } catch (error) {
      if (!this.departed) this.update({message: error instanceof DirectoryError ? error.message : 'Import could not be confirmed. Retry or discard explicitly.'});
    } finally {this.active = undefined; if (!this.departed) this.update({busy: false});}
  }
  private async advance(signal: AbortSignal): Promise<void> {
    const plan = this.plan!;
    while (this.index < plan.files.length) {
      this.check(signal); const file = plan.files[this.index]!;
      if (!this.child) {
        this.row('current'); const folderId = await this.folders!.resolve(file.folders, signal); this.check(signal);
        this.child = new UploadWorkflow({...this.options, changed: current => {this.update({current});}});
        await this.child.start(file.file, file.name, folderId);
      }
      this.check(signal);
      if (this.child.state.phase !== 'complete') {this.update({message: 'Current file needs an explicit recovery action. Later files have not started.'}); return;}
      this.row('published'); this.child.dispose(); this.child = undefined; this.index++; this.clearCurrent();
    }
    this.update({complete: true, message: 'Directory import complete. Published files are confirmed; skipped files were not completed.'});
  }
  cancel(): void {this.active?.abort(); this.child?.cancel();}
  skip(): Promise<void> | undefined {
    if (this.state.busy || !this.child || this.departed || this.state.complete) return;
    this.child.dispose(); this.child = undefined; this.row('skipped'); this.index++; this.clearCurrent(); return this.run();
  }
  dispose(): void {
    this.departed = true; this.active?.abort(); this.child?.dispose(); this.child = undefined;
    this.plan = undefined; this.folders = undefined; this.options.changed = () => {}; this.options.invalidate = () => {};
  }
  private ready(): boolean {return !!this.plan && !!this.folders && !this.state.busy && !this.departed && !this.state.complete;}
  private clearCurrent(): void {const next = {...this.state}; delete next.current; this.state = next;}
  private row(status: DirectoryRow['status']): void {this.update({rows: this.state.rows.map((row, index) => index === this.index ? {...row, status} : row)});}
  private check(signal: AbortSignal): void {if (signal.aborted || this.departed) throw new DirectoryError('Import cancelled. Partial backend data remains; no rollback was attempted.');}
  private update(update: Partial<DirectoryState>): void {if (!this.departed) {this.state = {...this.state, ...update}; this.options.changed(this.state);}}
}
