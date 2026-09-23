// Types mirroring specs/001-reference-environment/data-model.md and
// contracts/capture-record.schema.json.

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface TileRange {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type Level = 0 | 1
export type Source = 'game' | 'editor'
export type Kind = 'still' | 'clip'
export type StartMode = 'fixed' | 'random'
export type FormatVersion = 'RoE' | 'AB' | 'SoD' | 'HotA'
/** Which game build a capture is compared against (constitution II; data/baselines.ts). */
export type Baseline = 'complete' | 'hota'
export type Edge = 'left' | 'top' | 'right' | 'bottom'
export type ExecutableLabel =
  | 'Heroes3.exe (original)'
  | 'Heroes3_HD.exe (HD Mod vanilla profile)'
  | 'h3maped.exe (original)'
  | 'h3hota.exe (HotA)'
  | 'h3hota_maped.exe (HotA)'

export interface Timeouts {
  still: number
  clipBase: number
  editor: number
  step: number
  lockWait: number
}

export interface ReferenceConfig {
  repoRoot: string
  bundleDir: string
  /** HotA install (spec 005). Optional: only the HotA baseline and HotA file lookups need it. */
  hotaBundleDir: string | undefined
  wineBinary: string
  stateDir: string
  capturesDir: string
  mapSearchDirs: string[]
  timeouts: Timeouts
}

export interface CaptureRequest {
  source: Source
  kind: Kind
  map: string
  level: Level
  target: Point
  durationMs?: number
  overlays?: string[]
  start?: StartMode
}

export interface MapInfo {
  name: string
  key: string
  sha256: string
  sizeTiles: number
  hasUnderground: boolean
  formatVersion: FormatVersion
}

export interface VisibleRange extends TileRange {
  partialEdges: Edge[]
}

export interface TileMapping {
  tileSize: 32
  originTile: Point
  originPixel: Point
  viewport: Rect
}

export interface FileHash {
  file: string
  sha256: string
}

export type StartSetup =
  | { mode: 'fixed'; choices: { town: string; hero: string; bonus: string } }
  | { mode: 'random' }

export type Visibility =
  | { method: 'cheat'; code: string; verified: true }
  | { method: 'editor'; overlays?: string[] }

export interface ClipInfo {
  grabFps: number
  durationMs: number
  distinctFrames: number
  shortestStepMs: number
  resolvesAllSteps: boolean
}

/** Self-checks of a game capture (spec 003 research §10, §11); absent in records of older tooling. */
export interface CaptureVerification {
  minimapRect: Rect & { drawnEdges: { left: boolean; top: boolean; right: boolean; bottom: boolean } }
  level: { method: 'minimap-terrain'; agreement: number[]; margin: number }
  /** Stills: first grab; clips: first frame. */
  mapping?: { method: 'terrain-render'; compared: number; differingRecorded: number; bestShift: { dx: number; dy: number }; bestDiffering: number }
}

export interface CaptureRecord {
  schemaVersion: 1
  id: string
  createdAt: string
  /**
   * Which game build this capture came from (spec 005 FR-021). Absent in records written before
   * the baseline dimension existed; those are Complete-edition captures (see `recordBaseline`).
   */
  baseline?: Baseline
  source: Source
  kind: Kind
  map: MapInfo
  level: Level
  requested: Point
  clamped?: boolean
  visible: VisibleRange
  mapping: TileMapping
  positionSource: 'minimap-rect' | 'editor-view'
  startSetup?: StartSetup
  visibility: Visibility
  cursor: { drawnByX: false; parkedAt: Point | null }
  executable: { file: string; sha256: string; label: ExecutableLabel }
  archives: FileHash[]
  settings: { profileId: string; values: Record<string, unknown> }
  display: { width: number; height: number; depth: number }
  files: { still?: string; volatileMask?: string; frames?: string; timeline?: string }
  clip?: ClipInfo
  verification?: CaptureVerification
  tooling: { version: string; gitCommit: string; wine: string; ffmpeg: string; xvfb: string; xdotool: string }
}

export interface TimelineFrame {
  index: number
  file: string
  tStartMs: number
  tEndMs: number
  md5: string
}

export interface FrameTimeline {
  grabFps: number
  frames: TimelineFrame[]
}

export interface CaptureQuery {
  map: string
  level: Level
  region: TileRange
  source?: Source
  kind?: Kind
  /** When set, only captures of this baseline match. */
  baseline?: Baseline
  limit?: number
}

export interface CaptureMatch {
  id: string
  dir: string
  record: CaptureRecord
  crop: Rect
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface DoctorCheck {
  id: string
  status: CheckStatus
  detail: string
  fix?: string
}

export interface DoctorReport {
  ok: boolean
  checks: DoctorCheck[]
}

export type GameExecutable = 'original' | 'hd-mod' | 'hota'

export interface Calibration {
  /** Absent in calibrations written before the baseline dimension: those are `complete`. */
  baseline?: Baseline
  gameExecutable: GameExecutable
  launchMode: 'direct' | 'virtual-desktop'
  gameExeSha256: string
  editorExeSha256?: string
  positioningMethod: 'minimap-click' | 'minimap-click+arrows' | 'anchor+arrows'
  /** Probe hashes of game screens, keyed by navigation step. Local only (derived from game output). */
  probes: Record<string, string>
  loadedDlls: string[]
  measuredAt: string
}
