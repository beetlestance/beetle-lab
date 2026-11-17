import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
export function wrapperFailure(text: string) {
  assert(Buffer.byteLength(text) <= 131072);
  const lines = text.split('\n');
  assert(lines.length <= 1024);
  return lines.flatMap((line) => {
    if (!line.startsWith('{') || line.length > 1024) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return [];
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    return Object.keys(row).sort().join(',') === 'kind,reason' &&
      row.kind === 'wrapper.error' &&
      typeof row.reason === 'string'
      ? [row.reason]
      : [];
  });
}
/** Live read-only attachment works with logging disabled; signals never proxy to the engine. */
export function attach(context: string, id: string) {
  assert(/^[a-f0-9]{64}$/.test(id) && /^[A-Za-z0-9_.-]+$/.test(context));
  const env: NodeJS.ProcessEnv = { ...process.env, DOCKER_API_VERSION: '1.47' };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  let child: ReturnType<typeof execFile>;
  const result = new Promise<{ exit: number; stdoutBytes: number; stderrBytes: number; failures: string[] }>(
    (resolve, reject) => {
      child = execFile(
        'docker',
        ['--context', context, 'attach', '--no-stdin', '--sig-proxy=false', id],
        { env, encoding: 'utf8', timeout: 60000, maxBuffer: 131072 },
        (error, stdout, stderr) => {
          let code = 0;
          if (error) {
            if (typeof error.code !== 'number') {
              reject(error);
              return;
            }
            code = error.code;
          }
          try {
            resolve({
              exit: code,
              stdoutBytes: Buffer.byteLength(stdout),
              stderrBytes: Buffer.byteLength(stderr),
              failures: wrapperFailure(stderr),
            });
          } catch (failure) {
            reject(failure);
          }
        },
      );
    },
  );
  void result.catch(() => undefined);
  return {
    result,
    async close() {
      if (child!.exitCode === null && child!.signalCode === null) child!.kill('SIGTERM');
      await result;
    },
  };
}
