import {useEffect,useId,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {matching,navigation,searchContext} from './model.js';
import type {CommandItem,SearchContext} from './model.js';
import {useCommandItems} from './items.js';
import type {CommandGroup} from './items.js';
import {commandKeys} from './keyboard.js';
import './search.css';
export {useCommandNavigation} from './controller.js';
export function CommandPalette({pathname,close}:{pathname:string;close:(navigate?:boolean)=>void}){
 const context=searchContext(pathname);
 return context.organizationId?<ScopedPalette context={context} close={close} organizationId={context.organizationId} />:<Palette context={context} groups={[]} close={close} />;
}
function ScopedPalette({context,close,organizationId}:{context:SearchContext;close:(navigate?:boolean)=>void;organizationId:string}){
 const groups=useCommandItems(organizationId,context.workspaceId);return <Palette context={context} groups={groups} close={close} />;
}
function Palette({context,groups,close}:{context:SearchContext;groups:CommandGroup[];close:(navigate?:boolean)=>void}){
 const heading=useId();const search=useId();const dialog=useRef<HTMLDivElement>(null);const input=useRef<HTMLInputElement>(null);
 const [query,setQuery]=useState('');const navigate=useNavigate();const matches=matching([...navigation(context),...groups.flatMap(group=>group.items)],query);
 useEffect(()=>{
  input.current?.focus();const focus=(event:FocusEvent)=>{if(event.target instanceof Node&&!dialog.current?.contains(event.target))input.current?.focus();};
  document.addEventListener('focusin',focus);return()=>document.removeEventListener('focusin',focus);
 },[]);
 // A refreshed group can remove the focused link without firing focusin.
 useEffect(()=>{if(dialog.current&&!dialog.current.contains(document.activeElement))input.current?.focus();});
 const pick=(item:CommandItem|undefined)=>{if(item){close(true);void navigate(item.path);}};
 return <div className="command-mask" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
  <div ref={dialog} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby={heading}
   onKeyDown={event=>{if(dialog.current&&input.current)commandKeys(event,dialog.current,input.current,()=>pick(matches.items[0]),()=>close());}}>
   <header className="section-header"><h2 id={heading}>Search commands</h2><button onClick={()=>close()} aria-label="Close command search">Close</button></header>
   <label htmlFor={search}>Search commands and recent items</label><input ref={input} data-command-input id={search} type="search" maxLength={128} value={query} onChange={event=>setQuery(event.target.value.slice(0,128))} />
   <p>Navigation only. Search covers the first 100 items per current scope; showing at most 40 matches.</p>
   <p role="status">{matches.items.length} of {matches.total} matches.</p>
   {groups.filter(group=>group.active).map(group=><div key={group.name}>
    {group.loading&&<p role="status">Loading {group.name}…</p>}{group.error&&<p role="alert">Recent {group.name} could not be loaded.</p>}
    {group.more&&<p>More {group.name} are available in the list view.</p>}
    <button disabled={group.loading} onClick={()=>void group.refresh()}>{group.error?'Retry':'Refresh'} recent {group.name}</button>
   </div>)}
   <nav aria-label="Command search results"><ul>{matches.items.map(item=><li key={item.id}><Link data-command-result to={item.path}
    onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)close(true);}}>
    {item.label}<small>{item.description}</small></Link></li>)}</ul></nav>
   {!matches.total&&<p>No matching commands or loaded items.</p>}
  </div>
 </div>;
}
