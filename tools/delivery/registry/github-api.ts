import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
const execute = promisify(execFile);
export interface GithubReply {status: number; value: unknown; nextPage: boolean}
export interface GithubApi {request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<GithubReply>; upload(tag: string, files: readonly string[]): Promise<void>}
export class GithubDeliveryError extends Error {
  constructor(readonly status: number) {super('GitHub delivery operation unconfirmed');}
}
/** Fixed GitHub API host. Numeric status is retained; raw auth/error text is private. */
export function parseGithubReply(stdout: string): GithubReply {
  const match = /^HTTP\/[0-9.]+\s+([1-5][0-9]{2})[^\n]*\r?\n/.exec(stdout);
  const boundary = stdout.search(/\r?\n\r?\n/);
  if (!match || boundary < 0) throw Error('GitHub delivery response unavailable');
  const headers = stdout.slice(0, boundary); const body = stdout.slice(boundary).trim();
  return {status: Number(match[1]), value: body ? JSON.parse(body) as unknown : null, nextPage: /rel="next"/.test(headers)};
}
export class GithubDelivery implements GithubApi {
  private sequence = 0;
  constructor(private readonly directory: string) {}
  async request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<GithubReply> {
    if (!/^repos\/beetlestance\/beetle-lab\/[A-Za-z0-9_./?=&-]+$/.test(path) || path.length > 1024) throw Error('Fixed delivery API path required');
    const args = ['api', '--hostname', 'github.com', '--include', '--method', method, path];
    if (body !== undefined) {
      const file = join(this.directory, `github-request-${++this.sequence}.json`);
      const bytes = JSON.stringify(body); if (bytes.length > 65536) throw Error('GitHub delivery request bound');
      await writeFile(file, bytes, {flag: 'wx', mode: 0o600}); args.push('--input', file);
    }
    let stdout: string; let failed = false;
    try {({stdout} = await execute('gh', args, {timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 ** 2, encoding: 'utf8'}));}
    catch (error) {
      const failure = error as {stdout?: unknown};
      if (typeof failure.stdout !== 'string') throw new Error('GitHub delivery transport failed', {cause: error}); stdout = failure.stdout; failed = true;
    }
    const reply = parseGithubReply(stdout);
    if (failed && reply.status < 400) throw new GithubDeliveryError(reply.status);
    return reply;
  }
  async upload(tag: string, files: readonly string[]): Promise<void> {
    try {await execute('gh', ['release', 'upload', tag, ...files, '--repo', 'beetlestance/beetle-lab'],
      {timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 65536, encoding: 'utf8'});}
    catch {throw Error('GitHub delivery upload did not confirm completion');}
  }
}
