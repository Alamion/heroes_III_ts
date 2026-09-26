# Contract: GitHub workflows

## `.github/workflows/ci.yml` (replaces `pages.yml`)

- On: `push` to `testing`, `pull_request` to `testing`, `workflow_dispatch`.
- Permissions: `contents: read`. No deploy, no upload.
- Steps: install (`--frozen-lockfile`), `yarn build`, `yarn test`, `yarn package`,
  `yarn verify packages --no-build`, `yarn verify hosts --host web --no-build`,
  `yarn verify store-texts`, `yarn verify layers`.

## `.github/workflows/release.yml`

- On: `push: tags: ['v*']`; `workflow_dispatch` with input `tag` (required).
- Concurrency: group `release-<tag>`, no cancel (a second run waits, then replaces assets).

Jobs (split for speed, research "Check speed"):

1. `check`: checkout at the tag with `fetch-depth: 0`, `git fetch origin testing`, install,
   `yarn release check --tag $TAG`. Outputs `version`, `prerelease`. Nothing else starts if it fails.
2. `hosts` (needs `check`; matrix `host: [web, wallpaper-engine, lively, kde]`, `fail-fast`):
   `yarn package --host <host>`, `yarn verify hosts --host <host> --no-build`.
3. `build` (needs `check`, parallel to `hosts`): `yarn build`, `yarn test`, `yarn package`,
   `yarn verify packages --no-build --reproducible`, `yarn verify store-texts`, `yarn release assets`;
   uploads `dist/release/<version>/` as the artifact `release-assets` and, for a final version,
   `dist/packages/web` as the Pages artifact.
4. `release` (needs `check`, `hosts`, `build`; `contents: write`): downloads `release-assets`,
   `yarn release publish --tag $TAG --dir dist/release/<version>` with `GH_TOKEN: ${{ github.token }}`.
5. `pages` (needs `check`, `release`; only when not a pre-release; `pages: write`, `id-token: write`;
   environment `github-pages`): `actions/deploy-pages@v4`.

Guarantees: nothing is published before every job of 1–3 has passed; a failure there leaves no
release, no asset and no Pages change (SC-002); `release` and `pages` are safe to repeat (FR-008).

## Issue forms (`.github/ISSUE_TEMPLATE/`)

- `bug.yml`: host (dropdown: Browser, Wallpaper Engine, Lively, KDE Plasma), version (input,
  required), map (input: name, or "several"/"folder"), what happened (required), what was expected
  (required), screenshot (optional upload in the textarea), OS (optional).
- `suggestion.yml`: what and why (required), host (optional).
- `config.yml`: `blank_issues_enabled: false`.
