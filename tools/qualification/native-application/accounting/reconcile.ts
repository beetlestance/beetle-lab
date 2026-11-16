import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {Run} from '@beetle/contracts/api';
import {namespaceCaps} from '../../../../agent/src/staging-namespace/index.js';
import {inventory} from './files.js';
import type {Leaf} from './files.js';
import type {backend} from './backend.js';
import type {agent} from './agent.js';
function prefixes(files:readonly string[]){const allowed=new Set(['']);for(const file of files){const parts=file.split('/');for(let n=1;n<parts.length;n++)allowed.add(parts.slice(0,n).join('/'));}return allowed;}
export async function reconcile(data:string,runs:readonly Run[],backendState:ReturnType<typeof backend>,agentState:ReturnType<typeof agent>){
 const budget={entries:0,bytes:0,deadline:performance.now()+60000};
 const published=await inventory(join(data,'backend/outputs/published'),budget);const staging=await inventory(join(data,'backend/outputs/staging'),budget);
 const expected=new Set(backendState.artifacts.map(item=>item.published));assert.deepEqual(new Set(published.files.keys()),expected);assert.equal(staging.files.size,0);
 const allowed=prefixes([...expected]);for(const tree of [published,staging])for(const directory of tree.directories)assert(allowed.has(directory));
 for(const item of backendState.artifacts)assert.deepEqual(published.files.get(item.published),{bytes:item.bytes,sha256:item.sha256});
 const tasks=await inventory(join(data,'agent/staging'),budget);const names=new Set(agentState.holds.map(item=>item.runtimeName));
 assert.deepEqual(tasks.files.get(namespaceCaps.markerName),agentState.marker);
 for(const directory of tasks.directories)if(directory)assert(names.has(directory.split('/')[0]!));
 for(const file of tasks.files.keys())if(!file.includes('/'))assert.equal(file,namespaceCaps.markerName);
 const owners=agentState.holds.map(hold=>ownerFiles(tasks.files,hold,backendState.artifacts,runs));
 return {publishedFiles:published.files.size,publishedBytes:[...published.files.values()].reduce((sum,item)=>sum+item.bytes,0),stagingFiles:0,owners,inspectedEntries:budget.entries,inspectedFileBytes:budget.bytes};
}

function ownerFiles(files:ReadonlyMap<string,Leaf>,hold:ReturnType<typeof agent>['holds'][number],artifacts:ReturnType<typeof backend>['artifacts'],runs:readonly Run[]){
 let output=0;let other=0;let count=0;
 for(const [name,leaf] of files)if(name.startsWith(hold.runtimeName+'/')){count++;if(name.startsWith(hold.runtimeName+'/output/'))output+=leaf.bytes;else other+=leaf.bytes;}
 assert(count>0&&output<=hold.outputBytes&&other<=hold.stagingBytes);
 for(const item of artifacts.filter(item=>item.attemptId===hold.attemptId))assert.deepEqual(files.get(hold.runtimeName+'/output/'+item.relativePath),{bytes:item.bytes,sha256:item.sha256});
 assert(runs.some(run=>run.activeAttemptId===hold.attemptId));return {files:count,outputFileBytes:output,otherTaskFileBytes:other};
}
