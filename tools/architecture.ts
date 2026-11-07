import { builtinModules } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import ts from 'typescript';
export interface ArchitectureIssue { file: string; reason: string }
const workspaceOwners: Record<string, string> = {
  '@beetle/backend': 'app', '@beetle/agent': 'agent', '@beetle/frontend': 'web', '@beetle/engine-k6': 'engines'
};
const nodeModules = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
function isModuleCall(expression: ts.LeftHandSideExpression): boolean {
  return expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === 'require');
}
export function importTargets(source: string): string[] {
  const node = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const targets: string[] = [];
  function visit(statement: ts.Node): void {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) targets.push(statement.moduleSpecifier.text);
    if (ts.isCallExpression(statement) && isModuleCall(statement.expression)) {
      const argument = statement.arguments[0];
      if (argument && ts.isStringLiteral(argument)) targets.push(argument.text);
      else targets.push('<unresolved-runtime-import>');
    }
    ts.forEachChild(statement, visit);
  }
  visit(node);
  return targets;
}
function serviceOwner(target: string): string | undefined {
  return Object.entries(workspaceOwners).find(([name]) => target === name || target.startsWith(`${name}/`))?.[1];
}
function environmentIssue(file: string, target: string, resolved: string): string | undefined {
  const nonNode = file.startsWith('web/src/') || file.startsWith('engines/k6/runtime/');
  if (nonNode && nodeModules.has(target)) return `Node API in non-Node runtime: ${target}`;
  if (file.startsWith('engines/k6/runtime/') && resolved.startsWith('engines/k6/')
    && !resolved.startsWith('engines/k6/runtime/')) return `k6 runtime imports Node-owned engine module: ${target}`;
  return undefined;
}
function runtimeIssue(file: string, target: string, resolved: string): string | undefined {
  if (target === '<unresolved-runtime-import>') return 'Computed module import requires explicit architecture review';
  const owner = serviceOwner(target);
  if (owner && owner !== file.split('/')[0]) return `Cross-service package import: ${target}`;
  if (/^(?:app|agent|web|engines)\//.test(resolved) && resolved.split('/')[0] !== file.split('/')[0]) {
    return `Cross-service implementation import: ${target}`;
  }
  return undefined;
}
function layerIssue(file: string, target: string, resolved: string): string | undefined {
  const core = /app\/src\/(domain|ports)\//.test(file);
  const useCase = file.includes('app/src/application/');
  if (file.includes('app/src/domain/') && /app\/src\/(application|ports)\//.test(resolved)) {
    return `Domain imports outer layer: ${target}`;
  }
  if ((core || useCase) && (nodeModules.has(target) || /fastify|sqlite|docker|adapters|bootstrap|node:|react/.test(resolved))) {
    return `Core imports concrete effect: ${target}`;
  }
  return undefined;
}
export function boundaryIssues(file: string, targets: readonly string[]): ArchitectureIssue[] {
  return targets.flatMap(target => {
    const resolved = target.startsWith('.') ? relative(process.cwd(), resolve(dirname(file), target)) : target;
    const reason = environmentIssue(file, target, resolved) ?? runtimeIssue(file, target, resolved) ?? layerIssue(file, target, resolved);
    return reason ? [{ file, reason }] : [];
  });
}
export function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const done = new Set<string>();
  const path: string[] = [];
  function visit(key: string): string[] | null {
    if (path.includes(key)) return [...path.slice(path.indexOf(key)), key];
    if (done.has(key)) return null;
    path.push(key);
    for (const next of edges.get(key) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop(); done.add(key); return null;
  }
  for (const key of edges.keys()) { const cycle = visit(key); if (cycle) return cycle; }
  return null;
}
