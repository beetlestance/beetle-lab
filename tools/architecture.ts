import { builtinModules } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import ts from 'typescript';
import { qualificationBoundary } from './qualification-boundaries.js';
export interface ArchitectureIssue { file: string; reason: string }
export interface ImportEdge { target: string; typeOnly: boolean }
const workspaceOwners: Record<string, string> = {
  '@beetle/backend': 'app', '@beetle/agent': 'agent', '@beetle/frontend': 'web', '@beetle/engine-k6': 'engines'
};
const nodeModules = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
function isModuleCall(expression: ts.LeftHandSideExpression): boolean {
  return expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === 'require');
}
function declarationEdge(statement: ts.Node): ImportEdge | undefined {
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return undefined;
  const target = statement.moduleSpecifier;
  if (!target || !ts.isStringLiteral(target)) return undefined;
  return { target: target.text, typeOnly: ts.isImportDeclaration(statement)
    ? statement.importClause?.isTypeOnly === true : statement.isTypeOnly };
}
function typeEdge(statement: ts.Node): ImportEdge | undefined {
  if (!ts.isImportTypeNode(statement) || !ts.isLiteralTypeNode(statement.argument)) return undefined;
  return ts.isStringLiteral(statement.argument.literal)
    ? { target: statement.argument.literal.text, typeOnly: true } : undefined;
}
function callEdge(statement: ts.Node): ImportEdge | undefined {
  if (!ts.isCallExpression(statement) || !isModuleCall(statement.expression)) return undefined;
  const argument = statement.arguments[0];
  return { target: argument && ts.isStringLiteral(argument) ? argument.text : '<unresolved-runtime-import>', typeOnly: false };
}
function equalsEdge(statement: ts.Node): ImportEdge | undefined {
  if (!ts.isImportEqualsDeclaration(statement) || !ts.isExternalModuleReference(statement.moduleReference)) return undefined;
  const expression = statement.moduleReference.expression;
  return { target: ts.isStringLiteral(expression) ? expression.text : '<unresolved-runtime-import>', typeOnly: statement.isTypeOnly };
}
export function importEdges(source: string): ImportEdge[] {
  const node = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const targets: ImportEdge[] = [];
  function visit(statement: ts.Node): void {
    const edge = declarationEdge(statement) ?? typeEdge(statement) ?? callEdge(statement) ?? equalsEdge(statement);
    if (edge) targets.push(edge);
    ts.forEachChild(statement, visit);
  }
  visit(node);
  return targets;
}
export function importTargets(source: string): string[] { return importEdges(source).map(edge => edge.target); }
function serviceOwner(target: string): string | undefined {
  return Object.entries(workspaceOwners).find(([name]) => target === name || target.startsWith(`${name}/`))?.[1];
}
function k6Owner(file: string): 'runtime' | 'plan' | undefined {
  if (file.startsWith('engines/k6/runtime/')) return 'runtime';
  if (file.startsWith('engines/k6/plan/')) return 'plan';
  return undefined;
}
function approvedPlanImport(source: 'runtime' | 'plan', edge: ImportEdge, resolved: string): boolean {
  if (resolved.startsWith('engines/k6/plan/')) return true;
  if (source === 'runtime' && resolved.startsWith('engines/k6/runtime/')) return true;
  return edge.typeOnly && /^engines\/k6\/compiler\/generated\/types\.[jt]s$/.test(resolved);
}
function approvedK6Package(source: 'runtime' | 'plan', edge: ImportEdge): boolean {
  return source === 'runtime' && (edge.target === 'k6' || edge.target.startsWith('k6/'));
}
function k6Boundary(file: string, edge: ImportEdge, resolved: string): string | undefined {
  const source = k6Owner(file);
  if (!source) return undefined;
  if (edge.target.startsWith('.')) return approvedPlanImport(source, edge, resolved)
    ? undefined : `k6 ${source} imports outside its pure boundary: ${edge.target}`;
  if (approvedK6Package(source, edge)) return undefined;
  return `Unsupported dependency in k6 ${source}: ${edge.target}`;
}
function environmentIssue(file: string, edge: ImportEdge, resolved: string): string | undefined {
  const target = edge.target;
  const nonNode = file.startsWith('web/src/') || file.startsWith('engines/k6/runtime/') || file.startsWith('engines/k6/plan/');
  if (nonNode && nodeModules.has(target)) return `Node API in non-Node runtime: ${target}`;
  return k6Boundary(file, edge, resolved);
}
function runtimeIssue(file: string, target: string, resolved: string): string | undefined {
  if (target === '<unresolved-runtime-import>') return 'Computed module import requires explicit architecture review';
  const qualification = qualificationBoundary(file, resolved);
  if (qualification !== undefined) return qualification ? undefined : `Unapproved qualification boundary: ${target}`;
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
export function boundaryIssues(file: string, targets: readonly (string | ImportEdge)[]): ArchitectureIssue[] {
  return targets.flatMap(input => {
    const edge = typeof input === 'string' ? { target: input, typeOnly: false } : input;
    const target = edge.target;
    const resolved = target.startsWith('.') ? relative(process.cwd(), resolve(dirname(file), target)) : target;
    const reason = environmentIssue(file, edge, resolved) ?? runtimeIssue(file, target, resolved) ?? layerIssue(file, target, resolved);
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
