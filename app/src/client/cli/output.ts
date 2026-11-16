import type { Writable } from 'node:stream';
export interface ClientOutput {write(value: string, signal?: AbortSignal): Promise<void>}
export interface ClientStreams {readonly stdout: ClientOutput; readonly stderr: ClientOutput}
/** Retain failed-write error ownership until error/close, including callback-first EPIPE. */
export function streamOutput(stream: Writable): ClientOutput {
  return {write: (value, signal) => new Promise<void>((resolve, reject) => {
    if (stream.destroyed || stream.writableEnded) {reject(new Error('output_closed')); return;}
    const cleanup = () => {stream.removeListener('error', onError); stream.removeListener('close', onClose); signal?.removeEventListener('abort', onAbort);};
    const onError = () => {cleanup(); reject(new Error('output_failed'));};
    const onClose = () => {cleanup(); reject(new Error('output_closed'));};
    const onAbort = () => {signal?.removeEventListener('abort', onAbort); stream.destroy(new Error('output_interrupted')); reject(new Error('output_interrupted'));};
    stream.once('error', onError); stream.once('close', onClose); signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) {onAbort(); return;}
    try {stream.write(value, error => {
      if (error) {signal?.removeEventListener('abort', onAbort); reject(new Error('output_failed')); return;}
      cleanup(); resolve();
    });} catch {onError();}
  })};
}
