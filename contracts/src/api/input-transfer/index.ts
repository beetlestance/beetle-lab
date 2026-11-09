import type { InputRecord } from '../generated/types.js';
import type { InputAppendRequest, InputPrepareRequest, InputTransferClient, InputTransferOptions, InputTransferRequest, InputTransferResult } from '../input-transfer-types.js';
import { digest } from './integrity.js';
import { prepare, preparation } from './preparation.js';
import { Operation } from './lifetime.js';
import { acknowledgement, bytes, downloadHeaders, json, protocol } from './response.js';
import { configuration, intent, path } from './snapshot.js';
import type { Configuration, Intent } from './snapshot.js';

type Consume<T> = (owner: Operation, request: Intent, response: Response) => Promise<T>;
async function appendReply(owner: Operation, request: Intent, response: Response): Promise<InputRecord> {
  return acknowledgement(request, await json(owner, response));
}
async function downloadReply(owner: Operation, request: Intent, response: Response): Promise<Uint8Array> {
  downloadHeaders(response, request.record);
  const body = await bytes(owner, request.record.bytes, true);
  await digest(owner, body, request.record.sha256);
  return body;
}
function fetchInit(owner: Operation, request: Intent, config: Configuration, append: boolean): RequestInit {
  return { method: append ? 'PUT' : 'GET', credentials: 'same-origin', redirect: 'error', signal: owner.controller.signal,
    headers: append ? { ...config.headers, 'content-type': 'application/octet-stream' } : { ...config.headers },
    ...(request.chunk === undefined ? {} : { body: request.chunk }),
  };
}
interface Transfer<T> { owner: Operation; request: Intent; config: Configuration; append: boolean; consume: Consume<T> }
async function transfer<T>({ owner, request, config, append, consume }: Transfer<T>): Promise<InputTransferResult<T>> {
  let status: number | undefined;
  try {
    owner.check();
    owner.issued = true;
    const response = await config.fetch(config.base + path(request.record) + (append ? `/chunks?offset=${request.offset}` : '/content'), fetchInit(owner, request, config, append) );
    status = response.status;
    owner.acquire(response.body);
    owner.check();
    if (status < 200 || status >= 300) return await protocol(owner, response);
    if (status !== 200) throw new Error('status');
    return { ok: true, value: await consume(owner, request, response) };
  } catch {
    return { ok: false, issued: owner.issued, error: { ...owner.failure(status === undefined ? 'transport' : 'response'), ...(status === undefined ? {} : { status }) } };
  }
}

/** Two slots, no retries; close drains original work even when an adapter ignores abort. */
export function createInputTransferClient(options: InputTransferOptions): InputTransferClient {
  const config = configuration(options);
  const active = new Set<Operation>();
  let closed = false;
  let cleanupFailed = false;
  let closing: Promise<void> | undefined;
  async function run<T, R extends { signal: AbortSignal | undefined }>(input: unknown, capture: (input: unknown) => R, work: (owner: Operation, request: R) => Promise<InputTransferResult<T>>): Promise<InputTransferResult<T>> {
    if (closed) return { ok: false, issued: false, error: { kind: 'closed' } };
    if (active.size === 2) return { ok: false, issued: false, error: { kind: 'busy' } };
    let request: R;
    try { request = capture(input); }
    catch { return { ok: false, issued: false, error: { kind: 'request' } }; }
    // Foreign snapshot work can reenter close; recheck before reserving or issuing.
    if (closed) return { ok: false, issued: false, error: { kind: 'closed' } };
    if (active.size === 2) return { ok: false, issued: false, error: { kind: 'busy' } };
    const owner = new Operation();
    active.add(owner);
    owner.start(request.signal, config.timeout);
    let result = await work(owner, request);
    await owner.finish(result.ok);
    if (owner.controller.signal.aborted) result = { ok: false, issued: owner.issued, error: owner.failure('cancelled') };
    if (owner.cleanupFailed) {
      cleanupFailed = true;
      if (result.ok) result = { ok: false, issued: owner.issued, error: { kind: 'transport' } };
    }
    active.delete(owner);
    owner.retire();
    return result;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    // Install the retained close promise before abort invokes any foreign cancellation.
    const originals = [...active];
    closing = Promise.all(originals.map(owner => owner.done)).then(() => {
      if (cleanupFailed) throw new Error('Input transfer cleanup failed');
    });
    for (const owner of originals) owner.abort('cancelled');
    return closing;
  }
  return {
    prepare: (request: InputPrepareRequest) => run(request, preparation, prepare),
    append: (request: InputAppendRequest) => run(request, input => intent(input, true),
      (owner, request) => transfer({ owner, request, config, append: true, consume: appendReply })),
    download: (request: InputTransferRequest) => run(request, input => intent(input, false),
      (owner, request) => transfer({ owner, request, config, append: false, consume: downloadReply })), close,
  };
}
