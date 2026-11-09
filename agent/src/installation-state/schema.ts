const uuid = (field: string) => `(typeof(${field})='text' AND length(${field})=36 AND
 substr(${field},9,1)='-' AND substr(${field},14,1)='-' AND substr(${field},19,1)='-' AND substr(${field},24,1)='-' AND
 length(replace(${field},'-',''))=32 AND replace(${field},'-','') NOT GLOB '*[^0-9a-f]*')`;
export const schema = `
 CREATE TABLE installation_state (
 id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL CHECK(phase IN ('initializing','ready','restoring')),
 operation_id TEXT CHECK(operation_id IS NULL OR ${uuid('operation_id')}),
 authority TEXT CHECK(authority IS NULL OR ${uuid('authority')}),
 pending TEXT CHECK(pending IS NULL OR ${uuid('pending')}),
 CHECK((phase='initializing' AND operation_id IS NOT NULL AND authority IS NULL AND pending IS NULL) OR
 (phase='ready' AND operation_id IS NULL AND authority IS NOT NULL AND pending IS NULL) OR
 (phase='restoring' AND operation_id IS NOT NULL AND authority IS NOT NULL AND pending IS NOT NULL AND pending<>authority)));
 CREATE TRIGGER state_no_delete BEFORE DELETE ON installation_state BEGIN SELECT RAISE(ABORT,'state_required'); END;
 CREATE TRIGGER state_no_replace BEFORE INSERT ON installation_state WHEN EXISTS(SELECT 1 FROM installation_state)
 BEGIN SELECT RAISE(ABORT,'state_required'); END;
 PRAGMA user_version=1;`;
