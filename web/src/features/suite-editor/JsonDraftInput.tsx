import { useLayoutEffect, useMemo, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import './json-draft.css';

/** Native editing and selection, with a bounded, non-interactive template-line accent. */
export function JsonDraftInput({
  value,
  className = '',
  accentTemplates = false,
  onScroll,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string; accentTemplates?: boolean }) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const paint = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => {
    if (!accentTemplates || !value.includes('{{')) return null;
    const rows = value.split('\n', 4097);
    return rows.length <= 4096 ? rows : null;
  }, [value, accentTemplates]);
  useLayoutEffect(() => {
    if (paint.current && editor.current) {
      paint.current.scrollTop = editor.current.scrollTop;
      paint.current.scrollLeft = editor.current.scrollLeft;
    }
  }, [value, lines]);
  return (
    <div className={`json-draft-input ${lines ? 'json-draft-accent' : ''}`}>
      {lines && (
        <pre ref={paint} aria-hidden="true" className={`input code-input json-draft-paint ${className}`}>
          {lines.map((line, at) => (
            <span key={at} className={line.includes('{{') ? 'json-template-line' : undefined}>
              {line}
              {at < lines.length - 1 ? '\n' : '\n '}
            </span>
          ))}
        </pre>
      )}
      <textarea
        {...props}
        ref={editor}
        value={value}
        className={`input code-input ${className}`}
        wrap="off"
        spellCheck={false}
        onScroll={(event) => {
          if (paint.current) {
            paint.current.scrollTop = event.currentTarget.scrollTop;
            paint.current.scrollLeft = event.currentTarget.scrollLeft;
          }
          onScroll?.(event);
        }}
      />
    </div>
  );
}
