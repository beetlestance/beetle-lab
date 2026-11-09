import type { ApiClient, CreateInputRequest, InputRecord, InputTransferClient,
  PreparedInputBytes, TransitionInputRequest, Workspace } from '@beetle/contracts/api';

export type Phase = 'idle' | 'prepare' | 'replay-create' | 'refresh' | 'resume'
  | 'replay-seal' | 'publishing' | 'complete' | 'stopped';
type Action = Exclude<Phase, 'idle' | 'publishing' | 'complete' | 'stopped'>;
export interface UploadState {
  readonly phase: Phase;
  readonly busy: boolean;
  readonly message: string;
  readonly record?: InputRecord;
  readonly retained: boolean;
}
interface Intent {
  file: File | undefined;
  readonly metadata: Readonly<Pick<CreateInputRequest, 'name' | 'folderId' | 'scope' | 'requestId'>>;
  prepared?: PreparedInputBytes;
  body?: CreateInputRequest;
  id?: string;
  seal?: TransitionInputRequest;
}
interface Options {
  api: ApiClient;
  transfers: InputTransferClient;
  workspace: Workspace;
  changed: (state: UploadState) => void;
  invalidate: () => void;
}
class Paused extends Error {
  constructor(readonly phase: Phase, message: string) { super(message); }
}
const interrupted = 'Interrupted. The request may have taken effect; cancellation does not roll back backend data.';
const failed = 'The operation could not be confirmed. The local draft is retained.';

/** Owns one bounded in-memory intent. Transport originals stay with the shared clients. */
export class UploadWorkflow {
  state: UploadState = { phase: 'idle', busy: false, message: '', retained: false };
  private intent: Intent | undefined;
  private active: AbortController | undefined;
  private departed = false;
  private progressChanged = false;
  private recovery: Phase = 'prepare';
  constructor(private readonly options: Options) {}

  start(file: File, name: string, folderId: string) {
    if (this.intent || this.state.busy || this.departed) return;
    if (file.size > 8 * 1024 * 1024 || !name.trim()) return;
    const scope = Object.freeze({ kind: 'workspace' as const,
      organizationId: this.options.workspace.scope.organizationId, workspaceId: this.options.workspace.id });
    this.intent = { file, metadata: Object.freeze({ name: name.trim(), folderId, scope, requestId: crypto.randomUUID() }) };
    void this.run('prepare');
  }
  dispose() {
    this.departed = true;
    this.active?.abort();
    if (this.intent) { delete this.intent.prepared; this.intent.file = undefined; }
    this.intent = undefined;
    this.options.changed = () => undefined;
    this.options.invalidate = () => undefined;
  }
  cancel() {
    if (!this.state.busy) return;
    this.active?.abort();
    this.update({ message: `${interrupted} Waiting for the current operation to settle.` });
  }
  discard() {
    if (this.state.busy || this.departed) return;
    this.intent = undefined;
    this.state = { phase: 'idle', busy: false, retained: false,
      message: 'Local draft cleared. A partial backend input can remain; no backend data was deleted.' };
    this.options.changed(this.state);
  }
  async run(action: Action) {
    if (!this.canRun(action)) return;
    const controller = new AbortController();
    this.active = controller;
    this.update({ busy: true, retained: true, message: 'Working…' });
    try {
      await this.perform(action, controller.signal);
    } catch (error) {
      if (!this.departed) this.update(error instanceof Paused
        ? { phase: error.phase, message: error.message }
        : { phase: this.recovery, message: controller.signal.aborted ? interrupted : failed });
    } finally {
      this.finish();
    }
  }
  private canRun(action: Action) {
    if (!this.intent || this.state.busy || this.departed) return false;
    if (action === 'refresh') return !!this.intent.id;
    return action === this.state.phase || (action === 'prepare' && this.state.phase === 'idle');
  }
  private finish() {
    this.active = undefined;
    if (this.departed) return;
    if (this.progressChanged) { this.progressChanged = false; this.options.invalidate(); }
    this.update({ busy: false });
  }
  private async perform(action: Action, signal: AbortSignal) {
    if (action === 'prepare') {
      await this.prepare(signal);
      await this.create(signal);
      await this.read(signal);
      if (this.state.phase === 'resume') await this.upload(signal);
    } else if (action === 'replay-create') {
      await this.create(signal);
      await this.read(signal);
    } else if (action === 'replay-seal') {
      await this.seal(signal);
      await this.read(signal);
    } else if (action === 'refresh') {
      await this.read(signal);
    } else if (action === 'resume' && this.state.phase === 'resume') {
      await this.upload(signal);
    }
  }
  private async prepare(signal: AbortSignal) {
    this.check(signal);
    const intent = this.required();
    const file = intent.file;
    if (!file) throw new Paused('stopped', failed);
    this.recovery = 'prepare';
    const reply = await this.options.transfers.prepare({ file, signal });
    this.check(signal);
    if (!reply.ok) throw new Paused('prepare', 'File preparation failed. Retry preparation explicitly or discard the draft.');
    if (reply.value.content.byteLength !== file.size || reply.value.content.byteLength > 8388608
      || !/^[a-f0-9]{64}$/.test(reply.value.sha256)) throw new Paused('stopped', 'Prepared file identity is invalid. Upload has stopped.');
    intent.prepared = reply.value;
    intent.file = undefined;
    intent.body = Object.freeze({ ...intent.metadata, sha256: reply.value.sha256, bytes: reply.value.content.byteLength });
  }
  private async create(signal: AbortSignal) {
    this.check(signal);
    const intent = this.required();
    if (!intent.body) throw new Paused('stopped', failed);
    this.recovery = 'replay-create';
    const reply = await this.options.api.createInput({ params: this.params(), body: intent.body, signal });
    this.check(signal);
    if (!reply.ok) throw new Paused('replay-create', `${failed} Create may have taken effect. Replay uses the identical request.`);
    if (intent.id && intent.id !== reply.value.id) throw new Paused('stopped', 'Input identity changed. No further bytes will be sent.');
    intent.id = reply.value.id;
    this.bind(reply.value);
    this.options.invalidate();
  }
  private async read(signal: AbortSignal) {
    this.check(signal);
    const intent = this.required();
    if (!intent.id) throw new Paused('replay-create', failed);
    this.recovery = 'refresh';
    const reply = await this.options.api.getInput({ params: { ...this.params(), inputId: intent.id }, signal });
    this.check(signal);
    if (!reply.ok) throw new Paused('refresh', 'Current status could not be read. Refresh status explicitly before continuing.');
    this.bind(reply.value);
    this.observe(reply.value);
  }
  private observe(record: InputRecord) {
    const messages = {
      staging: 'Staging status confirmed. Resume sends only the remaining prepared bytes.',
      publishing: 'Publication is pending. Refresh status explicitly to check completion.',
      published: 'Upload complete. Published status is confirmed.',
      failed: 'The backend reports failed. Upload has stopped; the local draft is retained.',
      deleting: 'The backend reports deleting. Upload has stopped.',
      deleted: 'The backend reports deleted. Upload has stopped.',
    };
    const phase = this.observedPhase(record);
    this.update({ record, phase, message: phase === 'replay-seal'
      ? 'Staging status confirmed. The original seal identity is retained; replay it explicitly.' : messages[record.state] });
    if (record.state !== 'staging') this.options.invalidate();
  }
  private observedPhase(record: InputRecord): Phase {
    if (record.state === 'published') return 'complete';
    if (record.state === 'publishing') return 'publishing';
    if (record.state !== 'staging') return 'stopped';
    return this.required().seal ? 'replay-seal' : 'resume';
  }
  private async upload(signal: AbortSignal) {
    const intent = this.required();
    if (!intent.prepared) throw new Paused('stopped', failed);
    let record = this.state.record;
    if (!record || record.state !== 'staging' || intent.seal) return;
    while (record.offset < record.bytes) {
      this.check(signal);
      this.recovery = 'refresh';
      const chunk = intent.prepared.content.subarray(record.offset, record.offset + 65536);
      const reply = await this.options.transfers.append({ record, offset: record.offset, chunk, signal });
      this.check(signal);
      if (!reply.ok) throw new Paused(reply.issued ? 'refresh' : 'resume', reply.issued
        ? 'Chunk outcome is unknown. Read current status explicitly before Resume.' : `${failed} Resume is explicit.`);
      this.bind(reply.value);
      record = reply.value;
      this.update({ record });
      this.progressChanged = true;
    }
    await this.seal(signal);
    await this.read(signal);
  }
  private async seal(signal: AbortSignal) {
    this.check(signal);
    const intent = this.required();
    const record = this.state.record;
    if (!intent.id || !intent.body || !record) throw new Paused('stopped', failed);
    if (!intent.seal) {
      if (record.state !== 'staging' || record.offset !== record.bytes) throw new Paused('refresh', failed);
      intent.seal = Object.freeze({ requestId: crypto.randomUUID(), scope: intent.body.scope, expectedVersion: record.version });
    }
    this.recovery = 'replay-seal';
    const reply = await this.options.api.sealInput({ params: { ...this.params(), inputId: intent.id }, body: intent.seal, signal });
    this.check(signal);
    if (!reply.ok) throw new Paused('replay-seal', 'Seal outcome is unconfirmed. Replay keeps the identical request and version.');
    this.options.invalidate();
  }
  private bind(record: InputRecord) {
    const intent = this.required();
    const body = intent.body;
    if (!body || record.id !== intent.id) throw this.mismatch();
    const scoped = record.scope.organizationId === body.scope.organizationId && record.scope.workspaceId === body.scope.workspaceId;
    if (!scoped || !this.samePayload(record, body)) throw this.mismatch();
  }
  private samePayload(record: InputRecord, body: CreateInputRequest) {
    return record.name === body.name && record.folderId === body.folderId
      && record.sha256 === body.sha256 && record.bytes === body.bytes;
  }
  private mismatch() {
    return new Paused('stopped', 'Input identity does not match this draft. No further bytes will be sent.');
  }
  private required() {
    if (!this.intent) throw new Paused('stopped', failed);
    return this.intent;
  }
  private check(signal: AbortSignal) {
    if (signal.aborted || this.departed) throw new Error('Interrupted');
  }
  private params() {
    const scope = this.required().metadata.scope;
    return { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  }
  private update(update: Partial<UploadState>) {
    if (this.departed) return;
    this.state = { ...this.state, ...update };
    this.options.changed(this.state);
  }
}
