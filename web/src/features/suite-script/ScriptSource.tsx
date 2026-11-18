import { useId, useMemo, useState } from 'react';
import './source.css';

const lineHeight = 21;
const inset = 10;
const maximumHeight = 640;

/** Four index bytes per line under the verified 1 MiB source cap; no DOM node per newline. */
function lineStarts(text: string): Uint32Array {
  let count = 1;
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10) count++;
  const starts = new Uint32Array(count);
  let line = 1;
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10) starts[line++] = at + 1;
  return starts;
}

/** The pane renders only visible rows; Copy and Export retain the entire verified source. */
export function ScriptSource({ text }: { text: string }) {
  const hint = useId();
  const [scrollTop, setScrollTop] = useState(0);
  const starts = useMemo(() => lineStarts(text), [text]);
  const count = starts.length;
  const start = Math.max(0, Math.min(count - 1, Math.floor(scrollTop / lineHeight) - 1));
  const end = Math.min(count, start + 34);
  const gutter = `max(48px, calc(${String(count).length}ch + 16px))`;
  return (
    <>
      <div
        className="script-source bounded-script-source"
        role="region"
        aria-label="Script source"
        aria-describedby={hint}
        tabIndex={0}
        style={{ height: Math.min(maximumHeight, count * lineHeight + inset * 2) }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="script-scroll-space" style={{ height: count * lineHeight + inset * 2 }}>
          <div className="script-source-window" style={{ top: inset + start * lineHeight }}>
            {Array.from({ length: end - start }, (_, at) => {
              const index = start + at;
              const line = text.slice(starts[index], index + 1 < count ? starts[index + 1]! - 1 : text.length);
              return (
                <div className="script-source-line" key={index} style={{ gridTemplateColumns: `${gutter} auto` }}>
                  <span className="script-line-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <code>{line || ' '}</code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="script-note" id={hint}>
        Scroll the panel for all {count.toLocaleString('en-US')} lines. Copy script and Export script include the
        complete source.
      </p>
    </>
  );
}
