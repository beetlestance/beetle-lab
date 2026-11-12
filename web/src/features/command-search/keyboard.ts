import type {KeyboardEvent} from 'react';
export function commandKeys(event:KeyboardEvent,dialog:HTMLDivElement,input:HTMLInputElement,first:()=>void,close:()=>void):void{
 if(event.nativeEvent.isComposing)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
 if(event.key==='Tab'){trap(event,dialog);return;}
 const results=[...dialog.querySelectorAll<HTMLAnchorElement>('[data-command-result]')];
 const index=results.findIndex(result=>result===document.activeElement);const typing=document.activeElement===input;
 if(typing&&event.key==='Enter'){event.preventDefault();first();return;}
 if(!typing&&index<0)return;
 const next=nextIndex(event.key,index,results.length);if(next===null)return;
 event.preventDefault();results[next]?.focus();
}
function nextIndex(key:string,index:number,count:number):number|null{
 if(count===0)return null;
 if(key==='ArrowDown')return (index+1)%count;
 if(key==='ArrowUp')return index<0?count-1:(index+count-1)%count;
 return null;
}
function trap(event:KeyboardEvent,dialog:HTMLDivElement):void{
 const controls=[...dialog.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),a[href]')];
 const first=controls[0];const last=controls.at(-1);if(!first||!last)return;
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
