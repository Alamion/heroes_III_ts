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

Job `release` (`contents: write`):
1. `actions/checkout@v4` at the tag, `fetch-depth: 0`; `git fetch origin testing`.
2. Node 22 + yarn cache, `yarn install --frozen-lockfile`.
3. `yarn release check --tag $TAG` — fails before anything is built.
4. `yarn build`, `yarn test`, `yarn package`.
5. `yarn verify packages --no-build --reproducible`, `yarn verify hosts --no-build` (all hosts),
   `yarn verify store-texts`.
6. `yarn release assets` → `dist/release/<version>/`.
7. `yarn release publish --tag $TAG --dir dist/release/<version>` with `GH_TOKEN: ${{ github.token }}`.
8. `actions/upload-pages-artifact@v3` of `dist/packages/web` (only when final).
Outputs: `version`, `prerelease`.

Job `pages` (needs `release`, `if: needs.release.outputs.prerelease == 'false'`;
`pages: write`, `id-token: write`; environment `github-pages`): `actions/deploy-pages@v4`.

Guarantees: nothing is published before step 7; a failed step 3–6 leaves no release, no asset and
no Pages change (SC-002); step 7 and the Pages job are safe to repeat (FR-008).

## Issue forms (`.github/ISSUE_TEMPLATE/`)

- `bug.yml`: host (dropdown: Browser, Wallpaper Engine, Lively, KDE Plasma), version (input,
  required), map (input: name, or "several"/"folder"), what happened (required), what was expected
  (required), screenshot (optional upload in the textarea), OS (optional).
- `suggestion.yml`: what and why (required), host (optional).
- `config.yml`: `blank_issues_enabled: false`.
