// WebGL 1.0 terrain renderer (research.md §6). GPU memory and per-frame work depend on the viewport:
// one fixed atlas, one palette texture updated in place, one vertex buffer sized to the visible
// tile range, one draw call. Receives a GL context from the runtime; never touches the DOM.

import { TILE_SIZE } from '../data/terrain.ts'
import { atlasGpuBytes } from './atlas.ts'
import type { Atlas } from './atlas.ts'
import { rangeContains, visibleRange } from './camera.ts'
import type { Camera, TileRange } from './camera.ts'
import { buildDrawPlan, VERTEX_SIZE, VERTICES_PER_QUAD } from './draw-plan.ts'
import type { DrawPlan, TerrainSource } from './draw-plan.ts'
import { animationStep, paletteRowsAt } from './palette.ts'
import { FRAGMENT_SHADER, OBJECT_FRAGMENT_SHADER, OBJECT_VERTEX_SHADER, RESOLVE_FRAGMENT_SHADER, RESOLVE_VERTEX_SHADER, VERTEX_SHADER } from './shaders.ts'
import { nextChangeMs, objectTick } from './animation.ts'
import { MAX_OBJECT_PAGES, objectAtlasGpuBytes } from './object-atlas.ts'
import type { ObjectAtlas } from './object-atlas.ts'
import { buildObjectPlan, OBJECT_VERTEX_SIZE, OBJECT_VERTICES_PER_QUAD } from './object-plan.ts'
import type { DrawListEntry, ObjectPlan } from './object-plan.ts'
import type { ObjectIndex } from '../state/object-index.ts'

/** What the object pass draws: render objects (indexed), their atlas and 9 × RGB flag colours. */
export interface ObjectLayer {
  index: ObjectIndex
  atlas: ObjectAtlas
  flagColors: Uint8Array
}

/** Animation input of a frame: a palette step (and object tick, default = step), or a clock time. */
export type FrameAnimation = { step: number; tick?: number; objectFrames?: ReadonlyMap<number, number> } | { timeMs: number }

export interface RendererStats {
  drawCalls: number
  vertices: number
  quads: number
  /** Vertices the GPU buffer holds (sized by the visible range, i.e. the viewport). */
  vertexCapacity: number
  gpuBytes: number
  framesPresented: number
  planBuilds: number
  lastFrameCpuMs: number
  animatedRowsInView: number
  objectQuads: number
  objectPages: number
  objectDrawCalls: number
  objectPlanBuilds: number
  animatedObjectsInView: number
  /** Sprites of objects in view that are not in the object atlas. */
  missingSprites: string[]
}

interface ObjectResources {
  program: WebGLProgram
  pages: WebGLTexture[]
  paletteTex: WebGLTexture
  vertexBuffer: WebGLBuffer
  bufferQuads: number
  gpuBytes: number
  attrs: { position: number; local: number; cell: number; row: number; page: number; owner: number; tint: number }
  loc: { translate: WebGLUniformLocation; viewport: WebGLUniformLocation; scale: WebGLUniformLocation; flags: WebGLUniformLocation; mode: WebGLUniformLocation }
  /** Surface-sized colour and shadow-count targets and the resolve program (research.md T046). */
  targets: { width: number; height: number; color: WebGLTexture; colorFb: WebGLFramebuffer; shadow: WebGLTexture; shadowFb: WebGLFramebuffer } | undefined
  resolve: { program: WebGLProgram; quad: WebGLBuffer; position: number; size: WebGLUniformLocation }
}

interface GlResources {
  program: WebGLProgram
  atlasTex: WebGLTexture
  paletteTex: WebGLTexture
  vertexBuffer: WebGLBuffer
  bufferQuads: number
  loc: {
    position: number
    local: number
    cell: number
    row: number
    translate: WebGLUniformLocation
    viewport: WebGLUniformLocation
    scale: WebGLUniformLocation
    atlas: WebGLUniformLocation
    palette: WebGLUniformLocation
    rows: WebGLUniformLocation
  }
}

/** Extra tiles kept around the viewport so small scrolls reuse the vertex buffer. */
const PLAN_MARGIN = 2

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`)
  }
  return shader
}

export class TerrainRenderer {
  private readonly gl: WebGLRenderingContext
  private res: GlResources | undefined
  private atlas: Atlas | undefined
  private terrain: TerrainSource | undefined
  private plan: DrawPlan | undefined
  private planLevel = -1
  private uploadedStep = -1
  private objects: ObjectLayer | undefined
  private objectsVisible = true
  private objectRes: ObjectResources | undefined
  private objectPlan: ObjectPlan | undefined
  private collectDrawList = false
  private readonly stats: RendererStats = { drawCalls: 0, vertices: 0, quads: 0, vertexCapacity: 0, gpuBytes: 0, framesPresented: 0, planBuilds: 0, lastFrameCpuMs: 0, animatedRowsInView: 0, objectQuads: 0, objectPages: 0, objectDrawCalls: 0, objectPlanBuilds: 0, animatedObjectsInView: 0, missingSprites: [] }
  private readonly now: () => number

  constructor(gl: WebGLRenderingContext, now: () => number = () => 0) {
    this.gl = gl
    this.now = now
  }

  /**
   * Largest texture this context supports. WebGL 1.0 guarantees 2048; real GPUs of the minimum
   * hardware profile allow more, which decides how many object sprites fit into the page budget
   * (spec 005: a HotA map needs several times the sprite area of a base-game map).
   */
  maxTextureSize(): number {
    const v: unknown = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
    return typeof v === 'number' && Number.isFinite(v) && v >= 2048 ? v : 2048
  }

  /** Sets the atlas (from the archive); keeps CPU copies so a lost context can be restored. */
  setAtlas(atlas: Atlas): void {
    this.atlas = atlas
    this.plan = undefined
    this.uploadedStep = -1
    this.freeResources()
  }

  setTerrain(terrain: TerrainSource): void {
    this.terrain = terrain
    this.plan = undefined
    this.objectPlan = undefined
  }

  /** Sets the objects to draw (undefined: terrain only); keeps CPU copies for context restore. */
  setObjects(objects: ObjectLayer | undefined): void {
    if (objects !== undefined && objects.atlas.layout.pageCount > MAX_OBJECT_PAGES) throw new RangeError(`object atlas has ${objects.atlas.layout.pageCount} pages, at most ${MAX_OBJECT_PAGES} are supported`)
    this.objects = objects
    this.objectPlan = undefined
    this.freeObjectResources()
  }

  setObjectsVisible(visible: boolean): void {
    this.objectsVisible = visible
  }

  /** Collects the draw list of the object pass (inspection and tests). */
  setCollectDrawList(collect: boolean): void {
    this.collectDrawList = collect
    this.objectPlan = undefined
  }

  /** Objects drawn in the last frame, in draw order (empty unless collection is enabled). */
  drawList(): DrawListEntry[] {
    return this.objectPlan?.entries ?? []
  }

  /** Earliest time after `timeMs` at which the last frame's view changes, or null. */
  nextChangeMs(timeMs: number): number | null {
    return nextChangeMs(timeMs, { animatedRows: this.stats.animatedRowsInView > 0, animatedObjects: this.stats.animatedObjectsInView > 0 })
  }

  get ready(): boolean {
    return this.atlas !== undefined && this.terrain !== undefined
  }

  /** Call after `webglcontextrestored`: GPU objects are recreated on the next frame. */
  contextRestored(): void {
    this.res = undefined
    this.objectRes = undefined
    this.objectPlan = undefined
    this.plan = undefined
    this.uploadedStep = -1
    this.stats.gpuBytes = 0
  }

  /** Palette rows visible and animated in the last frame (the scheduler needs this). */
  get hasAnimationInView(): boolean {
    return this.stats.animatedRowsInView > 0 || this.stats.animatedObjectsInView > 0
  }

  getStats(): RendererStats {
    return { ...this.stats }
  }

  /** Draws one frame for a camera at animation step `step` (or at `timeMs`). Returns false if not ready. */
  render(cam: Camera, anim: FrameAnimation): boolean {
    const gl = this.gl
    if (!this.ready || gl.isContextLost()) return false
    const t0 = this.now()
    const atlas = this.atlas as Atlas
    const terrain = this.terrain as TerrainSource
    const res = this.ensureResources(atlas)

    const view = visibleRange(cam, 1)
    if (this.plan === undefined || this.planLevel !== cam.level || !rangeContains(this.plan.range, view)) {
      const range: TileRange = { x0: view.x0 - PLAN_MARGIN, y0: view.y0 - PLAN_MARGIN, x1: view.x1 + PLAN_MARGIN, y1: view.y1 + PLAN_MARGIN }
      this.plan = buildDrawPlan(terrain, atlas.layout, cam.level, range)
      this.planLevel = cam.level
      this.stats.planBuilds++
      this.uploadPlan(res, this.plan, range)
    }
    const plan = this.plan
    const step = 'step' in anim ? anim.step : animationStep(anim.timeMs)
    if (step !== this.uploadedStep) this.uploadPalette(res, atlas, step)

    const tick = 'timeMs' in anim ? objectTick(anim.timeMs) : (anim.tick ?? anim.step)
    const frames = 'timeMs' in anim ? undefined : anim.objectFrames
    const drawObjects = this.objects !== undefined && this.objectsVisible
    if (drawObjects) {
      const objects = this.objects as ObjectLayer
      const op = this.objectPlan
      const stale = op === undefined || op.level !== cam.level || op.range !== plan.range || (op.tick !== tick && (op.animatedInView || frames !== undefined)) || frames !== undefined
      if (stale) {
        this.objectPlan = buildObjectPlan(objects.index, objects.atlas.layout, cam.level, plan.range, tick, { drawList: this.collectDrawList, ...(frames !== undefined ? { frames } : {}) })
        this.stats.objectPlanBuilds++
        this.uploadObjectPlan(this.ensureObjectResources(objects), this.objectPlan)
      }
    }

    gl.viewport(0, 0, cam.width, cam.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const translate: [number, number] = [plan.range.x0 * TILE_SIZE - cam.offsetX, plan.range.y0 * TILE_SIZE - cam.offsetY]
    const borderFrom = plan.quadCount - plan.layerQuads.border
    let drawCalls = 0
    const withObjects = drawObjects && this.objectPlan !== undefined && this.objectPlan.quadCount > 0
    if (!withObjects) {
      this.bindTerrain(res, cam, translate)
      gl.drawArrays(gl.TRIANGLES, 0, borderFrom * VERTICES_PER_QUAD)
      drawCalls++
    }
    const objectPlan = drawObjects ? this.objectPlan : undefined
    if (objectPlan !== undefined && objectPlan.quadCount > 0) {
      // Terrain and object bodies into the colour target, shadow steps into the count target, then
      // resolve in 16-bit colour to the screen (research.md T046).
      const ores = this.objectRes as ObjectResources
      const t = this.ensureTargets(ores, cam.width, cam.height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.colorFb)
      gl.viewport(0, 0, cam.width, cam.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.bindTerrain(res, cam, translate)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
      gl.drawArrays(gl.TRIANGLES, 0, borderFrom * VERTICES_PER_QUAD)
      this.bindObjects(ores, this.objects as ObjectLayer, cam, translate)
      gl.disable(gl.BLEND)
      gl.uniform1i(ores.loc.mode, 0)
      gl.drawArrays(gl.TRIANGLES, 0, objectPlan.quadCount * OBJECT_VERTICES_PER_QUAD)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.shadowFb)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.clearColor(0, 0, 0, 1)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1i(ores.loc.mode, 1)
      gl.drawArrays(gl.TRIANGLES, 0, objectPlan.quadCount * OBJECT_VERTICES_PER_QUAD)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.disable(gl.BLEND)
      this.drawResolve(ores, t)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
      drawCalls += 3
    }
    if (plan.layerQuads.border > 0) {
      this.bindTerrain(res, cam, translate)
      gl.drawArrays(gl.TRIANGLES, borderFrom * VERTICES_PER_QUAD, plan.layerQuads.border * VERTICES_PER_QUAD)
      drawCalls++
    }
    this.stats.objectQuads = objectPlan?.quadCount ?? 0
    this.stats.objectPages = drawObjects ? (this.objects as ObjectLayer).atlas.layout.pageCount : 0
    this.stats.objectDrawCalls = objectPlan !== undefined && objectPlan.quadCount > 0 ? 1 : 0
    this.stats.animatedObjectsInView = objectPlan?.animatedInView === true ? 1 : 0
    this.stats.missingSprites = objectPlan?.missing ?? []

    this.stats.drawCalls = drawCalls
    this.stats.quads = plan.quadCount
    this.stats.vertices = plan.quadCount * VERTICES_PER_QUAD
    this.stats.vertexCapacity = res.bufferQuads * VERTICES_PER_QUAD
    this.stats.animatedRowsInView = plan.animatedRows.length
    this.stats.framesPresented++
    this.stats.lastFrameCpuMs = this.now() - t0
    return true
  }

  dispose(): void {
    this.freeResources()
  }

  private bindTerrain(res: GlResources, cam: Camera, translate: [number, number]): void {
    const gl = this.gl
    gl.useProgram(res.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, res.atlasTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, res.paletteTex)
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vertexBuffer)
    this.disableAttributes()
    const stride = VERTEX_SIZE * 4
    // Layout: draw-plan.ts VERTEX_SIZE.
    gl.enableVertexAttribArray(res.loc.position)
    gl.vertexAttribPointer(res.loc.position, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(res.loc.local)
    gl.vertexAttribPointer(res.loc.local, 2, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(res.loc.cell)
    gl.vertexAttribPointer(res.loc.cell, 4, gl.FLOAT, false, stride, 16)
    gl.enableVertexAttribArray(res.loc.row)
    gl.vertexAttribPointer(res.loc.row, 1, gl.FLOAT, false, stride, 32)
    gl.uniform2f(res.loc.translate, translate[0], translate[1])
    gl.uniform2f(res.loc.viewport, cam.width, cam.height)
    gl.uniform1f(res.loc.scale, cam.scale)
  }

  private bindObjects(res: ObjectResources, objects: ObjectLayer, cam: Camera, translate: [number, number]): void {
    const gl = this.gl
    gl.useProgram(res.program)
    for (let i = 0; i < MAX_OBJECT_PAGES; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, res.pages[Math.min(i, res.pages.length - 1)] as WebGLTexture)
    }
    gl.activeTexture(gl.TEXTURE0 + MAX_OBJECT_PAGES)
    gl.bindTexture(gl.TEXTURE_2D, res.paletteTex)
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vertexBuffer)
    this.disableAttributes()
    const stride = OBJECT_VERTEX_SIZE * 4
    const a = res.attrs
    const attr = (loc: number, n: number, offset: number) => {
      if (loc < 0) return
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, offset)
    }
    // Layout: object-plan.ts OBJECT_VERTEX_SIZE.
    attr(a.position, 2, 0)
    attr(a.local, 2, 8)
    attr(a.cell, 4, 16)
    attr(a.row, 1, 32)
    attr(a.page, 1, 36)
    attr(a.owner, 1, 40)
    attr(a.tint, 1, 44)
    gl.uniform2f(res.loc.translate, translate[0], translate[1])
    gl.uniform2f(res.loc.viewport, cam.width, cam.height)
    gl.uniform1f(res.loc.scale, cam.scale)
    const flags = new Float32Array(objects.flagColors.length)
    for (let i = 0; i < flags.length; i++) flags[i] = (objects.flagColors[i] as number) / 255
    gl.uniform3fv(res.loc.flags, flags)
  }

  private ensureTargets(res: ObjectResources, width: number, height: number): NonNullable<ObjectResources['targets']> {
    const gl = this.gl
    if (res.targets !== undefined && res.targets.width === width && res.targets.height === height) return res.targets
    this.freeTargets(res)
    const target = (): { tex: WebGLTexture; fb: WebGLFramebuffer } => {
      const tex = gl.createTexture()
      const fb = gl.createFramebuffer()
      if (tex === null || fb === null) throw new Error('render target allocation failed')
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return { tex, fb }
    }
    const c = target()
    const sh = target()
    res.targets = { width, height, color: c.tex, colorFb: c.fb, shadow: sh.tex, shadowFb: sh.fb }
    // Two RGBA textures the size of the surface (constitution IV: never larger than the display).
    this.stats.gpuBytes += 2 * width * height * 4
    return res.targets
  }

  private freeTargets(res: ObjectResources): void {
    const gl = this.gl
    const t = res.targets
    if (t === undefined) return
    if (!gl.isContextLost()) {
      gl.deleteTexture(t.color)
      gl.deleteTexture(t.shadow)
      gl.deleteFramebuffer(t.colorFb)
      gl.deleteFramebuffer(t.shadowFb)
    }
    this.stats.gpuBytes -= 2 * t.width * t.height * 4
    res.targets = undefined
  }

  private drawResolve(res: ObjectResources, t: NonNullable<ObjectResources['targets']>): void {
    const gl = this.gl
    gl.useProgram(res.resolve.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, t.color)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, t.shadow)
    gl.bindBuffer(gl.ARRAY_BUFFER, res.resolve.quad)
    this.disableAttributes()
    gl.enableVertexAttribArray(res.resolve.position)
    gl.vertexAttribPointer(res.resolve.position, 2, gl.FLOAT, false, 8, 0)
    gl.uniform2f(res.resolve.size, t.width, t.height)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private disableAttributes(): void {
    const gl = this.gl
    const max = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number
    for (let i = 0; i < Math.min(max, 8); i++) gl.disableVertexAttribArray(i)
  }

  private ensureObjectResources(objects: ObjectLayer): ObjectResources {
    if (this.objectRes !== undefined) return this.objectRes
    const gl = this.gl
    const program = gl.createProgram()
    if (program === null) throw new Error('createProgram failed')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, OBJECT_VERTEX_SHADER))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, OBJECT_FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
      throw new Error(`object program link failed: ${gl.getProgramInfoLog(program) ?? ''}`)
    }
    const uniform = (name: string): WebGLUniformLocation => {
      const l = gl.getUniformLocation(program, name)
      if (l === null) throw new Error(`uniform ${name} missing`)
      return l
    }
    const texture = (): WebGLTexture => {
      const t = gl.createTexture()
      if (t === null) throw new Error('createTexture failed')
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    const { layout } = objects.atlas
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.activeTexture(gl.TEXTURE0)
    const pages = objects.atlas.pages.map((p) => {
      const t = texture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, layout.pageSize, layout.pageSize, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, p)
      return t
    })
    const paletteTex = texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, Math.max(1, layout.rowCount), 0, gl.RGBA, gl.UNSIGNED_BYTE, layout.rowCount > 0 ? objects.atlas.palettes : new Uint8Array(1024))
    const vertexBuffer = gl.createBuffer()
    if (vertexBuffer === null) throw new Error('createBuffer failed')
    gl.useProgram(program)
    for (let i = 0; i < MAX_OBJECT_PAGES; i++) gl.uniform1i(uniform(`u_page${i}`), i)
    gl.uniform1i(uniform('u_palette'), MAX_OBJECT_PAGES)
    gl.uniform1f(uniform('u_rows'), Math.max(1, layout.rowCount))
    gl.uniform1f(uniform('u_pageSize'), layout.pageSize)
    const res: ObjectResources = {
      program,
      pages,
      paletteTex,
      vertexBuffer,
      bufferQuads: 0,
      gpuBytes: objectAtlasGpuBytes(layout),
      attrs: {
        position: gl.getAttribLocation(program, 'a_position'),
        local: gl.getAttribLocation(program, 'a_local'),
        cell: gl.getAttribLocation(program, 'a_cell'),
        row: gl.getAttribLocation(program, 'a_row'),
        page: gl.getAttribLocation(program, 'a_page'),
        owner: gl.getAttribLocation(program, 'a_owner'),
        tint: gl.getAttribLocation(program, 'a_tint'),
      },
      loc: { translate: uniform('u_translate'), viewport: uniform('u_viewport'), scale: uniform('u_scale'), flags: uniform('u_flags[0]'), mode: uniform('u_mode') },
      targets: undefined,
      resolve: this.createResolve(),
    }
    this.stats.gpuBytes += res.gpuBytes
    this.objectRes = res
    return res
  }

  private createResolve(): ObjectResources['resolve'] {
    const gl = this.gl
    const program = gl.createProgram()
    const quad = gl.createBuffer()
    if (program === null || quad === null) throw new Error('resolve program allocation failed')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, RESOLVE_VERTEX_SHADER))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, RESOLVE_FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
      throw new Error(`resolve program link failed: ${gl.getProgramInfoLog(program) ?? ''}`)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    const color = gl.getUniformLocation(program, 'u_color')
    const shadow = gl.getUniformLocation(program, 'u_shadow')
    const size = gl.getUniformLocation(program, 'u_size')
    if (color === null || shadow === null || size === null) throw new Error('resolve uniforms missing')
    gl.uniform1i(color, 0)
    gl.uniform1i(shadow, 1)
    return { program, quad, position: gl.getAttribLocation(program, 'a_position'), size }
  }

  private uploadObjectPlan(res: ObjectResources, plan: ObjectPlan): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vertexBuffer)
    const bytesPerQuad = OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE * 4
    if (plan.quadCount > res.bufferQuads) {
      // Grow in powers of two from the largest count seen; never shrink while objects are set.
      let capacity = Math.max(64, res.bufferQuads)
      while (capacity < plan.quadCount) capacity *= 2
      gl.bufferData(gl.ARRAY_BUFFER, capacity * bytesPerQuad, gl.DYNAMIC_DRAW)
      this.stats.gpuBytes += (capacity - res.bufferQuads) * bytesPerQuad
      res.bufferQuads = capacity
    }
    if (plan.quadCount > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, plan.vertices.subarray(0, plan.quadCount * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE))
  }

  private freeObjectResources(): void {
    const gl = this.gl
    const r = this.objectRes
    if (r !== undefined) {
      this.freeTargets(r)
      if (!gl.isContextLost()) {
        gl.deleteProgram(r.program)
        gl.deleteProgram(r.resolve.program)
        gl.deleteBuffer(r.resolve.quad)
        for (const t of r.pages) gl.deleteTexture(t)
        gl.deleteTexture(r.paletteTex)
        gl.deleteBuffer(r.vertexBuffer)
      }
      this.stats.gpuBytes -= r.gpuBytes + r.bufferQuads * OBJECT_VERTICES_PER_QUAD * OBJECT_VERTEX_SIZE * 4
    }
    this.objectRes = undefined
  }

  private freeResources(): void {
    const gl = this.gl
    this.freeObjectResources()
    if (this.res !== undefined && !gl.isContextLost()) {
      gl.deleteProgram(this.res.program)
      gl.deleteTexture(this.res.atlasTex)
      gl.deleteTexture(this.res.paletteTex)
      gl.deleteBuffer(this.res.vertexBuffer)
    }
    this.res = undefined
    this.stats.gpuBytes = 0
  }

  private ensureResources(atlas: Atlas): GlResources {
    if (this.res !== undefined) return this.res
    const gl = this.gl
    const program = gl.createProgram()
    if (program === null) throw new Error('createProgram failed')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? ''}`)
    }
    const uniform = (name: string): WebGLUniformLocation => {
      const l = gl.getUniformLocation(program, name)
      if (l === null) throw new Error(`uniform ${name} missing`)
      return l
    }
    const texture = (): WebGLTexture => {
      const t = gl.createTexture()
      if (t === null) throw new Error('createTexture failed')
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    const size = atlas.layout.size
    gl.activeTexture(gl.TEXTURE0)
    const atlasTex = texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, size, size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, atlas.indices)
    gl.activeTexture(gl.TEXTURE1)
    const paletteTex = texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, atlas.layout.rowCount, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.palettes)
    const vertexBuffer = gl.createBuffer()
    if (vertexBuffer === null) throw new Error('createBuffer failed')
    const res: GlResources = {
      program,
      atlasTex,
      paletteTex,
      vertexBuffer,
      bufferQuads: 0,
      loc: {
        position: gl.getAttribLocation(program, 'a_position'),
        local: gl.getAttribLocation(program, 'a_local'),
        cell: gl.getAttribLocation(program, 'a_cell'),
        row: gl.getAttribLocation(program, 'a_row'),
        translate: uniform('u_translate'),
        viewport: uniform('u_viewport'),
        scale: uniform('u_scale'),
        atlas: uniform('u_atlas'),
        palette: uniform('u_palette'),
        rows: uniform('u_rows'),
      },
    }
    gl.useProgram(program)
    gl.uniform1i(res.loc.atlas, 0)
    gl.uniform1i(res.loc.palette, 1)
    gl.uniform1f(res.loc.rows, atlas.layout.rowCount)
    gl.uniform1f(uniform('u_atlasSize'), size)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
    gl.disable(gl.DEPTH_TEST)
    this.stats.gpuBytes = atlasGpuBytes(atlas.layout)
    this.uploadedStep = 0
    this.res = res
    return res
  }

  private uploadPlan(res: GlResources, plan: DrawPlan, range: TileRange): void {
    const gl = this.gl
    // Size the buffer for the range's maximum so the GPU allocation stays constant for a viewport.
    const capacity = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) * 3
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vertexBuffer)
    if (capacity !== res.bufferQuads) {
      const bytes = capacity * VERTICES_PER_QUAD * VERTEX_SIZE * 4
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW)
      this.stats.gpuBytes += bytes - res.bufferQuads * VERTICES_PER_QUAD * VERTEX_SIZE * 4
      res.bufferQuads = capacity
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, plan.vertices)
  }

  private uploadPalette(res: GlResources, atlas: Atlas, step: number): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, res.paletteTex)
    for (const u of paletteRowsAt(atlas.layout, atlas.palettes, step)) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, u.row, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, u.rgba)
    }
    this.uploadedStep = step
  }
}
