import { createContext, useContext, useState } from 'react';
import { badgeScope } from './navigation.js';
import type { ShellScope } from './navigation.js';

export const SettingsScopeContext = createContext<ShellScope>({});
export const useRememberedSettingsScope = () => useContext(SettingsScopeContext);

/** Keep settings destinations while the user browses parent levels in this session. */
export function useSettingsScope(pathname: string) {
  const [previous, setPrevious] = useState({ pathname: '', scope: {} as ShellScope });
  if (pathname === previous.pathname) return previous.scope;
  const active = badgeScope(pathname);
  const scope =
    !active.organizationId || (active.organizationId === previous.scope.organizationId && !active.workspaceId)
      ? previous.scope
      : active;
  setPrevious({ pathname, scope });
  return scope;
}
