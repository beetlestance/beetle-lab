---
title: Datasets and templates
description: Feed rows of test data into request paths, query values, headers and bodies with datasets and templates.
sidebar:
  order: 6
---

A **dataset** is a table of values. A **template** is a string with placeholders
that the engine fills from the current dataset row, or from a secret, each time it
sends a request. Both live in the suite configuration; see
[Suite configuration](/reference/configuration/) for every field. To upload the
files a dataset reads, follow [Suites and inputs](/guides/suites-and-inputs/).

## Dataset kinds

Every dataset has an `id`, a `selection` and a `kind`. The kind decides where the
rows come from.

| `kind` | Extra fields | Rows come from |
| --- | --- | --- |
| `inline` | `rows` | An array of objects written in the configuration |
| `json` | `input` | A published input holding a JSON array of objects |
| `csv` | `input` | A published input holding CSV with a header row |
| `range` | `column`, `start`, `end`, `step` | Integers from `start` to `end`, one column |

```json
"datasets": [
  { "id": "users", "selection": "random", "kind": "inline",
    "rows": [{ "name": "ada", "plan": "pro" }, { "name": "lin", "plan": "free" }] },
  { "id": "ids", "selection": "byVu", "kind": "range",
    "column": "id", "start": 1, "end": 100, "step": 1 }
]
```

### Rows and columns

- Every row must have exactly the same columns. For `inline` and `json`, the
  columns are the first row's keys.
- Column names follow the identifier rule: a letter or `_` first, then letters,
  digits, `_` or `-`, up to 64 characters. `__proto__`, `prototype` and
  `constructor` are refused.
- Values are strings, numbers, `true`, `false` or `null`. Nested objects and
  arrays are refused. A string can be up to 4,096 characters.
- CSV values are always strings. The parser is strict: quoted fields, doubled
  quotes, line breaks inside quotes and a leading byte order mark are accepted;
  a stray quote or a row with the wrong number of cells is refused.
- A `range` holds `floor((end - start) / step) + 1` rows, which must be between 1
  and 10,000. `step` is at least 1, so `end` must not be below `start`.

### Referring to an input

A `json` or `csv` dataset names its file by the input's identity, which the
input's page shows:

```json
{ "id": "accounts", "selection": "random", "kind": "csv",
  "input": { "id": "UUID", "sha256": "64 lowercase hex characters", "bytes": 5120 } }
```

The engine checks the size and SHA-256 before it reads the file, so the revision
always uses exactly the bytes you uploaded.

## How a request picks a row

At the start of every iteration the engine picks **one row from every dataset**.
All requests and placeholders in that iteration use the same rows, so a user's
name and token from one row stay together.

| `selection` | Row chosen |
| --- | --- |
| `random` | A uniformly random row, picked again every iteration |
| `byVu` | Row `(VU number - 1) mod row count`; a VU keeps the same row for the whole run |

With `byVu`, VU 1 gets the first row, VU 2 the second, and VUs wrap round to the
start when there are more VUs than rows. VU numbers are counted across the whole
run, not per scenario. There is no sequential or unique-per-iteration mode.

## Templates

Any string that contains `{{` or `}}` is a template. A placeholder is one of:

| Placeholder | Value |
| --- | --- |
| `{{data.DATASET.COLUMN}}` | That column of the current row of dataset `DATASET` |
| `{{secret.NAME}}` | The value of the secret declared with that `name` in `secrets` |

Nothing else is allowed inside the braces: no spaces, filters, defaults or
expressions. Every dataset, column and secret you name must exist in the suite,
or the run fails validation.

### Where templates work

| Place | After filling in |
| --- | --- |
| `path` | Must still start with `/`, with no spaces, `?`, `#`, `\`, `.` or `..` segments |
| `query` values | Each character is percent-encoded |
| `headers` values | Must not contain control characters such as line breaks |
| JSON body strings | Inserted as a JSON string |
| Text body from an input | Inserted as is |
| Readiness `path` | Secrets only; dataset placeholders are refused |

Query and header **names** cannot be templates. Header names must be unique
ignoring case.

```json
{
  "id": "get-user", "name": "Get user", "method": "GET",
  "path": "/users/{{data.users.name}}",
  "query": { "plan": "{{data.users.plan}}" },
  "headers": { "Authorization": "Bearer {{secret.api_token}}" },
  "assertions": []
}
```

### Things to know

- Every filled-in value is text. In a JSON body, `"{{data.ids.id}}"` becomes the
  string `"42"`, not the number `42`.
- A JSON body is checked string by string. Object keys cannot contain braces.
- Inside a template, single `{` or `}` characters are refused. A text body that
  contains a placeholder therefore cannot also contain other braces. For a JSON
  payload in an input, set `"format": "json"` so each string is templated on its
  own.
- Content with no `{{` or `}}` is sent byte for byte and is not a template.
- Secret values never appear in the configuration, comparisons or exports. A
  revision that declares a secret cannot be exported as a standalone script.

## Limits

| Limit | Value |
| --- | --- |
| Datasets per suite | 64 |
| Rows per dataset | 10,000 |
| Columns per dataset | 64 |
| Cells across all datasets | 250,000 |
| Characters per cell | 4,096 |
| Template source | 4,096 characters |
| Placeholders and text pieces per template | 128 |
| Filled-in template | 65,536 characters |
| One input | 8 MiB |
| All content loaded by one run | 32 MiB; an input used twice counts twice |

The full list is on the [Limits](/reference/limits/) page.
