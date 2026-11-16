/** Private fixed-size failure tree: retain nested causes without logging inputs. */
export function diagnosis(error:unknown){
 const queue:unknown[]=[error];const seen=new Set<unknown>();const lines:string[]=[];
 for(let count=0;count<8&&queue.length;count++){
  const value=queue.shift();if(seen.has(value))continue;seen.add(value);
  if(!(value instanceof Error)){lines.push('Unknown '+typeof value+' failure');continue;}
  lines.push((value.stack??value.message).slice(0,2048));
  if(value.cause!==undefined)queue.push(value.cause);
  if(value instanceof AggregateError)queue.push(...value.errors.slice(0,4));
 }
 return lines.join('\nCaused by:\n').slice(0,16384);
}
