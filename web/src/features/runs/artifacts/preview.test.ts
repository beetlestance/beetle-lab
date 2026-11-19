import { expect, it } from 'vitest';
import { artifactPreview, previewLimit } from './preview.js';
const bytes = (s: string) => new TextEncoder().encode(s);
it('formats a small JSON document but leaves deep or amplified JSON bounded', () => {
 expect(artifactPreview(bytes('{"a":1}'))).toBe('{\n  "a": 1\n}');
 const deep = '['.repeat(1000)+'0'+']'.repeat(1000);
 expect(artifactPreview(bytes(deep))).toBe(deep);
 const text = JSON.stringify({a:'x'.repeat(9000)});
 expect(artifactPreview(bytes(text))).toBe(text);
});
it('decodes only a bounded prefix without inventing a replacement at a split UTF-8 codepoint', () => {
 const text='a'.repeat(previewLimit-1)+'€rest';
 const preview=artifactPreview(bytes(text));
 expect(preview).toBe('a'.repeat(previewLimit-1));
 expect(preview.length).toBeLessThanOrEqual(previewLimit);
 expect(()=>artifactPreview(new Uint8Array([255]))).toThrow();
});
it('returns hostile markup as inert text for React to escape, without interpreting it',()=>{
 expect(artifactPreview(bytes('<script>alert(1)</script>'))).toBe('<script>alert(1)</script>');
});
