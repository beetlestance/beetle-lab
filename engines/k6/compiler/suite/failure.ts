import type { Result, SuiteIssueCode } from './types.js';
export class SuiteFailure extends Error {
  constructor(readonly code: SuiteIssueCode, readonly path: string = '') { super(code); }
}
export function fail(code: SuiteIssueCode, path = ''): never { throw new SuiteFailure(code, path); }
export function rejected<T>(code: SuiteIssueCode, path = ''): Result<T> {
  return { ok: false, issues: Object.freeze([Object.freeze({ code, path: path.slice(0, 256) })]) };
}
export function boundary<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() }; }
  catch (error) {
    if (error instanceof SuiteFailure) return rejected(error.code, error.path);
    return rejected('invalid_json');
  }
}
