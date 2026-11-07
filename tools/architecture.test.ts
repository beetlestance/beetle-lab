import { describe, expect, it } from 'vitest';
import { importTargets, boundaryIssues, findCycle } from './architecture.js';
describe('architecture gate negative fixtures', () => {
  it('detects framework and outbound imports in core', () => {
    expect(boundaryIssues('app/src/domain/run.ts', ['fastify'])).toHaveLength(1);
    expect(boundaryIssues('app/src/application/start.ts', ['../adapters/outbound/sqlite.js'])).toHaveLength(1);
    expect(boundaryIssues('app/src/application/start.ts', ['../ports/store.js'])).toHaveLength(0);
  });
  it('detects another service implementation instead of a shared protocol', () => {
    expect(boundaryIssues('agent/src/main.ts', ['../../app/src/domain/run.js'])).toHaveLength(1);
    expect(boundaryIssues('agent/src/main.ts', ['@beetle/contracts'])).toHaveLength(0);
    expect(boundaryIssues('agent/src/main.ts', ['@beetle/backend'])).toHaveLength(1);
    expect(boundaryIssues('app/src/domain/run.ts', ['../application/start.js'])).toHaveLength(1);
    expect(boundaryIssues('web/src/main.ts', ['fs'])).toHaveLength(1);
    expect(boundaryIssues('engines/k6/runtime/main.js', ['node:fs'])).toHaveLength(1);
    expect(boundaryIssues('engines/k6/runtime/main.ts', ['../wrapper/helper.js'])).toHaveLength(1);
    expect(boundaryIssues('app/src/domain/run.ts', ['fs'])).toHaveLength(1);
  });
  it('extracts imports/reexports and detects a graph cycle', () => {
    expect(importTargets('import type { Run } from "./run.js"; export { run } from "./start.js";')).toEqual(['./run.js', './start.js']);
    expect(findCycle(new Map([['a', ['b']], ['b', ['a']]]))).toEqual(['a', 'b', 'a']);
    expect(findCycle(new Map([['a', ['b']], ['b', []]]))).toBeNull();
  });
  it('checks literal runtime imports and refuses computed imports', () => {
    expect(importTargets('async function f() { return import("fastify"); }')).toEqual(['fastify']);
    expect(importTargets('const x = require("node:fs");')).toEqual(['node:fs']);
    expect(boundaryIssues('agent/src/main.ts', importTargets('import(name)'))).toHaveLength(1);
  });
});
