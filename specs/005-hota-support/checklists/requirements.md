# Specification Quality Checklist: HotA Support

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- A clarification session on 2026-09-22 resolved five further decisions, recorded in the spec's
  `## Clarifications` section: the coverage-class rule for the acceptance map set (FR-020, SC-001),
  the required HotA map sub-versions (FR-006, FR-006a), the archives the user supplies and their
  precedence (FR-004, FR-004a), the behaviour for an unresolved object class (FR-017), and the
  budget policy for the HotA case (FR-024, FR-027, SC-006). "Every map opens" was narrowed by the
  owner to "every distinct variant and edge case opens", not literally every file.
- Two open decisions were resolved with the owner on 2026-09-22 before the spec was finalised:
  - HotA fidelity reference: capture from the HotA game build with a constitution amendment
    (FR-021, FR-022, FR-024), rather than editor-only or data-level verification.
  - Object coverage bar: full coverage of the object classes present in the check maps and the
    user's map folder, plus an honest, diagnosable fallback for anything else (FR-016, FR-017).
- Domain facts named in the spec (map format numbers, archive and map file names, map counts per
  generation) are measured properties of the user's own files, not implementation choices; they
  were verified on 2026-09-22 against `public/dev-assets/` and the local HotA 1.8.1 install.
- One correction to the roadmap note in `TODO.md`: `test_map_hota.h3m` is map format `0x20`
  **sub-version 10**, not 9; sub-version 9 appears in `[HotA] The Devil Is in the Detail.h3m`,
  `По праву силы.h3m` and 2 maps of the HotA maps folder, while 70 of that folder's HotA maps are
  sub-version 10. Both sub-versions are therefore required (FR-006).
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
