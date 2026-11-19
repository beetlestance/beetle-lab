// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LiveChart } from './LiveChart.js';
afterEach(cleanup);
it('keeps a tight threshold scale while expanding to include readings over the limit', () => {
  const draw = (value: number) => (
    <LiveChart
      title="Whole run latency"
      xs={[1000]}
      domain={[0, 5000]}
      format={String}
      series={[{ key: 'p95', label: 'p95', tone: 'amber', values: [value] }]}
      limit={{ value: 250, label: 'Limit 250 ms' }}
      tightLimitScale
    />
  );
  const view = render(draw(184));
  expect(view.container.querySelector('.live-chart-max')).toHaveTextContent('300');
  view.rerender(draw(510));
  expect(view.container.querySelector('.live-chart-max')).toHaveTextContent('1000');
  expect(view.container.querySelector('.live-single-point')).not.toHaveAttribute('cy', '0');
});
it('withholds shared-clock readouts beyond coverage and inside an explicit gap while preserving a known zero',()=>{
  const props={title:'Target CPU',xs:[0,1000],domain:[0,5000] as const,breaks:[false,true],strictHoverRange:true,
    series:[{key:'cpu',label:'process',tone:'amber' as const,values:[0,20]}],format:String};
  const view=render(<LiveChart {...props} hoverT={3000}/>);
  expect(view.getByRole('img')).toHaveAttribute('aria-label','Target CPU: process no reading');
  expect(view.container.querySelector('.live-cursor')).toBeNull();
  view.rerender(<LiveChart {...props} hoverT={500}/>);expect(view.getByRole('img')).toHaveAttribute('aria-label','Target CPU: process no reading');
  view.rerender(<LiveChart {...props} hoverT={0}/>);expect(view.getByRole('img')).toHaveAttribute('aria-label','Target CPU: process 0');
});
it('keeps a single measured point visible on either side of a missing interval', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000, 4000]}
      domain={[0, 5000]}
      breaks={[false, true]}
      series={[{ key: 'p95', label: 'p95', tone: 'amber', values: [25, 30] }]}
      format={String}
    />,
  );
  const lines = [...view.container.querySelectorAll('.live-line')];
  expect(lines).toHaveLength(2);
  expect(lines.every((line) => !line.getAttribute('d')?.includes(' L'))).toBe(true);
  expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(2);
});
it('connects contiguous windows without adding singleton markers', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000, 2000]}
      domain={[0, 5000]}
      breaks={[false, false]}
      series={[{ key: 'p95', label: 'p95', tone: 'amber', values: [25, 30] }]}
      format={String}
    />,
  );
  expect(view.container.querySelectorAll('.live-line')).toHaveLength(1);
  expect(view.container.querySelector('.live-line')?.getAttribute('d')).toContain(' L');
  expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(0);
});

it('marks only phase annotations as detail while retaining boundaries and current time', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000]}
      domain={[0, 600000]}
      series={[]}
      format={String}
      ticks={[
        { at: 0, label: '00:00' },
        { at: 60000, label: 'Warm up ends 01:00', detail: true },
        { at: 316000, label: 'now 05:16' },
        { at: 600000, label: '10:00' },
      ]}
    />,
  );
  expect([...view.container.querySelectorAll('.live-tick-detail')].map((node) => node.textContent)).toEqual([
    'Warm up ends 01:00',
  ]);
  expect(
    [...view.container.querySelectorAll('.live-ticks > span:not(.live-tick-detail)')].map((node) => node.textContent),
  ).toEqual(['00:00', 'now 05:16', '10:00']);
});

it.each([Number.MAX_VALUE, 1e308, Number.MIN_VALUE])(
  'plots extreme finite source value %s without overflow, underflow or false zero',
  (value) => {
    const view = render(
      <LiveChart
        title="Measured windows"
        xs={[1000]}
        domain={[0, 5000]}
        series={[{ key: 'actual', label: 'actual', tone: 'amber', values: [value] }]}
        format={String}
      />,
    );
    const path = view.container.querySelector('.live-line')?.getAttribute('d') ?? '';
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path).not.toBe('');
    const marker = view.container.querySelector('.live-single-point')!;
    expect(Number(marker.getAttribute('cy'))).toBeLessThan(150);
    expect(Number(marker.getAttribute('cy'))).toBeGreaterThanOrEqual(8);
    expect(view.getByRole('img').getAttribute('aria-label')).toContain(String(value));
    const ceiling = Number(view.container.querySelector('.live-chart-max')?.textContent);
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(ceiling).toBeGreaterThanOrEqual(value);
  },
);

it('preserves independent recorded source coordinates without union-grid fill or cross-series hover indices',()=>{
 const props={title:'Independent recordings',xs:[1000,3000],domain:[0,5000] as const,strictHoverRange:true,format:String,
  series:[{key:'a',label:'a',tone:'amber' as const,xs:[1000,3000],values:[0,30]},
   {key:'b',label:'b',tone:'info' as const,xs:[2000,4000],breaks:[false,true],values:[20,40]}]};
 const view=render(<LiveChart {...props} hoverT={1000}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Independent recordings: a 0, b no reading');
 const paths=[...view.container.querySelectorAll('.live-line')].map(node=>node.getAttribute('d'));
 expect(paths[0]).toMatch(/^M120,/);expect(paths[1]).toMatch(/^M240,/);expect(paths).toHaveLength(3);
 view.rerender(<LiveChart {...props} hoverT={2500}/>);expect(view.getByRole('img')).toHaveAttribute('aria-label','Independent recordings: a 30, b no reading');
 const cursor=view.container.querySelector('.live-cursor');expect(cursor).toHaveAttribute('x1','300');
 view.rerender(<LiveChart {...props} hoverT={5000}/>);expect(view.getByRole('img')).toHaveAttribute('aria-label','Independent recordings: a no reading, b no reading');
});

it('uses an explicit aggregate only at rest and preserves source/gap behavior on hover',()=>{
 const base={key:'a',label:'run',tone:'amber' as const,values:[2,8]};
 const props={title:'Recorded VUs',xs:[1000,3000],domain:[0,4000] as const,breaks:[false,true],strictHoverRange:true,format:String};
 const view=render(<LiveChart {...props} series={[{...base,restingValue:5}]}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run 5');
 view.rerender(<LiveChart {...props} series={[{...base,restingValue:5}]} hoverT={1000}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run 2');
 view.rerender(<LiveChart {...props} series={[{...base,restingValue:5}]} hoverT={2000}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run no reading');
 view.rerender(<LiveChart {...props} series={[{...base,restingValue:null}]}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run no reading');
 view.rerender(<LiveChart {...props} series={[{...base,restingValue:0}]}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run 0');
 view.rerender(<LiveChart {...props} series={[base]}/>);
 expect(view.getByRole('img')).toHaveAttribute('aria-label','Recorded VUs: run 8');
});

it('retains a known aggregate without inventing axes when no plot samples exist',()=>{
 const props={title:'Recorded request rate',xs:[1000,2000],domain:[0,3000] as const,
  series:[{key:'a',label:'run',tone:'amber' as const,values:[null,null],restingValue:4}],format:String,emptyMessage:'No sampled window readings.'};
 const view=render(<LiveChart {...props}/>);expect(view.getByText('4')).toBeVisible();
 expect(view.getByText('No sampled window readings.')).toBeVisible();expect(view.queryByRole('img')).toBeNull();
 expect(view.container.querySelector('.live-chart-max')).toBeNull();expect(view.container.querySelector('.live-ticks')).toBeNull();
});
