import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { routes } from '../routes.js';
import { useSessionAccess } from '../session.js';
import { SettingsScopeContext, useSettingsScope } from '../settings-scope.js';
import { badgeScope, navItems, shellScope } from '../navigation.js';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { BeetleMark } from './BeetleMark.js';
import { ScopeSwitcher } from './ScopeSwitcher.js';
import { ActiveRunBadge } from './ActiveRunBadge.js';
import './shell.css';

export type AppShellProps = {
  children: ReactNode;
  /** Opens command search; the shell's Search entry and ⌘K both call it. */
  onSearch: () => void;
};

/** Header from every Penpot board plus the phone menu sheet ("Phone / Menu open"). */
export function AppShell({ children, onSearch }: AppShellProps) {
  const { pathname } = useLocation();
  const settingsScope = useSettingsScope(pathname);
  const { signOut } = useSessionAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  const onMenuKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !menuOpen) return;
    setMenuOpen(false);
    menuButton.current?.focus();
  };
  return (
    <div className="shell" data-menu-open={menuOpen || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {/* eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- Menu keys bubble up from the buttons inside. */}
      <header className="shell-header" onKeyDown={onMenuKey}>
        <Link className="shell-brand" to={routes.organizations} aria-label="Beetle Lab home">
          <BeetleMark />
          <span className="shell-brand-name">Beetle Lab</span>
        </Link>
        <ScopeSwitcher key={pathname} scope={shellScope(pathname)} path={pathname} />
        <button
          ref={menuButton}
          type="button"
          className="btn btn-secondary btn-sm shell-menu-button"
          aria-expanded={menuOpen}
          aria-controls="shell-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
        <div className="shell-menu" id="shell-menu">
          <ShellNav pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          <div className="shell-tools">
            <button
              type="button"
              className="btn btn-sm shell-search"
              aria-label="Search commands"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={onSearch}
            >
              Search
              <kbd aria-hidden="true">⌘K</kbd>
            </button>
            <ThemeSwitch className="shell-theme" />
            {signOut && (
              <button type="button" className="btn btn-text btn-sm shell-sign-out" onClick={signOut}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="shell-main">
        <SettingsScopeContext.Provider value={settingsScope}>{children}</SettingsScopeContext.Provider>
      </main>
    </div>
  );
}

function ShellNav({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  return (
    <nav aria-label="Main navigation" className="shell-nav">
      <ul role="list">
        {navItems(pathname).map((item) => (
          <li key={item.key}>
            <Link
              to={item.to}
              reloadDocument={item.key === 'docs'}
              aria-current={item.current ? 'page' : undefined}
              onClick={onNavigate}
            >
              {item.label}
              {item.key === 'workspaces' && <ActiveRunBadge {...badgeScope(pathname)} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
