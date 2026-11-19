// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppShell} from './shell/AppShell.js';
vi.mock('./shell/ScopeSwitcher.js',()=>({ScopeSwitcher:()=>null}));
vi.mock('./shell/ActiveRunBadge.js',()=>({ActiveRunBadge:()=>null}));
afterEach(cleanup);
it('lets the browser load the bundled docs document instead of routing to the app fallback',()=>{
 render(<MemoryRouter><AppShell onSearch={()=>{}}><h1>App content</h1></AppShell></MemoryRouter>);
 const docs=screen.getByRole('link',{name:'Docs'});expect(docs).toHaveAttribute('href','/docs/');
 let intercepted:boolean|undefined;
 const observe=(event:MouseEvent)=>{intercepted=event.defaultPrevented;event.preventDefault();};
 document.addEventListener('click',observe,{once:true});
 try{fireEvent.click(docs);expect(intercepted).toBe(false);}finally{document.removeEventListener('click',observe);}
});
it('continues routing normal app destinations inside the application',()=>{
 render(<MemoryRouter><AppShell onSearch={()=>{}}><h1>App content</h1></AppShell></MemoryRouter>);
 let intercepted:boolean|undefined;
 const observe=(event:MouseEvent)=>{intercepted=event.defaultPrevented;event.preventDefault();};
 document.addEventListener('click',observe,{once:true});
 try{fireEvent.click(screen.getByRole('link',{name:'Engines'}));expect(intercepted).toBe(true);}finally{document.removeEventListener('click',observe);}
});
