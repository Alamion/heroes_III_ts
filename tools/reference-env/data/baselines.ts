// The two reference baselines (constitution II, spec 005 FR-021).
//
// `complete` is the original Complete edition and stays the only baseline for base-game content.
// `hota` is a separate Horn of the Abyss installation, used only for content that exists nowhere
// else. Each baseline has its own game root, its own calibration and its own capture namespace, so
// a capture can never be mistaken for one of the other build.
//
// Everything here is file names and geometry, no game data.

import { ERROR_CODES, RefError } from '../errors.ts'
import type { Baseline, CaptureRecord, ExecutableLabel, ReferenceConfig } from '../model/types.ts'
import {
  EDITOR_EXE,
  GAME_EXE,
  HOTA_EDITOR_EXE,
  HOTA_GAME_EXE,
  HOTA_STAGING_WHITELIST,
  STAGING_WHITELIST,
  hashedArchives,
  type WhitelistEntry,
} from './staging-whitelist.ts'

export type { Baseline }

export const BASELINES: readonly Baseline[] = ['complete', 'hota']

export interface BaselineProfile {
  id: Baseline
  /** Shown in messages and written into every record. */
  label: string
  gameExe: string
  editorExe: string
  gameLabel: ExecutableLabel
  editorLabel: ExecutableLabel
  whitelist: readonly WhitelistEntry[]
  /** Archives whose hashes go into every record of this baseline. */
  hashedArchives: readonly string[]
  /** Names that must never be staged for this baseline (defence in depth for FR-004). */
  neverStage: readonly RegExp[]
  /** Modules that must never be loaded into the running game. */
  forbiddenModules: readonly RegExp[]
  /** Folder under stateDir holding the staged game root. */
  stagingDirName: string
  /** File under stateDir holding this baseline's calibration. */
  calibrationFile: string
  /**
   * Folder under capturesDir holding this baseline's captures. Empty for `complete`, so the
   * captures recorded before this dimension existed keep their place and stay comparable.
   */
  captureNamespace: string
  /** True when the baseline may only be used after the constitution amendment (FR-021). */
  needsAmendment: boolean
  /**
   * True when the menu screens animate their background, so "the screen stopped changing" is not
   * a usable signal and navigation waits for the probe region alone (measured: HotA 1.8.1 animates
   * the main menu and the scenario screen; the Complete edition draws them still).
   */
  animatedMenuBackground: boolean
  /**
   * Size in tiles of the view rectangle this build draws on the minimap. It is not the same as the
   * view itself: HotA draws it one row taller than the 17 rows its 544-pixel viewport shows
   * (measured 2026-09-23 — the pixel mapping is identical to the Complete edition's, only the
   * rectangle differs), and the origin is read back from that rectangle.
   */
  viewRectTiles: { w: number; h: number }
}

const HD_MOD = [/^_hd3_/i, /^hd_/i, /^hw_/i, /^heroes3_hd/i] as const
const HD_MOD_MODULES = [/^_hd3_\.dll$/, /^hd_.*\.dll$/, /^hw_sod\.dll$/, /^hw_hota\.dll$/] as const
const HOTA_MODULES = [/^hota\.dll$/, /^hota_me\.dll$/, /^hota_.*\.dll$/] as const

const COMPLETE: BaselineProfile = {
  id: 'complete',
  label: 'Heroes III Complete (original)',
  gameExe: GAME_EXE,
  editorExe: EDITOR_EXE,
  gameLabel: 'Heroes3.exe (original)',
  editorLabel: 'h3maped.exe (original)',
  whitelist: STAGING_WHITELIST,
  hashedArchives: hashedArchives(STAGING_WHITELIST),
  neverStage: [...HD_MOD, /^hota/i, /^h3hota/i, /^patcher_x86/i],
  // patcher_x86.dll belongs to the HD Mod side here; HotA ships its own copy (see HOTA below).
  forbiddenModules: [...HOTA_MODULES, ...HD_MOD_MODULES, /^patcher_x86\.dll$/],
  stagingDirName: 'game-root',
  calibrationFile: 'calibration.json',
  captureNamespace: '',
  needsAmendment: false,
  animatedMenuBackground: false,
  viewRectTiles: { w: 19, h: 17 },
}

const HOTA: BaselineProfile = {
  id: 'hota',
  label: 'Horn of the Abyss 1.8 (h3hota.exe)',
  gameExe: HOTA_GAME_EXE,
  editorExe: HOTA_EDITOR_EXE,
  gameLabel: 'h3hota.exe (HotA)',
  editorLabel: 'h3hota_maped.exe (HotA)',
  whitelist: HOTA_STAGING_WHITELIST,
  hashedArchives: hashedArchives(HOTA_STAGING_WHITELIST),
  // HotA ships patcher_x86.dll itself and does not run without it (measured), so only the HD Mod
  // files are kept out — including `h3hota HD.exe`, the HD build of the same game.
  neverStage: [...HD_MOD, /^h3hota hd\.exe$/i],
  forbiddenModules: HD_MOD_MODULES,
  stagingDirName: 'game-root-hota',
  calibrationFile: 'calibration-hota.json',
  captureNamespace: 'hota',
  needsAmendment: true,
  animatedMenuBackground: true,
  viewRectTiles: { w: 19, h: 18 },
}

const PROFILES: Record<Baseline, BaselineProfile> = { complete: COMPLETE, hota: HOTA }

export function isBaseline(value: string): value is Baseline {
  return value === 'complete' || value === 'hota'
}

export function parseBaseline(value: string | undefined): Baseline {
  if (value === undefined) return 'complete'
  if (!isBaseline(value)) {
    throw new RefError(ERROR_CODES.USAGE, `--baseline must be one of ${BASELINES.join(', ')} (got "${value}")`)
  }
  return value
}

export function baselineProfile(id: Baseline): BaselineProfile {
  return PROFILES[id]
}

/** The install a baseline is built from, with a typed error when it is not configured. */
export function baselineBundleDir(cfg: ReferenceConfig, id: Baseline): string {
  if (id === 'complete') return cfg.bundleDir
  if (cfg.hotaBundleDir === undefined) {
    throw new RefError(
      ERROR_CODES.PREREQ_MISSING,
      'the hota baseline needs a HotA installation: set hotaBundleDir in reference-env.config.json or H3REF_HOTA_BUNDLE_DIR',
    )
  }
  return cfg.hotaBundleDir
}

/** A record's baseline; records written before the dimension existed are Complete-edition ones. */
export function recordBaseline(record: Pick<CaptureRecord, 'baseline'>): Baseline {
  return record.baseline ?? 'complete'
}

/** The baseline a map belongs to: only the HotA build can open a HotA-format map. */
export function baselineForMapVersion(version: string): Baseline {
  return version === 'HotA' ? 'hota' : 'complete'
}
