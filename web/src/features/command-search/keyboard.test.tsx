// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {mount,testClient} from './fixtures.js';
import {routes} from '../../app/routes.js';
afterEach(cleanup);
async function setup(){
 const api=testClient(()=>{throw Error('Unexpected runtime request');});const view=mount(api.client,routes.reference);
 await screen.findByRole('heading',{name:'Public API reference'});const trigger=screen.getByRole('button',{name:'Search commands'});trigger.focus();
 return {api,view,trigger};
}
it('owns keyboard focus, traps Tab/arrows, and restores the invoker on Escape',async()=>{
 const f=await setup();fireEvent.keyDown(window,{key:'k',ctrlKey:true});const dialog=await screen.findByRole('dialog',{name:'Search commands'});
 const input=within(dialog).getByRole('searchbox');expect(input).toHaveFocus();expect(document.querySelector('.app-shell')!.parentElement).toHaveAttribute('inert');
 f.trigger.focus();expect(input).toHaveFocus();const links=within(dialog).getAllByRole('link');
 fireEvent.keyDown(input,{key:'ArrowDown'});expect(links[0]).toHaveFocus();fireEvent.keyDown(links[0]!,{key:'ArrowUp'});expect(links.at(-1)).toHaveFocus();
 fireEvent.keyDown(links.at(-1)!,{key:'Tab'});const close=within(dialog).getByRole('button',{name:'Close command search'});expect(close).toHaveFocus();
 fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(links.at(-1)).toHaveFocus();fireEvent.keyDown(links.at(-1)!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(f.trigger).toHaveFocus();expect(f.api.records).toEqual([]);
});
it('filters safely, activates Enter as navigation and focuses the main landmark',async()=>{
 const f=await setup();fireEvent.click(f.trigger);const dialog=await screen.findByRole('dialog');const input=within(dialog).getByRole('searchbox');
 fireEvent.change(input,{target:{value:'API reference'}});expect(within(dialog).getAllByRole('link')).toHaveLength(1);
 fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(document.getElementById('main')).toHaveFocus();
 expect(f.api.records).toEqual([]);fireEvent.click(screen.getByRole('button',{name:'Search commands'}));const next=await screen.findByRole('dialog');
 fireEvent.change(within(next).getByRole('searchbox'),{target:{value:'x'.repeat(10000)}});expect(within(next).getByRole('searchbox')).toHaveValue('x'.repeat(128));
 expect(within(next).getByText('No matching commands or loaded items.')).toBeVisible();fireEvent.mouseDown(next.parentElement!);
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('ignores composition/repeated shortcuts, other modals and unmounted listeners',async()=>{
 const f=await setup();for(const extra of [{isComposing:true},{repeat:true},{shiftKey:true}])fireEvent.keyDown(window,{key:'k',ctrlKey:true,...extra});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();const other=document.createElement('div');other.setAttribute('aria-modal','true');document.body.append(other);
 try{fireEvent.keyDown(window,{key:'k',metaKey:true});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();}finally{other.remove();}
 fireEvent.keyDown(window,{key:'k',metaKey:true});await screen.findByRole('dialog');f.view.unmount();
 await act(async()=>{fireEvent.keyDown(window,{key:'k',ctrlKey:true});});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(f.api.records).toEqual([]);
});
