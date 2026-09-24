# Feature Specification: Releases and Publishing

**Feature Branch**: `006-release-publishing`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Release the wallpaper as it is now. Research the native stores for every
host (Steam Workshop for Wallpaper Engine, KDE Store, Lively, GitHub Pages for the browser), how to
publish there and whether GitHub Actions can publish automatically (GitHub Pages, the stores, and
packages attached to GitHub Releases). Write the store page texts with as little duplication of the
README as possible, and send suggestions and bug reports to GitHub. Decide where the release notes
come from and whether to introduce proper versioning so that releases happen only when the version
goes up. Decisions after the research: CI publishes only GitHub Pages and GitHub Releases; the Steam
Workshop and KDE Store are updated by hand for now (no Lively store exists). A release is started by a
version tag on the main branch, pushed from a local clone or created with the GitHub CLI — no git
hooks. Store page screenshots of the project's own renders are allowed by a constitution amendment."

## Overview

The wallpaper works on all four hosts. The browser version runs on GitHub Pages, KDE was accepted
on a real Plasma session, and Wallpaper Engine and Lively were verified and debugged on real Windows.
There is still no release. The version has stayed at `0.0.1`, no packages are published, GitHub
Pages is redeployed on every push to `testing`, and no user-facing page says where to report
problems.

This feature turns the project into something people can download and follow:

- a **versioned release** (SemVer, starting at `0.1.0`) started by pushing a version tag;
- a **GitHub Release** carrying every host package, checksums and hand-written release notes;
- **GitHub Pages** redeployed only on a release;
- **ready-to-paste texts** for the store pages, which the maintainer publishes on the Steam Workshop
  and the KDE Store by hand;
- **one feedback channel**, GitHub Issues, named on every page users see.

Automated store uploads are deliberately out of scope for now: research found no upload API for the
KDE Store and no confirmed steamcmd path for Wallpaper Engine items (see research.md).

## Clarifications

### Session 2026-09-24 (decisions taken before the spec was written)

- Q: Which stores are published by CI? → A: None. CI publishes GitHub Pages and GitHub Releases
  only; the Steam Workshop and the KDE Store are updated by hand, and Lively has no store (its
  package is the `.zip` on the GitHub Release).
- Q: What starts a release? → A: A version tag (`v` + the version in `package.json`) on a commit of
  the main branch `testing`, pushed from a local clone or created with the GitHub CLI. A post-commit
  hook that tags version bumps automatically was considered and rejected: git does not run it on
  merge or rebase, `--amend` leaves the tag behind, and tags are not pushed by default.
- Q: Where do release notes come from? → A: A hand-curated `CHANGELOG.md`, one section per version.
  Commit messages may seed a draft, but they use spec numbers as scopes (`feat(005): …`) and are not
  written for users. release-please, changesets and GitHub's generated notes were rejected.
- Q: May store pages show screenshots of the map? → A: Yes, through a constitution amendment:
  screenshots of the project's own output (the `docs/img/` kind) may be uploaded to store pages by
  the maintainer, and they still never go into packages or build output.
- Q: Are Wallpaper Engine and Lively ready for release? → A: Yes. Both were verified on real
  Windows; the extras planned for later (saves, map folders, lock screen, several monitors) are not
  part of this release.

### Session 2026-09-24

- Q: How does a Workshop update reach the already published item when `yarn package` regenerates
  `project.json` without `workshopid`? → A: The Workshop item id is stored in the repository after
  the first publish, and the package build writes it into `project.json` when it is set; before the
  first publish the package is built without it.
- Q: What do release notes and store texts link to while the Workshop and KDE Store pages do not
  exist yet, and where does the build get their addresses? → A: The addresses (the Workshop page
  from the item id, the KDE Store product URL) are kept in the repository next to the settings; a
  line whose address is not set is left out, and that host's entry points to its package on the
  release and the README install steps. The owner intends to create both store items and hand over
  the links before this feature is finished, so the first release is expected to carry them.
- Q: Which author and contact replace the placeholders in the package metadata? → A: Author
  `Alamion` (the GitHub account that owns the repository); contact is the repository's GitHub Issues
  URL; no e-mail address is published anywhere.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The maintainer cuts a release with one tag (Priority: P1)

The maintainer raises the version in `package.json`, writes the matching section of `CHANGELOG.md`,
commits both on `testing` and pushes a tag `vX.Y.Z` (or creates the release with the GitHub CLI).
Without further steps, CI checks the commit, builds every host package, creates or fills the GitHub
Release with the packages, checksums and the release notes from the changelog, and redeploys GitHub
Pages from the same build.

**Why this priority**: every other story depends on having a release to point at, and doing it by
hand for four hosts invites mistakes (wrong version in a manifest, a stale package).

**Independent Test**: on a fork or with a pre-release tag, push a tag and confirm the release page
lists all host packages with the tag's version in their names and manifests, the notes equal the
changelog section, and Pages serves the same version.

**Acceptance Scenarios**:

1. **Given** `package.json` says `0.1.0`, `CHANGELOG.md` has a `0.1.0` section and the commit is on
   `testing`, **When** the maintainer pushes tag `v0.1.0`, **Then** a GitHub Release `v0.1.0`
   appears with the web, Wallpaper Engine, Lively and KDE packages, a checksum file and the
   changelog section as its notes, and GitHub Pages serves version `0.1.0`.
2. **Given** a tag whose version differs from `package.json`, **When** it is pushed, **Then** the
   run fails before anything is published and says which versions disagree.
3. **Given** a tag on a commit that is not on `testing`, or a version not higher than the latest
   release, or no changelog section for the version, **When** it is pushed, **Then** the run fails
   before publishing and names the reason.
4. **Given** the maintainer created the release with the GitHub CLI (so the release already exists),
   **When** the run starts, **Then** it attaches the packages and the checksum file to that release
   instead of failing or creating a second one; hand-written notes already on the release are kept.
5. **Given** a pre-release tag such as `v0.2.0-beta.1`, **When** it is pushed, **Then** the
   GitHub Release is marked as a pre-release and GitHub Pages is not redeployed.
6. **Given** a push to `testing` without a tag, **When** CI runs, **Then** the checks run as today
   but nothing is published and GitHub Pages is unchanged.

---

### User Story 2 - A user downloads the wallpaper for their host (Priority: P1)

A user arrives from the README, a store page or a search. On the release page they find one clearly
named package per host, with short instructions on which one to take and how to install it. Lively
users drag the `.zip` into Lively; KDE users install the archive; Wallpaper Engine users follow the
Workshop link; everyone else opens the browser version.

**Why this priority**: the release is only useful if a user can pick the right file without reading
the whole README.

**Independent Test**: a person who has not seen the project uses only the release page and the
README to install the wallpaper on one host.

**Acceptance Scenarios**:

1. **Given** the release page, **When** a user reads it, **Then** each package is named after its
   host and version (`heroes3-living-map-<host>-<version>.<ext>`), and the notes end with a short
   "which file do I need" section linking the README install steps, the Workshop page, the KDE Store
   page and the browser version (a store link whose address is not yet set is left out, FR-014b).
2. **Given** the README, **When** a user reads "Getting started", **Then** it links to the latest
   release, and the status table shows all four hosts as working (Wallpaper Engine and Lively were
   verified on Windows).
3. **Given** a downloaded package, **When** the user checks it against the published checksums,
   **Then** they match.

---

### User Story 3 - The maintainer updates the store pages by hand from generated texts (Priority: P2)

For every release the maintainer opens the Wallpaper Engine editor and the KDE Store product page
and pastes texts that the build has already prepared: the store description (English, then
Russian) and the change note for this version, both in the store's markup. A short release checklist
in the repository lists every manual step, including the ones that are easy to forget (the KDE Store
detects updates by the product's version field, not by the package).

**Why this priority**: the stores are where most users will come from, but they change rarely; the
generated texts keep them consistent with the packages without automation that could break.

**Independent Test**: from a release build, take the generated texts and publish or preview them on
both stores; the checklist alone is enough to complete the update.

**Acceptance Scenarios**:

1. **Given** a release build, **When** the maintainer opens the release artefacts, **Then** they
   find a Steam Workshop description, a KDE Store description and a change note for this version,
   each ready to paste in that store's markup.
2. **Given** the Workshop description, **When** it is pasted, **Then** it fits the Workshop limits
   (title ≤ 128 characters, description ≤ 8000) and states: what the wallpaper is; that no game files
   are included and which files the user supplies from where; the Wallpaper Engine quirks (files
   copied into the wallpaper folder, `game\` paths, why the file pickers cannot be used); a link to the
   repository; that suggestions and bug reports are handled only in the repository's GitHub Issues.
3. **Given** the KDE Store description, **When** it is pasted, **Then** it states the same points for
   KDE, plus the requirement for Qt WebEngine with the package name for the main distributions, and
   uses only markup that store supports (no tables).
4. **Given** the release checklist, **When** the maintainer follows it, **Then** it covers tagging,
   checking the run, Workshop update, KDE Store update (file, version field, changelog), and where to
   find the texts; nothing else is needed.

---

### User Story 4 - Every page sends feedback to GitHub Issues (Priority: P2)

Whatever surface a user is on — a store page, the package's readme, the host's wallpaper info, the
browser panel, the release page — it names the repository and says that suggestions and bug reports
go to its GitHub Issues. Opening an issue offers a short form that asks for the host, the version,
the map and what was seen.

**Why this priority**: the maintainer wants one place to watch, not Workshop comments, store reviews
and several inboxes.

**Independent Test**: list every user-facing surface and confirm each one carries the repository
link and the issues note; open a new issue and see the form.

**Acceptance Scenarios**:

1. **Given** any host package, **When** its manifest and readme are read, **Then** they carry the
   repository link and the issues note (Lively `Contact`, the KDE metadata website/bug fields, the
   Wallpaper Engine description, the package readme).
2. **Given** the browser version, **When** the user opens the settings panel, **Then** it shows the
   version and a link to report a problem.
3. **Given** the repository, **When** a user opens a new issue, **Then** they can pick a bug report
   form (host, version, map, what happened, what was expected) or a suggestion form.

---

### User Story 5 - A KDE user without Qt WebEngine sees what to install (Priority: P3)

A KDE user installs the plugin from the KDE Store on a system without the Qt WebEngine QML module.
Instead of a black desktop, the wallpaper shows a short message naming the missing component and
the package to install on common distributions.

**Why this priority**: the store installs no dependencies, so this is the most likely first-run
failure on KDE; it is cheap to handle.

**Independent Test**: load the plugin where the Qt WebEngine import fails (a simulated missing
module) and see the message instead of an empty screen.

**Acceptance Scenarios**:

1. **Given** Qt WebEngine is missing, **When** the wallpaper starts, **Then** it shows a message
   naming the component and the packages for Fedora, Debian/Ubuntu and Arch, in the user's language
   (English or Russian).
2. **Given** Qt WebEngine is present, **When** the wallpaper starts, **Then** nothing changes from
   today.

---

### Edge Cases

- A tag is pushed twice or re-pushed after a failed run: the run fills the existing release and
  replaces its assets instead of failing or duplicating them.
- The release run fails after the GitHub Release is created but before Pages is deployed: a manual
  re-run for the same tag completes the missing steps without changing the published packages'
  contents (packages are reproducible).
- A tag is created on an old commit of `testing`: rejected unless its version is higher than every
  existing release.
- The changelog section exists but is empty: rejected.
- A store text grows past a store limit (for example after new strings): the build fails and says
  which text and by how much.
- A pre-release tag is pushed while a newer final release exists: allowed as a pre-release; Pages
  is untouched.
- The Workshop item does not exist yet (first release): the Wallpaper Engine package has no
  `workshopid`, the editor creates the item, and the maintainer commits the id for the next release.
- Lively's integer version field: derived from the SemVer version so that it always increases.
- The maintainer edits the release notes on GitHub after publishing: a re-run does not overwrite them.

## Requirements *(mandatory)*

### Functional Requirements

**Versioning and triggering**

- **FR-001**: The project MUST use Semantic Versioning, with `package.json` as the single source of
  the version; the first release is `0.1.0`.
- **FR-002**: A release MUST be started only by a tag `v<version>` (optionally with a SemVer
  pre-release suffix) on a commit reachable from `testing`, whether pushed from a local clone or
  created through the GitHub CLI or web interface. No git hook is part of the process.
- **FR-003**: Before publishing anything, the release run MUST verify: tag and `package.json`
  versions match; the commit is on `testing`; the version is higher than the latest non-pre-release
  release; `CHANGELOG.md` has a non-empty section for the version; the existing checks (type-check,
  tests, package checks, host simulations) pass on the same commit. Any failure MUST stop the run
  with a message naming the reason.
- **FR-004**: The version MUST appear in every package: file names, the KDE metadata, Lively's
  metadata (its integer version derived from SemVer so it increases with every release), the
  Wallpaper Engine package readme, and the browser version's panel.

**GitHub Release and Pages**

- **FR-005**: The release run MUST create the GitHub Release for the tag, or fill it if it already
  exists, with: the web, Wallpaper Engine, Lively and KDE packages; a checksum file covering all of
  them; the store texts of FR-011; and the version's changelog section as the notes, followed by a
  standard "which file do I need" block. Notes already present on an existing release MUST NOT be
  overwritten.
- **FR-006**: A tag with a pre-release suffix MUST produce a GitHub pre-release and MUST NOT deploy
  GitHub Pages.
- **FR-007**: GitHub Pages MUST be deployed only from a successful final-release run (and on manual
  dispatch for a given tag), from the same build as the release's web package. Pushes to `testing`
  MUST keep running the checks but MUST NOT deploy. This supersedes spec 004 FR-013a.
- **FR-008**: Re-running the release for the same tag MUST be safe: it replaces assets with
  byte-identical ones and completes any missing step.
- **FR-009**: No release asset or Pages deployment may contain game files or anything derived from
  them; the existing package checks for game content MUST run on the release build.

**Release notes**

- **FR-010**: `CHANGELOG.md` MUST hold one section per version, written for users. A helper MUST
  draft the next section from the commits since the previous release (features and fixes, spec
  scopes removed) for the maintainer to rewrite; the helper never publishes anything.

**Store texts (published by hand)**

- **FR-011**: The build MUST generate, from the same source as the host manifests and package
  readmes (English and Russian strings), ready-to-paste texts: a Steam Workshop title and
  description, a KDE Store description, and a change note for the version converted from its
  changelog section, each in the markup its store accepts. They are attached to the release (FR-005)
  and available from a local build.
- **FR-012**: Each store description MUST state: what the wallpaper is; that it is fan-made and not
  affiliated with the publishers; that no game files are included, which files the user supplies and
  where they come from; the host's own quirks (for Wallpaper Engine: files placed in the wallpaper
  folder by hand, `game\` paths, file pickers limited to images and videos; for KDE: the Qt WebEngine
  requirement with per-distribution package names); a link to the repository, the README and the
  releases; and that suggestions and bug reports are handled only in the repository's GitHub Issues.
  English comes first, then Russian, in one text.
- **FR-013**: A check MUST verify the generated store texts against the store limits (Workshop title
  ≤ 128 characters, description and change note ≤ 8000) and against the markup each store supports,
  and fail the build when a text does not fit.
- **FR-014**: A release checklist in the repository MUST describe every manual step: preparing the
  version and changelog, tagging (local and GitHub CLI variants), checking the run, updating the
  Workshop item through the Wallpaper Engine editor, updating the KDE Store product (replace the
  file, set the product version — KNewStuff offers updates only when it changes — add the changelog),
  and publishing store screenshots. After the first Workshop publish it MUST tell the maintainer
  to commit the item id the editor wrote (FR-014a); later updates unpack the new package over the
  editor's project folder and use "Publish update".
- **FR-014a**: The Wallpaper Engine Workshop item id MUST be kept in the repository next to the
  settings that generate the host manifests. When it is set, the package build MUST write it into the
  package's `project.json` as `workshopid`, so the editor updates the existing item instead of
  offering a new one; when it is not set (before the first publish), the package is built without
  it. A package check MUST confirm that a set id reaches `project.json` unchanged.
- **FR-014b**: The KDE Store product URL MUST be kept in the repository next to the Workshop item
  id; the Workshop page address is derived from that id. Every generated text that links a store
  page (release notes, store texts, package readmes) MUST leave the link out when its address
  is not set, and then point that host's users to its package on the release and the README install
  steps. A check MUST fail on an empty or placeholder store link.

**Feedback routing**

- **FR-015**: Every user-facing surface MUST name the repository and say that suggestions and bug
  reports go to its GitHub Issues: the store texts, every package readme, the Lively metadata contact,
  the KDE metadata (website and bug-report fields), the Wallpaper Engine description, the browser
  panel, the release notes and the README.
- **FR-016**: The repository MUST offer issue forms for bug reports (host, version, map, what
  happened, what was expected, optional screenshot) and suggestions.

**Release readiness**

- **FR-017**: The README MUST link to the latest release and show all four hosts as working; the
  package metadata MUST carry the product name "Heroes 3 Living Map" and the author `Alamion` and the
  repository's GitHub Issues URL as the contact (Lively `Author`/`Contact`, KDE `Authors`, bug-report
  field) instead of placeholders; no e-mail address appears in any package or store text.
- **FR-018**: The KDE plugin MUST show a readable message naming the missing Qt WebEngine component
  and the packages to install (Fedora, Debian/Ubuntu, Arch), in English or Russian, when that
  component is not available; a host simulation MUST cover this case.
- **FR-019**: The constitution MUST be amended (principle I) to allow the maintainer to upload
  screenshots of the project's own output — the `docs/img/` kind, under the same size limits — to
  store pages; they still MUST NOT be copied into packages, release assets or build output.

### Key Entities

- **Version**: the SemVer string in `package.json`; drives tag name, package names, manifests and
  the changelog section.
- **Release tag**: `v<version>` on a `testing` commit; the only release trigger.
- **Changelog section**: user-facing notes for one version in `CHANGELOG.md`; source of the GitHub
  Release notes and of the store change notes.
- **Release**: the GitHub Release for a tag, holding host packages, a checksum file, store texts and
  notes; a pre-release when the tag has a suffix.
- **Store text**: a generated, ready-to-paste description or change note for one store, in that
  store's markup, within its limits.
- **Workshop item id**: the Steam Workshop id of the published Wallpaper Engine item; stored in the
  repository once known and written into every later Wallpaper Engine package.
- **Store page address**: the public URL of the Workshop item or the KDE Store product; unset until
  the item exists, after which every generated link uses it.
- **Release checklist**: the document the maintainer follows for the manual steps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From pushing a valid tag to a complete GitHub Release and an updated browser version
  takes no manual step and under 20 minutes.
- **SC-002**: 100 % of invalid release attempts (version mismatch, commit off `testing`, version not
  higher, missing changelog section, failing checks) stop before anything is published.
- **SC-003**: Every release carries packages for all four hosts, and each package shows the release
  version in its name and metadata (4 of 4).
- **SC-004**: The maintainer completes both manual store updates for a release in under 15 minutes
  using only the checklist and the generated texts.
- **SC-005**: 100 % of user-facing surfaces listed in FR-015 carry the repository link and the
  GitHub Issues note.
- **SC-006**: Zero game files or derived content in any release asset or Pages deployment, confirmed
  by the package checks on every release run.
- **SC-007**: Re-running a release for the same tag yields byte-identical packages.
- **SC-008**: A KDE user without Qt WebEngine sees the explanatory message instead of an empty
  desktop in 100 % of simulated runs.

## Assumptions

- `testing` stays the main branch; releases are cut from it only.
- The Steam Workshop item is created once by hand in the Wallpaper Engine editor (it sets the age
  rating, genre and visibility and records the Workshop id); later updates also go through the
  editor. The Workshop page has a single description, so English and Russian share one text.
- The KDE Store product lives in the "Plasma 6 Wallpaper Plugins" category; the existing `.tar.gz`
  package is accepted by KNewStuff as is.
- Lively has no store: its `.zip` on the GitHub Release is the distribution channel.
- The existing reproducible package build is reused, so re-runs produce identical files.
- The repository is public and GitHub Pages is served from GitHub Actions, as today.
- Automated Workshop or KDE Store uploads may be revisited later (research.md records the options:
  steamcmd `workshop_build_item`, the unofficial Pling upload script); they are out of scope here.

## Out of Scope

- Automatic uploads to the Steam Workshop or the KDE Store.
- A Lively gallery submission (no such gallery exists).
- New wallpaper features (map folders, save files, lock screen, several monitors) — TODO item 5.
- Translating store texts into languages other than English and Russian.
