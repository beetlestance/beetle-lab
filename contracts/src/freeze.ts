/** Freeze validated JSON trees before compilation or public exposure. */
export function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child);
  return Object.freeze(value);
}

export { freezeJson as freezeSchema };
