import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
/** A real unread HTTP body. Only one exact armed content request is intercepted. */
export function slowTransport(origin: string) {
  const owner = new SlowTransportOwner(origin);
  return {
    fetch: owner.fetch,
    arm: (path: string) => owner.arm(path),
    state: () => owner.state(),
    close: () => owner.close(),
  };
}

class SlowTransportOwner {
  constructor(private readonly origin: string) {}
  private path: string | undefined;
  private incoming: IncomingMessage | undefined;
  private outgoing: ClientRequest | undefined;
  private requestClosed = false;
  private responseClosed = false;
  private closed: Promise<void> | undefined;
  private finish: (() => void) | undefined;
  private failure: unknown;
  private status: number | undefined;
  private abort: () => void = () => undefined;
  private finishIfClosed = () => {
    if (this.requestClosed && (!this.incoming || this.responseClosed)) this.finish?.();
  };
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, this.origin);
    if (this.path === undefined || url.pathname !== this.path) return fetch(input, init);
    assert(!this.outgoing && init?.method === 'GET');
    this.closed = new Promise((resolve) => {
      this.finish = resolve;
    });
    const signal = init.signal;
    return new Promise<Response>((resolve, reject) => {
      this.outgoing = request(
        url,
        { method: 'GET', headers: Object.fromEntries(new Headers(init.headers)), agent: false },
        (response) => {
          this.incoming = response;
          this.status = response.statusCode;
          response.pause();
          response.once('close', () => {
            this.responseClosed = true;
            signal?.removeEventListener('abort', this.abort);
            this.finishIfClosed();
          });
          response.once('error', (error) => {
            this.failure = error;
          });
          try {
            assert.equal(response.statusCode, 200);
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers))
              if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
            resolve(
              new Response(
                new ReadableStream(
                  {
                    cancel: async () => {
                      this.abort();
                      await this.closed;
                    },
                  },
                  { highWaterMark: 0 },
                ),
                { status: 200, headers },
              ),
            );
          } catch (error) {
            reject(error);
            this.abort();
          }
        },
      );
      this.abort = () => {
        this.outgoing!.destroy();
        this.incoming?.destroy();
      };
      this.outgoing.once('error', (error) => {
        if (!this.incoming) reject(error);
        else this.failure = error;
      });
      this.outgoing.once('close', () => {
        this.requestClosed = true;
        if (!this.incoming) {
          signal?.removeEventListener('abort', this.abort);
          reject(Error('Slow request closed before headers'));
        }
        this.finishIfClosed();
      });
      this.outgoing.setTimeout(8000, this.abort);
      signal?.addEventListener('abort', this.abort, { once: true });
      if (signal?.aborted) this.abort();
      this.outgoing.end();
    });
  };
  arm(contentPath: string) {
    assert(!this.path && contentPath.startsWith('/api/v2/'));
    this.path = contentPath;
  }
  state() {
    return {
      status: this.status,
      bufferedBytes: this.incoming?.readableLength ?? 0,
      complete: this.incoming?.complete ?? false,
      ended: this.incoming?.readableEnded ?? false,
      destroyed: this.incoming?.destroyed ?? false,
    };
  }
  async close() {
    this.abort();
    if (this.closed) await this.closed;
    return { failure: this.failure instanceof Error ? this.failure.name : null };
  }
}
