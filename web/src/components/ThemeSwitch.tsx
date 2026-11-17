import { useEffect, useState } from 'react';
import { SegmentedFilter } from './SegmentedFilter.js';

export type Skin = 'darkroom' | 'scarab';
const storageKey = 'beetle.theme';

function initialSkin(): Skin {
  try {
    if (localStorage.getItem(storageKey) === 'scarab') return 'scarab';
  } catch {
    /* Browser storage can be unavailable. */
  }
  return 'darkroom';
}

/** Darkroom/Scarab skin switch. The skin is the only persisted browser preference. */
export function ThemeSwitch({ className }: { className?: string | undefined }) {
  const [skin, setSkin] = useState<Skin>(initialSkin);
  useEffect(() => {
    document.documentElement.dataset.theme = skin;
    try {
      localStorage.setItem(storageKey, skin);
    } catch {
      /* The skin remains usable in memory. */
    }
  }, [skin]);
  return (
    <SegmentedFilter
      label="Theme"
      className={className}
      value={skin}
      onChange={setSkin}
      options={[
        { value: 'darkroom', label: 'Darkroom' },
        { value: 'scarab', label: 'Scarab' },
      ]}
    />
  );
}
