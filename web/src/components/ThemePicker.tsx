import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
function initialTheme(): Theme {
  try {
    const value = localStorage.getItem('beetle.theme');
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Browser storage can be unavailable. */ }
  return 'system';
}
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('beetle.theme', theme); } catch { /* Theme remains usable in memory. */ }
  }, [theme]);
  return <label className="theme-picker">Theme
    <select value={theme} onChange={event => setTheme(event.target.value as Theme)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </select>
  </label>;
}
