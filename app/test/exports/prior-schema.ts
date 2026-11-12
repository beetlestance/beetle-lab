import {DatabaseSync} from 'node:sqlite';
import {migration001,transaction} from '../../src/adapters/outbound/sqlite/schema.js';
import {migration002} from '../../src/adapters/outbound/sqlite/migration002.js';
import {migrate003} from '../../src/adapters/outbound/sqlite/migration003.js';
import {migration004} from '../../src/adapters/outbound/sqlite/migration004.js';
import {migration005} from '../../src/adapters/outbound/sqlite/migration005.js';
import {migration006} from '../../src/adapters/outbound/sqlite/migration006.js';
import {migration007} from '../../src/adapters/outbound/sqlite/migration007.js';
import {migrate008} from '../../src/adapters/outbound/sqlite/migration008.js';
import {migration009} from '../../src/adapters/outbound/sqlite/migration009.js';
import {migration010} from '../../src/adapters/outbound/sqlite/migration010.js';
import {migration011} from '../../src/adapters/outbound/sqlite/migration011.js';
import {migration012} from '../../src/adapters/outbound/sqlite/migration012.js';
import {migration013} from '../../src/adapters/outbound/sqlite/migration013.js';
import {migration014} from '../../src/adapters/outbound/sqlite/migration014.js';
import {registerAbsenceValidation} from '../../src/adapters/outbound/sqlite/output-absence/values.js';
/** Genuine prior schema, not a PRAGMA relabel of a newer database. */
export function prior14(path:string):DatabaseSync{
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');registerAbsenceValidation(db);
 const steps=[()=>db.exec(migration001),()=>db.exec(migration002),()=>migrate003(db),()=>db.exec(migration004),()=>db.exec(migration005),
  ()=>db.exec(migration006),()=>db.exec(migration007),()=>migrate008(db),()=>db.exec(migration009),()=>db.exec(migration010),
  ()=>db.exec(migration011),()=>db.exec(migration012),()=>db.exec(migration013),()=>db.exec(migration014)];
 for(const step of steps)transaction(db,step);return db;
}
