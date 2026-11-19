import { encodeJson } from '@beetle/contracts';
export const previewLimit = 65536;
/** Decode at most one text excerpt after full-file integrity verification. */
export function artifactPreview(bytes: Uint8Array): string {
  const truncated = bytes.byteLength > previewLimit;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, previewLimit), { stream: truncated });
  if (truncated || bytes.byteLength > 8192) return text;
  try {
    const value: unknown = JSON.parse(text);
    // Bound depth/nodes before indentation: formatting must not amplify arbitrary JSON.
    encodeJson(value, 8192);
    const formatted = JSON.stringify(value, null, 2);
    return formatted.length <= previewLimit ? formatted : text;
  } catch {
    return text;
  }
}
