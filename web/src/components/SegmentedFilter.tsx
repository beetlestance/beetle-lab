import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { rovingIndex } from './Tabs.js';
import './primitives.css';

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  count?: ReactNode | undefined;
  disabled?: boolean | undefined;
};

/**
 * Single-choice segmented control (role radiogroup), used for filters with an
 * optional count per option and for the Darkroom/Scarab skin switch.
 * A missing count is omitted, never shown as zero.
 */
export function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = rovingIndex(
      event,
      index,
      options.map((option) => !option.disabled),
    );
    if (next === undefined) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={['segmented', className].filter(Boolean).join(' ')}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          className="segment"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
          {option.count !== undefined && (
            <>
              {' '}
              <span className="segment-count">{option.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
