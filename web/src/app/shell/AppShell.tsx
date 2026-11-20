import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { routes } from '../routes.js';
import { useSessionAccess } from '../session.js';
import { SettingsScopeContext, useSettingsScope } from '../settings-scope.js';
import { badgeScope, navItems, shellScope } from '../navigation.js';
import { Badge, Status } from '../../components/Badge.js';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { BeetleMark } from './BeetleMark.js';
import { ScopeSwitcher } from './ScopeSwitcher.js';
import { ActiveRunBadge } from './ActiveRunBadge.js';
import { ConnectionBanner } from './ConnectionBanner.js';
import { UpgradeBanner } from '../../features/upgrade/UpgradeBanner.js';
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
  const { readOnly, signOut } = useSessionAccess();
  const { menuOpen, menuButton, setMenuOpen } = usePhoneMenu(pathname);
  return (
    <div className="shell" data-menu-open={menuOpen || undefined} data-read-only={readOnly || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell-header">
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
            {readOnly && (
              <Badge tone="history">
                <Status tone="info">Restored · read-only</Status>
              </Badge>
            )}
            <button
              type="button"
              className="btn btn-sm shell-search"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={onSearch}
            >
              {/* The name extends the visible word, so it stays "Search commands" without an
                  aria-label that would hide the visible label (label-content-name-mismatch). */}
              {'Search '}
              <span className="sr-only">commands</span>
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
      <main id="main" tabIndex={-1} className="shell-main" inert={menuOpen}>
        <ConnectionBanner />
        <UpgradeBanner />
        <SettingsScopeContext.Provider value={settingsScope}>{children}</SettingsScopeContext.Provider>
      </main>
    </div>
  );
}

function usePhoneMenu(pathname: string) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    if (!menuOpen) return;
    const compact = window.matchMedia?.('(max-width: 1100px)');
    const onResize = () => {
      if (!compact?.matches) setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        )
      )
        return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    compact?.addEventListener('change', onResize);
    window.addEventListener('keydown', onEscape);
    return () => {
      compact?.removeEventListener('change', onResize);
      window.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);
  return { menuOpen, menuButton, setMenuOpen };
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
