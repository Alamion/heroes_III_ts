# Tasks: View-scoped object graphics

**Input**: `specs/010-region-atlas/{spec,plan,research,data-model,quickstart}.md`
**Strategy**: first scenario accepted; complete lifecycle and non-interactive host rollout.

## Phase 1: Setup

- [x] T001 Record verified reuse map in `.claude/skills/map-rendering/SKILL.md` and design in `specs/010-region-atlas/plan.md`; proof: inspect paths against current code and `git diff --check`.

## Phase 2: Foundation

- [x] T002 Define/validate region identity and shared conservative selection in `src/runtime/decode.ts` using `src/core/state/object-index.ts`; proof: `yarn test test/runtime/object-regions.test.ts`.

## Phase 3: US1 — Real single-map regional scenario

Independent test: opt-in actual engine loads HotA, moves between distant views/levels,
rejects stale responses and matches the whole-map render at fixed seed/time.

- [x] T003 [US1] Add synthetic selection, deterministic packing and bounded regional cache tests in `test/runtime/object-regions.test.ts`; proof: `yarn test test/runtime/object-regions.test.ts` (red before implementation).
- [x] T004 [US1] Extend `src/runtime/decode.ts` for selective DEF decoding and one overwriteable regional cache slot; proof: `yarn test test/runtime/object-regions.test.ts`.
- [x] T005 [US1] Carry region in `src/runtime/protocol.ts`, `worker.ts` and no-worker dispatch in `engine.ts`; proof: `yarn build` and region tests.
- [x] T006 [US1] Add developer opt-in and requested/displayed camera synchronization in `src/runtime/engine.ts`; proof: `yarn test test/browser/object-regions.test.ts` with the actual Chromium runtime.
- [x] T007 [US1] Verify distant views, levels, rapid requests and pixel equivalence in `test/browser/object-regions.test.ts`; proof: run the real browser suite explicitly and inspect fresh normal/narrow screenshots in `check-reports/region-atlas/`.
- [x] T008 [US1] Update `.claude/skills/map-rendering/SKILL.md` and checkpoint in `specs/010-region-atlas/research.md`; proof: `yarn build`, `yarn test`, `yarn verify layers`, `git diff --check`, evidence review and maintainer acceptance.

**Maintainer review passed.** Owner clarified: optimize non-interactive wallpaper hosts
now; keep animation and the browser's current interactive strategy. Future wallpaper
interaction may select a different residency/prefetch policy.

## Phase 4: US2 — Host lifecycle after acceptance

Independent test: folder rotation and recovery still swap complete scenes and resources
stay bounded through twenty navigation cycles.

- [x] T009 [US2] Bind the future view before object preparation in `src/runtime/engine.ts` and `src/adapters/shared/controller.ts`; proof: real `test/browser/engine-prepare.test.ts` plus `yarn verify hosts`.
- [x] T010 [US2] Handle resize/scale/context recovery/archive changes and awaited tool rendering in `src/runtime/engine.ts` and affected `tools/` callers; proof: browser suites, `yarn verify corpus`, `yarn verify determinism`.
- [x] T011 [US2] Verify sprite extent/profile limits and twenty-cycle cache/memory bounds in `test/real/` and `tools/checks/budget/`; proof: real-file tests and `yarn verify budget` on base and HotA.

## Phase 5: Production rollout

- [x] T012 Select regional objects for WE/Lively/KDE (keep interactive web eager) in `src/adapters/shared/browser-controller.ts` and update `AGENTS.md`, `CHANGELOG.md`, `.claude/skills/map-rendering/SKILL.md`; proof: `yarn build`, `yarn test`, `yarn verify layers`, `yarn verify corpus`, `yarn verify determinism`, `yarn verify budget`, `yarn verify hosts`, `yarn verify packages`, fresh browser visual acceptance and `git diff --check`. There is no standalone lint script; strict build/layer checks are the current project equivalents.

## Dependencies and parallel opportunities

T001 → T002/T003 → T004 → T005 → T006/T007 → T008 → review → T009/T010 → T011 → T012.
Work directly with one writer for the shared decode/engine paths. Independent test
execution may run in parallel; no concurrent edits of the overlapping runtime files.

## Checkpoint

T001–T012 complete locally; final evidence in `specs/010-region-atlas/research.md`.
WE/Lively/KDE use regional graphics; interactive web remains eager.
Next: maintainer release decision; no remote writes or publication performed.
