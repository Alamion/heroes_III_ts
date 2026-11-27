---
name: kde-wallpaper
description: Maintain and diagnose the Heroes 3 Living Map KDE Plasma wallpaper shell, lock-screen exclusion, WebEngine loading and package acceptance.
---

# KDE wallpaper

## When to Use

Use for KDE-specific startup, lifecycle, QML, missing-WebEngine and package problems.
For map decoding or rendering, follow the runtime/core owners instead.

## Steps

1. Read `AGENTS.md` and the constitution. Inspect the affected QML and callers.
2. Keep host behavior in `packaging/kde/contents/ui/main.qml`, `WebView.qml`,
   `WindowWatcher.qml` and `LockWatcher.qml`. The shared controller lives in
   `src/adapters/shared/controller.ts`; the bridge is `src/adapters/kde/`.
3. Generate packages through `tools/package/manifests/kde.ts`. Do not edit generated
   manifests, settings pages or `dist/`. Strings belong to `src/adapters/shared/strings.ts`.
4. Keep QtWebEngine and the `SharedProfile` singleton behind the `WebView.qml` Loader.
   `main.qml` must load without QtWebEngine installed.
5. Test package contracts with `test/tools/packages-check.test.ts` and
   `yarn verify packages --host kde`. Check actual Qt rendering in an isolated host.
   Never restart or replace the owner's desktop just to capture evidence.
6. Record checks and limitations in `specs/004-platform-adapters/research.md`.

## Lock-screen gate and reuse decision (2026-11-27)

Issue #1 reports no WebEngine process on Plasma 6.6.4. The existing lock-screen test
uses `Plasmoid.activity`, an applet-specific attached property that is not a reliable
wallpaper host discriminator. All three Loaders share `root.onLockScreen`.

Extend that existing gate, not the controller or renderer. KDE's Plasma 6.6 greeter
sets application name `kscreenlocker_greet`; the desktop shell sets `plasmashell`
(`kscreenlocker/greeter/main.cpp`, `plasma-workspace/shell/main.cpp` upstream).
The implemented fix identifies the greeter via `Qt.application.name`, preserving all
Loaders and the existing dark background. `test/tools/packages-check.test.ts` evaluates
the packaged predicate for desktop/greeter names with missing, null and present activity,
and guards the three shared Loader gates.

Verified with real packaged QML in a PySide6/Qt 6.11.2 host under Xvfb: before the fix,
desktop identity disables every Loader; afterwards the page reaches ready, loads
`test_map.h3m` and renders frames. Greeter identity keeps all Loaders disabled.
`check-reports/kde-webengine-map.png` is a personally inspected CDP capture of the actual
QtWebEngine page, not of a Chromium simulation.
The missing-module fallback was visually checked in the real Qt host at 960×540
(English) and 480×540 (Russian), using a copied package with an unavailable WebEngine
import: `check-reports/kde-missing-en.png`, `check-reports/kde-missing-ru.png`.
Both messages wrap within the view; no new theme-dependent controls are introduced.

Native desktop startup acceptance passed after the maintainer authorized
`yarn accept kde --apply`: upgraded the local package, restarted through
`plasma-plasmashell.service`, captured the visible map on the actual desktop and
restored prior wallpaper settings. Personally inspected evidence:
`check-reports/accept/2026-11-27T11-01-04-010Z/kde-desktop.png`.
The Xvfb native composition problem is a limitation of that test environment, not
a passing test: only the real-session capture establishes native display.
Reporter-specific CachyOS verification, interactive settings, lock/pause transitions
and second-screen checks were not performed in this session; do not claim otherwise.

Good: test desktop and greeter identities with the real packaged QML.
Bad: remove the lock-screen guard or treat missing activity as proof of a greeter.

## Verification pitfalls

Final regional-atlas package was also checked on the native desktop on 2026-11-27.
Map-only terrain/object crops under
`check-reports/accept/2026-11-27T12-27-08-801Z/` were personally inspected.
Show Desktop can be reset by shell startup/focus changes; invoke it near capture
after startup, preserve its original state and restore it in `finally`.
Never retain unrelated application contents as wallpaper evidence.

`yarn accept kde` installs into the user's profile and normally restarts plasmashell.
Use it only with explicit permission for that session change; prefer an isolated
Qt/Plasma session for development. Browser host simulations do not exercise QML.
