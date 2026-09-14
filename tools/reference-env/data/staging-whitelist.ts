// Files from the Complete edition folder made visible to the staged game.
// Anything not listed (HotA, HD Mod, campaigns) is invisible to the process, so it cannot load.

export interface WhitelistEntry {
  /** Path relative to the bundle folder, matched case-insensitively per segment. */
  path: string
  /** copy: executables (hashed, never symlinked so Wine sees a regular file); symlink: everything else. */
  mode: 'copy' | 'symlink'
  required: boolean
}

export const GAME_EXE = 'Heroes3.exe'
export const EDITOR_EXE = 'h3maped.exe'

export const STAGING_WHITELIST: readonly WhitelistEntry[] = [
  { path: GAME_EXE, mode: 'copy', required: true },
  { path: EDITOR_EXE, mode: 'copy', required: true },
  { path: 'binkw32.dll', mode: 'symlink', required: true },
  { path: 'smackw32.dll', mode: 'symlink', required: true },
  { path: 'mss32.dll', mode: 'symlink', required: true },
  { path: 'mp3dec.asi', mode: 'symlink', required: true },
  { path: 'ifc20.dll', mode: 'symlink', required: true },
  { path: 'dpwsockx.dll', mode: 'symlink', required: false },
  // DirectDraw wrapper imported by this Heroes3.exe build (loader fails with c0000135 without it).
  { path: 'zdraw.dll', mode: 'symlink', required: true },
  // Map editor help/runtime files; harmless for the game.
  { path: 'h3maped.cnt', mode: 'symlink', required: false },
  { path: 'H3MAPED.HLP', mode: 'symlink', required: false },
  { path: 'Mp3', mode: 'symlink', required: false },
  { path: 'Data/h3bitmap.lod', mode: 'symlink', required: true },
  { path: 'Data/h3sprite.lod', mode: 'symlink', required: true },
  { path: 'Data/h3ab_bmp.lod', mode: 'symlink', required: true },
  { path: 'Data/h3ab_spr.lod', mode: 'symlink', required: true },
  { path: 'Data/heroes3.snd', mode: 'symlink', required: true },
  { path: 'Data/h3ab_ahd.snd', mode: 'symlink', required: true },
  { path: 'Data/video.vid', mode: 'symlink', required: true },
  { path: 'Data/h3ab_ahd.vid', mode: 'symlink', required: true },
]

/** Archives whose hashes go into every record. */
export const HASHED_ARCHIVES: readonly string[] = STAGING_WHITELIST.filter((e) => /\.(lod|snd|vid)$/i.test(e.path)).map(
  (e) => e.path,
)

/** Name patterns that must never be staged (defence in depth for FR-004). */
export const NEVER_STAGE: readonly RegExp[] = [/^hota/i, /^h3hota/i, /^_hd3_/i, /^hd_/i, /^hw_/i, /^patcher_x86/i, /^heroes3_hd/i]
