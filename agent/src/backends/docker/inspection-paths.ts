/** Installation may inspect named images/networks; it never gains mutation routes. */
export function inspectionPath(path: string): boolean {
  if (/^\/v1\.47\/images\/sha256:[a-f0-9]{64}\/json$/u.test(path)) return true;
  const image = /^\/v1\.47\/images\/([^/]{1,768})\/json$/u.exec(path);
  if (image) return canonical(image[1]!, /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u, true);
  const network = /^\/v1\.47\/networks\/([^/]{1,384})$/u.exec(path);
  return network !== null && canonical(network[1]!, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u, false);
}
function canonical(segment: string, pattern: RegExp, image: boolean): boolean {
  try {
    const value = decodeURIComponent(segment);
    if (!pattern.test(value) || encodeURIComponent(value) !== segment) return false;
    return !image || value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
  } catch { return false; }
}
