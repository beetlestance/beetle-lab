import { get } from 'node:http';
/** Control listener only. Total lifetime is bounded by the caller's abort signal. */
export function probeListener(
  listen: { readonly host: string; readonly port: number },
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(
      {
        host: listen.host === '0.0.0.0' ? '127.0.0.1' : listen.host,
        port: listen.port,
        path: '/healthz',
        method: 'HEAD',
        agent: false,
        signal,
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode === 200));
        response.once('error', () => resolve(false));
      },
    );
    request.once('error', () => resolve(false));
  });
}
