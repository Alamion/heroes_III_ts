# CLI Contract: `yarn ref`

Entry point `tools/reference-env/cli.ts`, run as `yarn ref <command> [options]`.

Common rules (FR-020):

- Non-interactive; never prompts.
- **stdout**: exactly one JSON document (the command result). **stderr**: human-readable log,
  level from `--log-level error|warn|info|debug` (default `info`).
- Exit codes: `0` success, `1` operation failed (typed `error.code` in JSON), `2` usage error,
  `3` prerequisites missing (doctor would fail).
- Failure JSON: `{ "ok": false, "error": { "code", "message", "step"?, "details"? } }`.
- Every command that launches Wine takes the single-capture lock.

| Command | Purpose | Key options | Success JSON |
|---|---|---|---|
| `doctor` | check all prerequisites (Story 4) | `--json-only` | `DoctorReport` |
| `setup` | create prefix, staging roots, import settings, record expected hashes | `--force` | `{ ok, prefix, stagingRoots, hashes }` |
| `calibrate` | run spikes S2–S6 measurements, write local calibration | `--only game\|editor`, `--map <file>` | `{ ok, calibrationPath, positioningMethod }` |
| `still` | game still capture (Story 1) | `--map <file> --level 0\|1 --x N --y N [--start fixed\|random]` | `{ ok, capture: CaptureMatch }` |
| `clip` | game animation clip (Story 2) | same + `--duration <ms>` | `{ ok, capture: CaptureMatch }` |
| `editor` | editor still capture (Story 3) | same as `still` + `--overlay <name>` (repeatable) | `{ ok, capture: CaptureMatch }` |
| `find` | lookup (Story 5) | `--map <name\|key> --level --region x0,y0,x1,y1 [--source] [--kind] [--limit]` | `{ ok, matches: CaptureMatch[] }` |
| `list` | list captures | `[--map] [--source] [--kind] [--before <iso>]` | `{ ok, captures: [{ id, dir, createdAt, sizeBytes }] }` |
| `prune` | delete captures | `--id <id>` (repeatable) or `--before <iso>`; `--dry-run` | `{ ok, removed: string[] }` |
| `selfcheck` | reproducibility + position cross-check (FR-021, SC-002, SC-003) | `--map <file> --runs N --samples N [--floating-tiles "x,y;x,y"] [--seed N]` | `{ ok, reproducibility, positionAgreement }` |

`find` never launches the game and does not take the lock. `prune` refuses paths outside
`capturesDir`.

`package.json` script: `"ref": "node tools/reference-env/cli.ts"`.
