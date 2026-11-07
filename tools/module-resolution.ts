import ts from 'typescript';
import { resolve, relative } from 'node:path';

/** Use the same module resolver as the source compiler, including TSX/index imports. */
export function resolveLocalImport(file: string, target: string, known: ReadonlySet<string>): string | undefined {
  const result = ts.resolveModuleName(target, resolve(file), {
    moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true
  }, ts.sys).resolvedModule;
  if (!result) return undefined;
  const local = relative(process.cwd(), result.resolvedFileName);
  return known.has(local) ? local : undefined;
}
