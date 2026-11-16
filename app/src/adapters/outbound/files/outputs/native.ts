import type { NativePort } from '../custody/index.js';

/** Time/cancellation guards retain every issued original; cleanup always bypasses stop hints. */
export function guardedPort(port: NativePort, check: () => void): NativePort {
  async function issue<T>(operation: () => Promise<T>): Promise<T> {
    check(); const value = await operation(); check(); return value;
  }
  return {
    open: (...args) => { check(); return port.open(...args); },
    lstat: (...args) => issue(() => port.lstat(...args)),
    realpath: (...args) => issue(() => port.realpath(...args)),
    mkdir: (...args) => issue(() => port.mkdir(...args)),
    link: (...args) => issue(() => port.link(...args)),
    unlink: (...args) => issue(() => port.unlink(...args)),
    statfs: (...args) => issue(() => port.statfs(...args)),
    close: handle => port.close(handle),
    sync: (...args) => issue(() => port.sync(...args)),
    truncate: (...args) => issue(() => port.truncate(...args)),
    read: (...args) => issue(() => port.read(...args)),
    write: (...args) => issue(() => port.write(...args)),
  };
}
