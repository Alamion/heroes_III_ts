---
name: release-publishing
description: Maintain Heroes 3 release artifacts, generated store texts and visual checks of KDE Store or Steam Workshop pages.
---

# Releases and store pages

## When to Use

Use for release packaging, description/changelog markup, store screenshots and publishing.
Read `docs/releasing.md`, the constitution and the affected tooling before editing.

## Steps

1. Reuse `tools/release/store-texts.ts` (templates, placeholders and image URLs) and
   `tools/release/markup.ts` (one Markdown-subset renderer with store profiles).
   Wording belongs to `src/adapters/shared/strings.ts`; layout/copy lives in `docs/store/`.
   Do not hand-maintain generated BBCode copies.
2. Keep project/store identities in `src/adapters/shared/project.ts` and version only
   in `package.json`. No tag, GitHub write or publication without session authorization.
3. Keep documentation images in `docs/img/` within the constitution limits, never in
   packages or release assets. Capture only this project's output, not the owner's
   desktop/apps or the original game. Store gallery uploads remain a maintainer step.
4. Run `yarn test test/tools/release-markup.test.ts test/tools/release-texts.test.ts`,
   `yarn verify store-texts` and relevant package checks. Visually inspect live pages
   and fresh candidate screenshots; generated-text assertions do not establish live layout.
5. Record live-page findings and remaining owner/authentication steps in
   `specs/006-release-publishing/research.md`.

## Verified reuse decision and pitfalls (2026-11-27)

- Branch migration reuses `tools/release/tags.ts` as the release-policy owner,
  `test/tools/release-tags.test.ts` for ancestry/default-ref coverage, and the existing
  `.github/workflows/{ci,release}.yml`. Release defaults are `main` locally and
  `origin/main` in CI (`NOT_ON_MAIN` on failure); CI runs on main and testing.
  main is default/stable; testing remains integration. Promote by PR, merge release
  changes back into testing, remove merged short-lived branches after ancestry checks.
  No parallel release script or force-push is needed.
  `docs/releasing.md` owns current branch procedures; historical specs remain history.
  Migration verified with strict build and 571 passing tests (11 skipped), including
  default origin/main ancestry and testing-only tag refusal. GitHub default and
  local origin/HEAD are main. Pages environment permits v* tags unchanged.
- Store text generation already supports separate `steam`/`kde` inline profiles.
  KDE renders `[code]` as block content, breaking package names out of a sentence.
  The KDE inline renderer now uses supported bold text; Steam keeps code.
  Test `test/tools/release-markup.test.ts` rather than postprocessing generated text.
- The live KDE description does not shrink a 1280px first image; it is clipped inside
  the description. Steam already limits description images to about 630px. Prefer a
  fresh bounded-size documentation screenshot rather than unsupported BBCode/CSS.
  `docs/img/web-version.jpg` is now a personally inspected 704×480 current browser
  capture. The live listing still points to the old v0.1.0 image until publication.
- Both live descriptions still link images at v0.1.0. Regenerated descriptions use the
  chosen release tag; do not paste an unpublished tag's URLs.
- Pling image CDN failures affected this product and unrelated products in the same
  browser session. Do not assume that re-uploading our image fixes a CDN failure.
- Store update automation is not implemented; see
  `reports/Автопубликация обоев из GitHub.md`. Do not adopt undocumented upload scripts,
  put personal sessions on public CI runners or bypass authentication/challenges.

Good: update the profile renderer, generate both texts, inspect candidate/live output.
Bad: replace the listing's files or publish a release just to test description formatting.
