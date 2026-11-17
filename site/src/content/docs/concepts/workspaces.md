---
title: Organisations and workspaces
description: How organisations, workspaces and folders hold your suites, inputs and runs, and how settings are inherited between them.
sidebar:
  order: 5
---

Everything you create in Beetle Lab sits in a fixed hierarchy:

```text
Installation
└── Organisation
    └── Workspace
        └── Folders (optional, nested)
            └── Suites and inputs
```

These levels are for organising work. They are not accounts or permissions.

## Finding your way in the app

The app's address follows the same hierarchy, and the screens follow it too:

- The sidebar links to **Organizations** (the list you start from),
  **Installation settings** and the **API reference**.
- An organisation's page shows its overview and its workspaces, with a link to
  **Organization settings**.
- A workspace's page shows its overview and folders, with links to **Workspace
  settings**, **Suites**, **Inputs** and **Runs**.
- **Search commands** at the top, or Ctrl+K (⌘K on a Mac), lists these pages
  and lets you jump by name to a workspace of the organisation you are in, or to
  a suite or run of the workspace you are in.

## Organisations

An **organisation** is the top level you create. It has a name and a **slug**:
lowercase letters and digits in groups joined by single hyphens, up to 128
characters. An organisation holds workspaces and can override some settings for
all of them.

## Workspaces

A **workspace** is where the work happens. Everything below belongs to exactly
one workspace:

| What | Notes |
| --- | --- |
| Suites | With all their revisions |
| Inputs | Datasets and request bodies; see [Suites and inputs](/guides/suites-and-inputs/) |
| Runs | With their results and files |
| Settings overrides | Run defaults and retention for this workspace |

A run keeps the workspace of the suite it ran. Moving a suite to another folder
never changes its existing runs. Runs can only be compared with other runs in the
same workspace.

## Folders

Each workspace has a **root folder**, created with it. Below it you can nest
folders to group suites and inputs, up to 8 levels deep.

- Folder names are 1 to 128 characters and unique among their siblings,
  ignoring case.
- Suite names are unique within their folder, ignoring case.
- Suites and folders can move between folders, but only within the same
  workspace.

A common layout is one folder per service, with a subfolder per kind of test:

```text
checkout-team            (workspace)
├── checkout-api
│   ├── smoke
│   └── capacity
└── catalog-api
    └── endurance
```

Folders only group. They never grant access or change how runs execute. Inputs
are shared across the whole workspace, so a suite in `checkout-api` can use a
dataset stored under `catalog-api`.

## Settings and inheritance

The installation holds a complete set of settings. The organisation and the
workspace store only the values you override; anything you leave unset is
inherited from the level above.

| Setting | Installation | Organisation | Workspace |
| --- | --- | --- | --- |
| Execution pool and output space | Set | No | No |
| Per-run ceilings | Set | No | No |
| Supported engine profiles | Set | No | No |
| Default engine profile | Set | Override | Override |
| Default run budget: CPU, memory, processes, time limit, output | Set | Override | Override |
| Retention policy | Set | Override | Override |

The most specific value wins: a workspace override beats the organisation's,
which beats the installation's. Each budget value is overridden on its own, so a
workspace can change the memory budget and still inherit the time limit.
Retention is one policy and is replaced as a whole.

Overrides cannot escape the installation's limits:

- Every budget value must lie between 1 and the installation's per-run ceiling.
- The engine profile must be one the installation supports.
- A value out of range is refused. Nothing is silently clamped.

The settings page shows each effective value together with the level it comes
from. Removing an override makes the level inherit again.

### When settings apply

A suite revision and a single run can also set their own budget, within the same
ceilings. The final values are fixed when the run is accepted. Changing settings
later never alters a run that is already queued or finished.

## Deleting

| What | Rule |
| --- | --- |
| Organisation | Refused while any workspace is active; retired if all its workspaces are retired |
| Folder | Only when it is empty; the root folder cannot be deleted |
| Workspace | Retired: hidden, with its data kept |

Deleting a workspace **retires** it. A retired workspace disappears from lists and
can no longer be opened, but its suites, runs and files stay on disk and still use
their space. You can create a new workspace with the same name; the retired one
never comes back. A workspace with an active run, export or unfinished upload
cannot be deleted until that work ends.

An organisation with no workspaces at all is removed. One whose workspaces are all
retired is **retired** the same way: it disappears from lists, its settings and
retired workspaces are kept, and its slug becomes free for a new organisation.

To free the space a workspace uses, delete its runs first. See
[Retention and deleting](/concepts/retention/).

## One administrator

An installation has one administrator. There are no user accounts, roles,
invitations or single sign-on, and organisations and workspaces do not restrict
who can see what. Anyone who can use the UI can use every organisation. See
[Trust and security](/concepts/security/).
