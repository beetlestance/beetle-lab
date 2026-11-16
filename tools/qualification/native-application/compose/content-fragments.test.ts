import {expect, it} from 'vitest';
import {readContent} from './public.js';
function response(parts: number, size = 1) {
 let sent = 0; let cancelled = false;
 const stream = new ReadableStream<Uint8Array>({pull(controller) {if (sent++ < parts) controller.enqueue(new Uint8Array(size).fill(0x62)); else controller.close();},
  cancel() {cancelled = true;}});
 return {response: new Response(stream), cancelled: () => cancelled};
}
it('retains the default fragment refusal while permitting a declared bounded larger artifact read', async () => {
 const ordinary = response(300); await expect(readContent(ordinary.response, 1024)).rejects.toThrow('Content fragment bound'); expect(ordinary.cancelled()).toBe(true);
 const artifact = response(300); const bytes = await readContent(artifact.response, 1024, 4096); expect(bytes).toEqual(Buffer.alloc(300, 0x62));
});
it('never relaxes byte limits and rejects invalid read allowances with cancellation', async () => {
 const oversized = response(2, 16); await expect(readContent(oversized.response, 16, 4096)).rejects.toThrow('Content bound'); expect(oversized.cancelled()).toBe(true);
 for (const maximumReads of [0, 4097, 1.5]) {const invalid = response(1); await expect(readContent(invalid.response, 16, maximumReads)).rejects.toThrow(); expect(invalid.cancelled()).toBe(true);}
});
