import assert from 'node:assert/strict';
import { join } from 'node:path';
import { validate } from '@beetle/contracts';
import type { Fixture } from '../../native-application/compose/fixture.js';
import { record } from '../values.js';
const program =
  "const fs=require('node:fs');const token=fs.readFileSync(process.argv[1],'utf8');if(token.length>128)process.exit(3);fetch('http://agent:4312/runner/v1/capabilities',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(3000)}).then(async r=>{const reader=r.body.getReader();const chunks=[];let size=0;for(let n=0;n<128;n++){const part=await reader.read();if(part.done){console.log(JSON.stringify({status:r.status,body:Buffer.concat(chunks,size).toString()}));return;}size+=part.value.length;if(size>65536)throw Error('bound');chunks.push(Buffer.from(part.value));}throw Error('bound')}).catch(()=>process.exit(2));";
export function recoveredAgent(f: Fixture, installation: string): { ready: boolean; status: number | null } {
  try {
    // Probe from the healthy backend peer: avoid injecting repeated Node processes
    // into the recovering quarter-core agent's own CPU/memory/PID allocation.
    const backend = f.compose('ps', '-q', 'backend');
    assert.match(backend, /^[a-f0-9]{64}$/);
    const row = record(
      f.docker.json<unknown>([
        'exec',
        '--user',
        '1000:1000',
        backend,
        'node',
        '-e',
        program,
        join(f.home, 'data/config/agent-token'),
      ]),
    );
    assert(typeof row.status === 'number' && Number.isInteger(row.status) && row.status >= 100 && row.status <= 599);
    if (row.status !== 200) return { ready: false, status: row.status };
    assert(typeof row.body === 'string' && Buffer.byteLength(row.body) <= 65536);
    const checked = validate('Capabilities', JSON.parse(row.body));
    assert(checked.ok);
    return { ready: checked.value.observation.installationId === installation, status: row.status };
  } catch {
    return { ready: false, status: null };
  }
}
