import { sourceRecord } from './catalog.js';
import type { SourceCatalog } from './catalog.js';
function rows(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error('Source coverage list bound');
  return value.map(sourceRecord);
}
function coveredOrigin(pkg: Record<string, unknown>, catalog: SourceCatalog): string {
  const origin = pkg.SrcName;
  const version = pkg.SrcVersion;
  if (typeof origin !== 'string' || typeof version !== 'string') throw Error('OS source origin unavailable');
  const known = catalog.alpine.find((item) => item.origin === origin);
  const nginx = catalog.upstream.find((item) => item.name === 'nginx');
  const matched =
    origin === 'nginx' ? version.replace(/-r\d+$/, '') === nginx?.version : version === known?.packageVersion;
  if (!matched) throw Error('Installed OS source version not covered');
  return origin;
}
/** Cover every installed OS origin, retaining its exact recipe and version; not just flagged licenses. */
export function verifySourceCoverage(scan: unknown, catalog: SourceCatalog): readonly string[] {
  const source = sourceRecord(scan);
  const covered = new Set<string>();
  let packages = 0;
  for (const result of rows(source.Results, 128)) {
    if (result.Class !== 'os-pkgs') continue;
    for (const pkg of rows(result.Packages, 512)) {
      covered.add(coveredOrigin(pkg, catalog));
      packages++;
    }
  }
  if (!packages) throw Error('Installed OS source inventory missing');
  return Object.freeze([...covered].sort());
}
export function verifyRuntimeSource(inspected: unknown, role: string, catalog: SourceCatalog): void {
  if (!Array.isArray(inspected) || inspected.length !== 1) throw Error('Source image inspection required');
  const config = sourceRecord(sourceRecord(inspected[0]).Config);
  if (!Array.isArray(config.Env) || config.Env.length > 256) throw Error('Runtime source environment required');
  const name = role === 'frontend' ? 'nginx' : 'node';
  const variable = name === 'nginx' ? 'NGINX_VERSION' : 'NODE_VERSION';
  const source = catalog.upstream.find((item) => item.name === name);
  const matches = config.Env.filter((value) => typeof value === 'string' && value.startsWith(variable + '='));
  if (!source || matches.length !== 1 || matches[0] !== `${variable}=${source.version}`)
    throw Error('Runtime source version mismatch');
}
export function verifyK6Module(scan: unknown, catalog: SourceCatalog): void {
  const packages = rows(sourceRecord(scan).Results, 128).flatMap((result) =>
    result.Class === 'lang-pkgs' ? rows(result.Packages, 512) : [],
  );
  const found = packages.filter((pkg) => pkg.Name === 'go.k6.io/k6/v2');
  if (found.length !== 1 || found[0]!.Version !== `v${catalog.k6Binary.version}`)
    throw Error('k6 binary module source mismatch');
}
