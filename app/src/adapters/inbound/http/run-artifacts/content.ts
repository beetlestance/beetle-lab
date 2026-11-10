import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { OutputByteError } from '../../../../ports/output-bytes.js';
import type { OutputByteStore, OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { RequestContext } from '../request-lifetimes/index.js';
import { writeContent } from '../byte-content.js';
import { ApiFault } from '../api-errors.js';
interface Range {start: number; endExclusive: number}
function begin(reply: FastifyReply, record: OutputFileRecord, range: Range | undefined): void {
  const artifact = record.artifact;
  reply.hijack(); reply.raw.writeHead(range ? 206 : 200, {
    'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes', ETag: `"${artifact.sha256}"`,
    'Content-Disposition': `attachment; filename="artifact-${artifact.artifactId}.bin"`,
    ...(artifact.bytes ? {'Transfer-Encoding': 'chunked'} : {'Content-Length': '0'}),
    ...(range ? {'Content-Range': `bytes ${range.start}-${range.endExclusive - 1}/${artifact.bytes}`} : {}),
  });
}
/** One native range job; keep socket EOF behind original result, settlement and streamed integrity. */
export async function sendArtifact(input: {reply: FastifyReply; owner: RequestContext; record: OutputFileRecord;
  range: Range | undefined; bytes: Pick<OutputByteStore, 'read'>}): Promise<FastifyReply> {
  const {reply, owner, record, range, bytes} = input;
  const selected = range ?? {start: 0, endExclusive: record.artifact.bytes};
  const hash = createHash('sha256'); let count = 0; let started = false;
  try {
    await owner.run(async () => {
      const job = bytes.read({record, ...selected, sink: {write: async chunk => {
        owner.check();
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1 || chunk.byteLength > 65536
          || count + chunk.byteLength > selected.endExclusive - selected.start) throw new ApiFault('storage_unavailable');
        count += chunk.byteLength; if (!range) hash.update(chunk);
        if (!started) { begin(reply, record, range); started = true; }
        await writeContent(reply, chunk, owner.signal);
      }}}, {signal: owner.signal, deadline: owner.deadline, freeSpaceReserveBytes: 0});
      const results = await Promise.allSettled([job.result, job.settled]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    });
    owner.check();
    if (count !== selected.endExclusive - selected.start || (!range && hash.digest('hex') !== record.artifact.sha256)) {
      throw new ApiFault('storage_unavailable');
    }
    if (!started) begin(reply, record, range);
    reply.raw.end(); return reply;
  } catch (error) {
    if (started) { reply.raw.destroy(); return reply; }
    if (error instanceof OutputByteError) throw new ApiFault(error.code === 'busy' ? 'capacity_unavailable' : 'storage_unavailable');
    throw error;
  }
}
