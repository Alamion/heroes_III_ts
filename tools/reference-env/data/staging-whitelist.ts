// Files made visible to a staged game, per baseline. Anything not listed is invisible to the
// process, so it cannot load. See data/baselines.ts for how the two lists are used.

export interface WhitelistEntry {
  /** Path relative to the bundle folder, matched case-insensitively per segment. */
  path: string
  /**
   * copy: executables (hashed, never symlinked so Wine sees a regular file);
   * symlink: read-only data;
   * text: small configuration files the game may rewrite — copied so a write cannot reach the
   * original install, optionally with a transform applied.
   */
  mode: 'copy' | 'symlink' | 'text'
  required: boolean
  /** `text` entries only: rewrite the file's contents before staging it. */
  rewrite?: (text: string) => string
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

export const HOTA_GAME_EXE = 'h3hota.exe'
export const HOTA_EDITOR_EXE = 'h3hota_maped.exe'

/** HotA checks for updates on start; a capture run must not go online or rewrite the install. */
function disableAutoUpdate(text: string): string {
  return text.replace(/^(\s*AutoUpdate\s*=\s*).*$/gim, '$1false')
}

/**
 * Captures run on the developer's machine and must stay silent. Wine's audio drivers are disabled
 * for the whole prefix (env/wine.ts); this turns the game's own background sounds off as well, so
 * silence does not depend on a single mechanism.
 */
function disableSound(text: string): string {
  const off = text.replace(/^(\s*Enable Bckgr Sounds\s*=\s*).*$/gim, '$1false')
  return /Enable Bckgr Sounds/i.test(off) ? off : `${off.trimEnd()}\n\n[Game Settings]\n\nEnable Bckgr Sounds=false\n`
}

/**
 * HotA 1.8 (measured on the owner's 1.8.1 install, 2026-09-23): `h3hota.exe` needs its own
 * `patcher_x86.dll` and `binkw32new.dll` next to the vanilla runtime DLLs, and exits with code 5
 * or a "not found" box without them. HD Mod files are never staged (see baselines.ts).
 */
export const HOTA_STAGING_WHITELIST: readonly WhitelistEntry[] = [
  { path: HOTA_GAME_EXE, mode: 'copy', required: true },
  { path: HOTA_EDITOR_EXE, mode: 'copy', required: true },
  { path: 'HotA.dll', mode: 'symlink', required: true },
  { path: 'hota_me.dll', mode: 'symlink', required: true },
  { path: 'HotA.dat', mode: 'symlink', required: true },
  { path: 'HotA_Data', mode: 'symlink', required: true },
  { path: 'HotA_RMGTemplates', mode: 'symlink', required: false },
  { path: 'patcher_x86.dll', mode: 'symlink', required: true },
  // Copied, not linked: the game may rewrite its ini files and must never touch the install.
  { path: 'patcher_x86.ini', mode: 'text', required: false },
  { path: 'binkw32.dll', mode: 'symlink', required: true },
  { path: 'binkw32new.dll', mode: 'symlink', required: true },
  { path: 'smackw32.dll', mode: 'symlink', required: true },
  { path: 'mss32.dll', mode: 'symlink', required: true },
  { path: 'nullmss.dll', mode: 'symlink', required: false },
  { path: 'mp3dec.asi', mode: 'symlink', required: true },
  { path: 'ifc20.dll', mode: 'symlink', required: true },
  { path: 'Mp3', mode: 'symlink', required: false },
  { path: 'HotA_settings.ini', mode: 'text', required: false, rewrite: disableSound },
  { path: 'HotA_Setup.ini', mode: 'text', required: false, rewrite: disableAutoUpdate },
  { path: 'Data/HotA.lod', mode: 'symlink', required: true },
  { path: 'Data/HotA_lng.lod', mode: 'symlink', required: true },
  { path: 'Data/HotA_ext.lod', mode: 'symlink', required: false },
  { path: 'Data/HotA_l_ext.lod', mode: 'symlink', required: false },
  { path: 'Data/h3bitmap.lod', mode: 'symlink', required: true },
  { path: 'Data/h3sprite.lod', mode: 'symlink', required: true },
  { path: 'Data/h3ab_bmp.lod', mode: 'symlink', required: true },
  { path: 'Data/h3ab_spr.lod', mode: 'symlink', required: true },
  { path: 'Data/heroes3.snd', mode: 'symlink', required: true },
  { path: 'Data/h3ab_ahd.snd', mode: 'symlink', required: true },
  { path: 'Data/HotA.snd', mode: 'symlink', required: false },
  { path: 'Data/HotA_lng.snd', mode: 'symlink', required: false },
  { path: 'Data/video.vid', mode: 'symlink', required: true },
  { path: 'Data/h3ab_ahd.vid', mode: 'symlink', required: false },
  { path: 'Data/HotA.vid', mode: 'symlink', required: false },
]

/** Archives of a whitelist whose hashes go into every record. */
export function hashedArchives(whitelist: readonly WhitelistEntry[]): string[] {
  return whitelist.filter((e) => /\.(lod|snd|vid)$/i.test(e.path)).map((e) => e.path)
}

/** Archives of the Complete edition (kept for callers that predate the baseline dimension). */
export const HASHED_ARCHIVES: readonly string[] = hashedArchives(STAGING_WHITELIST)
