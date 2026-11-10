import { boundedUniqueJson } from './output-payloads/index.js';
const value = (field: string, row = 'NEW') => `json_extract(${row}.slot_json,'$.${field}')`;
const type = (field: string) => `json_type(NEW.slot_json,'$.${field}')`;
const uuid = (field: string) => `(length(${value(field)})=36 AND ${value(field)}=lower(${value(field)})
 AND substr(${value(field)},9,1)='-' AND substr(${value(field)},14,1)='-'
 AND substr(${value(field)},19,1)='-' AND substr(${value(field)},24,1)='-'
 AND length(replace(${value(field)},'-',''))=32 AND replace(${value(field)},'-','') NOT GLOB '*[^0-9a-f]*')`;
const same = (field: string) => `${value(field)} IS ${value(field, 'OLD')}`;
const old = (field: string) => value(field, 'OLD');
const size = `(SELECT json_extract(p.canonical_json,'$.result.artifacts['||NEW.ordinal||'].bytes')
 FROM execution_output_payloads p WHERE p.attempt_id=NEW.attempt_id AND p.kind='manifest')`;
const identity = `(${type('i')}='text' AND length(${value('i')})=64 AND ${value('i')} NOT GLOB '*[^0-9a-f]*')`;
const owned = `${old('w')} IS NOT NULL AND ${same('w')}`;
const claim = `(${old('p')}='transferring' AND ${same('p')} AND ${old('w')} IS NULL
 AND ${value('w')} IS NOT NULL AND ${same('i')} AND ${same('o')})`;
const progress = `(${old('p')}='transferring' AND ${same('p')} AND ${owned}
 AND ${identity} AND (${old('i')} IS NULL OR ${same('i')})
 AND (${value('i')} IS NOT ${old('i')} OR ${value('o')} IS NOT ${old('o')}))`;
const begin = `(${old('p')}='transferring' AND ${value('p')}='publishing'
 AND ${owned} AND ${same('i')} AND ${same('o')})`;
const publish = `(${old('p')}='publishing' AND ${value('p')}='published'
 AND ${old('w')} IS NOT NULL AND ${value('w')} IS NULL AND ${same('o')})`;
/** Only replaces the deliberately frozen slot update guard from migration009. */
export const migration010 = `
DROP TRIGGER output_slot_immutable;
CREATE TRIGGER output_slot_update BEFORE UPDATE ON execution_output_slots BEGIN
 SELECT CASE WHEN ${boundedUniqueJson('outputSlot')} IS NOT 1 THEN RAISE(ABORT,'invalid output slot') END;
 SELECT CASE WHEN json_type(NEW.slot_json) IS NOT 'object'
 OR (SELECT count(*) FROM json_each(NEW.slot_json))!=6
 OR EXISTS(SELECT 1 FROM json_each(NEW.slot_json) WHERE key NOT IN ('v','t','o','p','i','w'))
 OR ${type('v')} IS NOT 'integer' OR ${value('v')} NOT BETWEEN 1 AND 9007199254740991
 OR ${type('o')} IS NOT 'integer' OR ${value('o')} NOT BETWEEN 0 AND 9007199254740991
 OR ${type('t')} IS NOT 'text' OR NOT ${uuid('t')}
 OR ${type('p')} IS NOT 'text' OR ${value('p')} NOT IN ('transferring','publishing','published')
 OR NOT (${type('i')}='null' OR ${identity})
 OR NOT (${type('w')}='null' OR (${type('w')}='text' AND ${uuid('w')}))
 THEN RAISE(ABORT,'closed output slot') END;
 SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.ordinal IS NOT OLD.ordinal OR NOT ${same('t')}
 OR ${old('v')}>=9007199254740991 OR ${value('v')} IS NOT ${old('v')}+1
 OR ${value('o')}<${old('o')} OR ${value('o')}>${size}
 OR (${value('i')} IS NULL AND ${value('o')}!=0)
 OR (${value('p')}!='transferring' AND (${value('i')} IS NULL OR ${value('o')} IS NOT ${size}))
 OR NOT (${claim} OR ${progress} OR ${begin} OR ${publish})
 THEN RAISE(ABORT,'illegal output slot transition') END;
END;
PRAGMA user_version=10;
`;
