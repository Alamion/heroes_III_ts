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
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.ts'

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
}

interface GlResources {
  program: WebGLProgram
  atlasTex: WebGLTexture
  paletteTex: WebGLTexture
  vertexBuffer: WebGLBuffer
  bufferQuads: number
  loc: {
    position: number
    uv: number
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
  private readonly stats: RendererStats = { drawCalls: 0, vertices: 0, quads: 0, vertexCapacity: 0, gpuBytes: 0, framesPresented: 0, planBuilds: 0, lastFrameCpuMs: 0, animatedRowsInView: 0 }
  private readonly now: () => number

  constructor(gl: WebGLRenderingContext, now: () => number = () => 0) {
    this.gl = gl
    this.now = now
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
  }

  get ready(): boolean {
    return this.atlas !== undefined && this.terrain !== undefined
  }

  /** Call after `webglcontextrestored`: GPU objects are recreated on the next frame. */
  contextRestored(): void {
    this.res = undefined
    this.plan = undefined
    this.uploadedStep = -1
    this.stats.gpuBytes = 0
  }

  /** Palette rows visible and animated in the last frame (the scheduler needs this). */
  get hasAnimationInView(): boolean {
    return this.stats.animatedRowsInView > 0
  }

  getStats(): RendererStats {
    return { ...this.stats }
  }

  /** Draws one frame for a camera at animation step `step` (or at `timeMs`). Returns false if not ready. */
  render(cam: Camera, anim: { step: number } | { timeMs: number }): boolean {
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

    gl.viewport(0, 0, cam.width, cam.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(res.program)
    gl.uniform2f(res.loc.translate, plan.range.x0 * TILE_SIZE - cam.offsetX, plan.range.y0 * TILE_SIZE - cam.offsetY)
    gl.uniform2f(res.loc.viewport, cam.width, cam.height)
    gl.uniform1f(res.loc.scale, cam.scale)
    gl.drawArrays(gl.TRIANGLES, 0, plan.quadCount * VERTICES_PER_QUAD)

    this.stats.drawCalls = 1
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

  private freeResources(): void {
    const gl = this.gl
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
        uv: gl.getAttribLocation(program, 'a_uv'),
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
    const stride = VERTEX_SIZE * 4
    gl.enableVertexAttribArray(res.loc.position)
    gl.vertexAttribPointer(res.loc.position, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(res.loc.uv)
    gl.vertexAttribPointer(res.loc.uv, 2, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(res.loc.row)
    gl.vertexAttribPointer(res.loc.row, 1, gl.FLOAT, false, stride, 16)
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
