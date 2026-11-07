import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { importEdges, importTargets, boundaryIssues, findCycle } from './architecture.js';
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
  it.each([
    'import type { SuiteConfig } from "../compiler/generated/types.js";',
    'export type { SuiteConfig } from "../compiler/generated/types.js";',
    'type S = import("../compiler/generated/types.js").SuiteConfig;',
  ])('permits erased schema-derived plan types: %s', source => {
    expect(boundaryIssues('engines/k6/plan/types.ts', importEdges(source))).toEqual([]);
    const emitted = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: true,
    } }).outputText;
    expect(importTargets(emitted)).toEqual([]);
  });
  it.each([
    'import { SuiteConfig } from "../compiler/generated/types.js";',
    'import { type SuiteConfig } from "../compiler/generated/types.js";',
    'export { type SuiteConfig } from "../compiler/generated/types.js";',
    'import { type SuiteConfig, schemas } from "../compiler/generated/types.js";',
    'export * from "../compiler/generated/types.js";',
    'import("../compiler/generated/types.js");',
    'import type { Compiler } from "../compiler/suite/index.js";',
    'import type { Stats } from "node:fs";',
    'import Fastify from "fastify";',
    'import type { FromSchema } from "json-schema-to-ts";',
    'import { type FromSchema } from "json-schema-to-ts";',
    'import type fs = require("node:fs"); export type X = fs.Stats;',
    'import fs = require("node:fs");',
  ])('rejects compiler values, Node and unapproved dependencies: %s', source => {
    expect(boundaryIssues('engines/k6/plan/types.ts', importEdges(source))).toHaveLength(1);
  });
  it('keeps the plan independent of native runtime and runtime independent of Node', () => {
    expect(boundaryIssues('engines/k6/plan/select.ts', ['../runtime/http.js'])).toHaveLength(1);
    expect(boundaryIssues('engines/k6/plan/select.ts', ['k6/http'])).toHaveLength(1);
    expect(boundaryIssues('engines/k6/runtime/http.ts', ['k6/http', '../plan/index.js'])).toEqual([]);
    expect(boundaryIssues('engines/k6/runtime/http.ts', ['fastify'])).toHaveLength(1);
  });
});
