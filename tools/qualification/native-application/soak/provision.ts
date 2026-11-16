import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const codes = new Set(['invalid_input', 'inspection', 'unsafe_root', 'conflict', 'recovery_required', 'cancelled', 'deadline', 'io', 'cleanup']);
function fixedCode(stderr: string) {
 if (Buffer.byteLength(stderr) > 65536) return 'internal';
 const lines = stderr.split('\n').map(line => line.trim()).filter(line => /^[a-z_]+$/.test(line));
 if (lines.length !== 1) return 'internal';
 return codes.has(lines[0]!) ? lines[0]! : 'internal';
}
export function provisionDiagnosis(status: number | null, stderr: string, signal: string | null) {
 const code = fixedCode(stderr);
 return {operation: 'installer-cli', code: codes.has(code) ? code : 'internal', exitCode: status !== null && Number.isInteger(status) && status >= 0 && status <= 255 ? status : null,
  signal: signal === 'SIGTERM' || signal === 'SIGKILL' ? signal : null};
}
export class AdvancedCommandError extends Error {
 constructor(readonly diagnosis: ReturnType<typeof provisionDiagnosis>) {super('Bounded advanced installer command failed');}
}
/** Same bounded local Docker command, retaining only the CLI's fixed error classification. */
export function provisionCommand(context: string, args: string[]) {
 assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context));
 const env: NodeJS.ProcessEnv = {...process.env, DOCKER_API_VERSION: '1.47'}; delete env.DOCKER_HOST; delete env.DOCKER_CONTEXT;
 const result = spawnSync('docker', ['--context', context, ...args], {env, encoding: 'utf8', timeout: 60000, maxBuffer: 65536, stdio: ['pipe', 'pipe', 'pipe']});
 if (result.error || result.status !== 0) throw new AdvancedCommandError(provisionDiagnosis(result.status, result.stderr ?? '', result.signal));
 return result.stdout.trim();
}
/** Revalidate the fixed carrier before uploading private-report facts. */
export function publicProvisionDiagnosis(input: unknown) {
 if (!input || typeof input !== 'object') return null;
 const row = input as Record<string, unknown>; if (row.operation !== 'installer-cli') return null;
 const code = typeof row.code === 'string' && codes.has(row.code) ? row.code : 'internal';
 const status = typeof row.exitCode === 'number' ? row.exitCode : null; const signal = typeof row.signal === 'string' ? row.signal : null;
 return provisionDiagnosis(status, code, signal);
}
