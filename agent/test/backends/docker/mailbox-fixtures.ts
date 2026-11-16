import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { UnixDockerTransport, type RequestFactory } from '../../../src/backends/docker/index.js';

export function tarHeader(name = 'live-metrics.mailbox', size = MAILBOX_BYTES, type = 48): Uint8Array {
  const header = new Uint8Array(512); const put = (offset: number, text: string) => header.set(new TextEncoder().encode(text), offset);
  put(0, name); put(100, '0000600\0'); put(124, `${size.toString(8).padStart(11, '0')}\0`); header[156] = type;
  put(257, 'ustar\0'); put(263, '00'); header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0); put(148, `${sum.toString(8).padStart(6, '0')}\0 `); return header;
}
export function archive(image = new Uint8Array(MAILBOX_BYTES), name = 'live-metrics.mailbox', type = 48): Uint8Array {
  const bytes = new Uint8Array(512 + Math.ceil(image.length / 512) * 512 + 1024);
  bytes.set(tarHeader(name, image.length, type)); bytes.set(image, 512); return bytes;
}
export function paxArchive(record: string, image = new Uint8Array(MAILBOX_BYTES)): Uint8Array {
  let length = record.length + 3;
  while (length !== record.length + String(length).length + 2) length = record.length + String(length).length + 2;
  const body = new TextEncoder().encode(`${length} ${record}\n`); const prefix = 512 + Math.ceil(body.length / 512) * 512;
  const result = new Uint8Array(prefix + archive(image).length);
  result.set(tarHeader('PaxHeaders/live-metrics.mailbox', body.length, 120)); result.set(body, 512); result.set(archive(image), prefix); return result;
}
export class FakeResponse extends EventEmitter {
  statusCode = 200; headers: Record<string, string> = {}; complete = false; destroyed = false;
  destroy() {this.destroyed = true; return this;}
}
export class FakeRequest extends EventEmitter {
  destroyed = false; ended = false;
  end() {this.ended = true; return this;}
  destroy() {this.destroyed = true; return this;}
  respond(body: Uint8Array, response = new FakeResponse()) {
    this.emit('response', response as unknown as IncomingMessage);
    response.emit('data', Buffer.from(body)); response.complete = true; response.emit('end'); return response;
  }
}
export function transportFixture(onCreate?: () => void) {
  const requests: FakeRequest[] = []; const paths: unknown[] = [];
  const factory = ((options: unknown) => {
    const request = new FakeRequest(); requests.push(request); paths.push(options); onCreate?.(); return request as unknown as ClientRequest;
  }) as RequestFactory;
  return {requests, paths, transport: new UnixDockerTransport('/synthetic/beetle-docker.sock', factory)};
}
export const id = 'b'.repeat(64);
