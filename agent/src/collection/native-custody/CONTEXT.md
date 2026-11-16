# Shared output-native custody
index.ts owns aggregate4 strong native lifetimes; collection/range/cleanup each<=2.
Reserve before input traps, own lifetime before capture, bind captured directory
before IO. Read/read overlap allowed; cleanup rejects overlapping or unbound owners.
Lexical directory scope is exclusion only, never native identity/deletion authority.
Original lifetime releases only after actual successful closes; failure keeps scope
and credit. C2 still drains control/producers and durable gate before cleanup.
No cleanup filesystem operation is introduced here. Tests native-custody plus existing
output-collection/output-range suites cover original IO and sticky close ownership.
