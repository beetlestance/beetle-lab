// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ResultSectionNav} from './SectionNav.js';
afterEach(()=>{cleanup();window.history.replaceState(null,'','/');});
it('selects a deep-linked section and retains real anchor navigation when selecting another',()=>{
 const selected=vi.fn();render(<MemoryRouter initialEntries={['/result#result-charts']}><ResultSectionNav onSelect={selected}/></MemoryRouter>);
 expect(screen.getByRole('link',{name:'Charts'})).toHaveAttribute('aria-current','location');
 const artifacts=screen.getByRole('link',{name:'Artifacts'});fireEvent.click(artifacts);
 expect(artifacts).toHaveAttribute('href','#result-artifacts');expect(artifacts).toHaveAttribute('aria-current','location');expect(selected).toHaveBeenCalledWith('artifacts');
});
it('follows native hash changes and falls back for unknown fragments',()=>{
 render(<MemoryRouter><ResultSectionNav onSelect={()=>undefined}/></MemoryRouter>);
 act(()=>{window.history.replaceState(null,'','#result-endpoints');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByRole('link',{name:'Endpoints'})).toHaveAttribute('aria-current','location');
 act(()=>{window.history.replaceState(null,'','#unknown');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByRole('link',{name:'Summary'})).toHaveAttribute('aria-current','location');
});
