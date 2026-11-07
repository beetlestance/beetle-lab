export const suiteLimits = Object.freeze({ configBytes: 1_048_576, inputBytes: 8_388_608,
  loadedBytes: 33_554_432, rows: 10_000, columns: 64, cells: 250_000,
  cellChars: 4096, templateChars: 4096, templateTokens: 128, renderedChars: 65_536,
  jsonDepth: 32, jsonNodes: 65_536, jsonPathSegments: 32, readinessMs: 86_400_000 });
export const unsafeNames = new Set(['__proto__', 'prototype', 'constructor']);
export const identifier = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
