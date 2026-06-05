# Project Structure

Workspace: Lantern
Generated: 2026-06-05T08:05:15.529Z

## Roots

- Workspace root: `C:\Users\larse\Desktop\pew`
- Nogra state root: `.nogra/`

## Local State Lanes

- `.nogra/state/` - current state, tasks, decisions and checkpoint.
- `.nogra/briefs/` - brief records.
- `.nogra/runs/` - run status records.
- `.nogra/evidence/` - evidence files and references.
- `.nogra/receipts/` - operation receipts.
- `.nogra/reports/` - final reports.
- `.nogra/checkpoints/` - dated checkpoint snapshots.
- `.nogra/memory/local/` - local continuity notes.
- `.nogra/memory/sync/` - sync metadata only when sync is enabled.
- `.nogra/transport/` - dispatch artifacts.

## Hub Shape

If this workspace manages several projects, use:

```text
projects/
  <workspaceId>/
    .nogra/
```

Hub `.nogra/` owns project discovery. Project `.nogra/` owns project state.
