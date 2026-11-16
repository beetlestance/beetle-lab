import assert from 'node:assert/strict';
/** Only the completed packaged CLI's exact foreign-resume conflict establishes refusal. */
export function captureResumeRefusal(input: {exitCode: number; oomKilled: boolean; logs: string}) {
 assert.equal(input.exitCode, 1); assert.equal(input.oomKilled, false); assert(Buffer.byteLength(input.logs) <= 16384);
 const codes = input.logs.split('\n').filter(line => /^[a-z_]+$/.test(line));
 assert.deepEqual(codes, ['conflict']);
 return {exitCode: 1 as const, code: 'conflict' as const};
}
