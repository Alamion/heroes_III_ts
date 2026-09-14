import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { cropForRegion } from '../analysis/geometry.ts'
import { buildVolatileMask } from '../analysis/volatile-mask.ts'
import { EDITOR_LAYOUT, EDITOR_OVERLAYS, EDITOR_SCREEN, type EditorOverlay } from '../data/editor-layout.ts'
import { EDITOR_EXE } from '../data/staging-whitelist.ts'
import { openEditor, positionEditorView, setOverlays, showEditorLevel, type EditorSession, type EditorView } from '../env/editor.ts'
import { writeGrayPng, writePng, type RawFrame } from '../env/grab.ts'
import { acquireLock } from '../env/lock.ts'
import { toolVersions } from '../env/tooling.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { CaptureMatch, CaptureRecord } from '../model/types.ts'
import { captureDir, captureId, writeCaptureAtomically } from '../store/capture-store.ts'
import { config, intOpt, stagedHashes, targetContext } from './common.ts'
import { requirePrereqs } from './doctor.ts'

export const editorCommand: Command = async (args) => {
  const cfg = config()
  const overlays = (args.flags.get('overlay') ?? []).map((o) => {
    if (!(o in EDITOR_OVERLAYS)) throw new RefError(ERROR_CODES.USAGE, `unknown overlay "${o}" (known: ${Object.keys(EDITOR_OVERLAYS).join(', ')})`)
    return o as EditorOverlay
  })
  await requirePrereqs(cfg, ['bundle-found', 'wine', 'xvfb', 'xdotool', 'ffmpeg', 'prefix', 'captures-gitignored'])
  const ctx = await targetContext(cfg, args)
  const lock = await acquireLock(cfg.stateDir, cfg.timeouts.lockWait, `editor ${ctx.map.name}`)
  const launches = intOpt(args, 'launches', 3)
  if (launches < 1 || launches > 10) throw new RefError(ERROR_CODES.USAGE, '--launches must be 1–10')
  let session: EditorSession | undefined
  try {
    // The editor draws animated objects in a frame chosen at launch and never repaints them
    // differently within a run, so the volatile mask compares separate launches.
    const frames: RawFrame[] = []
    let view: EditorView | undefined
    for (let i = 0; i < launches; i++) {
      session = await openEditor(cfg, ctx.mapPath, cfg.timeouts.step * 2)
      await showEditorLevel(session, ctx.level)
      await setOverlays(session, overlays)
      const v = await positionEditorView(session, ctx.target, ctx.map.sizeTiles, join(cfg.stateDir, 'spikes', 'editor'))
      if (view !== undefined && (v.origin.x !== view.origin.x || v.origin.y !== view.origin.y)) {
        throw new RefError(ERROR_CODES.POSITION_MISMATCH, 'editor launches disagree on the view origin')
      }
      view = v
      frames.push(await session.grab())
      await session.close()
      session = undefined
    }
    const frame = frames[0] as RawFrame
    const mask = buildVolatileMask(
      frames.map((f) => f.rgb),
      frame.width,
      frame.height,
    )
    if (view === undefined) throw new RefError(ERROR_CODES.GRAB_FAILED, 'no editor frame grabbed')
    const hashes = await stagedHashes(cfg)
    const createdAt = new Date()
    const id = captureId(createdAt, view.visible)
    const req = ctx.target
    const contains = req.x >= view.visible.x0 && req.x <= view.visible.x1 && req.y >= view.visible.y0 && req.y <= view.visible.y1
    const record: CaptureRecord = {
      schemaVersion: 1,
      id,
      createdAt: createdAt.toISOString(),
      source: 'editor',
      kind: 'still',
      map: ctx.map,
      level: ctx.level,
      requested: req,
      ...(contains ? {} : { clamped: true }),
      visible: view.visible,
      mapping: view.mapping,
      positionSource: 'editor-view',
      visibility: { method: 'editor', overlays },
      cursor: { drawnByX: false, parkedAt: EDITOR_LAYOUT.cursorPark },
      executable: { file: EDITOR_EXE, sha256: hashes.editor, label: 'h3maped.exe (original)' },
      archives: hashes.archives,
      settings: { profileId: 'editor-defaults-v1', values: { overlays, maskLaunches: launches } },
      display: { ...EDITOR_SCREEN },
      files: { still: 'still.png', volatileMask: 'volatile-mask.png' },
      tooling: await toolVersions(cfg.repoRoot, cfg.wineBinary),
    }
    const dir = captureDir(cfg.capturesDir, ctx.map.key, ctx.level, 'editor', 'still', id)
    await writeCaptureAtomically(dir, record, async (tmp) => {
      await writePng(frame, join(tmp, 'still.png'))
      await writeGrayPng(mask, frame.width, frame.height, join(tmp, 'volatile-mask.png'))
    })
    const capture: CaptureMatch = { id, dir, record, crop: cropForRegion(record.mapping, { x0: req.x, y0: req.y, x1: req.x, y1: req.y }) }
    return { ok: true, capture }
  } finally {
    if (session !== undefined) await session.close()
    lock.release()
  }
}
