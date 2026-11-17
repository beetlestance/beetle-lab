import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Fixture } from '../compose/fixture.js';
import type { setup } from './fixture.js';
const program = `
const f=require('node:fs'),assert=require('node:assert/strict');
const [home,action]=process.argv.slice(1),path=home+'/qualification-filler';
const space=()=>{const s=f.statfsSync(home,{bigint:true});assert.equal(s.type,16914836n);assert.equal(s.bsize*s.blocks,67108864n);return Number(s.bavail*s.bsize);};
if(action==='fill'){
 const before=space(),fd=f.openSync(path,'wx',0o600),block=Buffer.alloc(65536,0x61);let written=0,full=false;
 try{for(let i=0;i<1025;i++){const count=f.writeSync(fd,block);assert(count>0);written+=count;}}
 catch(e){if(e.code!=='ENOSPC')throw e;full=true;}
 finally{f.closeSync(fd);}
 assert(full&&written<=67108864);const available=space();assert(available<65536);
 console.log(JSON.stringify({nativeCode:'ENOSPC',beforeBytes:before,writtenBytes:written,availableBytes:available}));
}else{
 assert.equal(action,'free');const s=f.lstatSync(path);assert(s.isFile()&&s.nlink===1&&s.uid===1000&&s.gid===1000&&(s.mode&511)===384);
 f.unlinkSync(path);const available=space();assert(available>0);console.log(JSON.stringify({freed:true,availableBytes:available}));
}`;
export function fill(f: Fixture, configured: ReturnType<typeof setup>, action: 'fill' | 'free') {
  const result: unknown = JSON.parse(
    f.docker.run([...configured.base, '--entrypoint', 'node', configured.image, '-e', program, f.home, action]),
  );
  assert(result && typeof result === 'object');
  return result;
}
export function prefix(
  f: Fixture,
  configured: ReturnType<typeof setup>,
  input: { scope: { organizationId: string; workspaceId: string }; id: string; sha256: string },
) {
  const path = join(
    f.home,
    'data/backend/inputs/staging',
    input.scope.organizationId,
    input.scope.workspaceId,
    input.id,
    input.sha256,
  );
  const code =
    "const f=require('node:fs'),c=require('node:crypto'),p=process.argv[1],s=f.lstatSync(p);if(!s.isFile()||s.size>65536||s.nlink!==1||s.uid!==1000)process.exit(3);console.log(JSON.stringify({bytes:s.size,sha256:c.createHash('sha256').update(f.readFileSync(p)).digest('hex')}))";
  const result: unknown = JSON.parse(
    f.docker.run([...configured.base, '--entrypoint', 'node', configured.image, '-e', code, path]),
  );
  assert(result && typeof result === 'object');
  return result;
}

export function absent(
  f: Fixture,
  configured: ReturnType<typeof setup>,
  input: { scope: { organizationId: string; workspaceId: string }; id: string; sha256: string },
) {
  const code =
    "const f=require('node:fs'),p=require('node:path');for(const root of ['staging','published']){const file=p.join(process.argv[1],root,...process.argv.slice(2));try{f.lstatSync(file);process.exit(3)}catch(e){if(e.code!=='ENOENT')throw e}}console.log(JSON.stringify({stagingAbsent:true,publishedAbsent:true}));";
  const result: unknown = JSON.parse(
    f.docker.run([
      ...configured.base,
      '--entrypoint',
      'node',
      configured.image,
      '-e',
      code,
      join(f.home, 'data/backend/inputs'),
      input.scope.organizationId,
      input.scope.workspaceId,
      input.id,
      input.sha256,
    ]),
  );
  assert.deepEqual(result, { stagingAbsent: true, publishedAbsent: true });
  return result;
}
