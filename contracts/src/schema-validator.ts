import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { _ } from 'ajv/dist/compile/codegen/index.js';

/** Identical strict semantics for native validation and build-time browser compilation. */
// Standalone format expressions must use this registry’s AJV Code instance;
// workspace dependencies may otherwise resolve a second AJV installation.
export function schemaValidator(source = false): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: false, validateFormats: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false,
    ...(source ? { code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` }, inlineRefs: false } : {}) });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv); return ajv;
}
