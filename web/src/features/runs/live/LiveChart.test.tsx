// @vitest-environment jsdom
import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {LiveChart} from './LiveChart.js';
afterEach(cleanup);
it('keeps a single measured point visible on either side of a missing interval',()=>{
 const view=render(<LiveChart title="Measured windows" xs={[1000,4000]} domain={[0,5000]} breaks={[false,true]} series={[{key:'p95',label:'p95',tone:'amber',values:[25,30]}]} format={String}/>);
 const lines=[...view.container.querySelectorAll('.live-line')];
 expect(lines).toHaveLength(2);expect(lines.every(line=>!line.getAttribute('d')?.includes(' L'))).toBe(true);
 expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(2);
});
it('connects contiguous windows without adding singleton markers',()=>{
 const view=render(<LiveChart title="Measured windows" xs={[1000,2000]} domain={[0,5000]} breaks={[false,false]} series={[{key:'p95',label:'p95',tone:'amber',values:[25,30]}]} format={String}/>);
 expect(view.container.querySelectorAll('.live-line')).toHaveLength(1);
 expect(view.container.querySelector('.live-line')?.getAttribute('d')).toContain(' L');
 expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(0);
});
