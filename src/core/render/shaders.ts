// One program for all terrain layers: palette-index atlas → palette row lookup (research.md §5, §6).
//
// Sampling at any display scale (spec 004 research "Pixel mapping at fractional display scales"): each
// device pixel shows the world pixel under its centre, floor((p + 0.5) / scale + offset), exactly as a
// nearest-neighbour upscale of the scale-1 image. Quads are widened by half a world pixel so no pixel
// centre lies on an edge; the fragment shader derives the world pixel inside the quad from the
// interpolated local coordinate (a centre exactly on a pixel boundary belongs to the next pixel, as
// floor does) and discards pixels outside the cell. The mapping depends on world positions only, so
// cells never bleed into their neighbours and cropped animation frames never move by a device pixel.

/** Vertex part shared by the terrain and object programs: widened quad, local coordinate, cell. */
const QUAD_VERTEX = `
attribute vec2 a_position;
attribute vec2 a_local;
attribute vec4 a_cell;
uniform vec2 u_translate;
uniform vec2 u_viewport;
uniform float u_scale;
varying vec2 v_local;
varying vec4 v_cell;
void placeQuad() {
  // -1 at the quad's left/top corner, +1 at its right/bottom corner.
  vec2 dir = sign(a_local * 2.0 - abs(a_cell.zw));
  vec2 px = (a_position + dir * 0.5 + u_translate) * u_scale;
  vec2 clip = px / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_local + dir * 0.5;
  v_cell = a_cell;
}
`

/**
 * Fragment part: texel (in atlas pixels) of the world pixel under this fragment, or discard. `a_cell`
 * is the cell's top-left texel and size; a negative size mirrors that axis.
 */
const QUAD_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_local;
varying vec4 v_cell;
vec2 cellTexel() {
  vec2 size = floor(abs(v_cell.zw) + 0.5);
  vec2 p = floor(v_local + 1.0 / 256.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) discard;
  vec2 texel = mix(p, size - 1.0 - p, step(v_cell.zw, vec2(0.0)));
  return floor(v_cell.xy + 0.5) + texel;
}
`

export const VERTEX_SHADER = `
attribute float a_row;
varying float v_row;
${QUAD_VERTEX}
void main() {
  placeQuad();
  v_row = a_row;
}
`

export const FRAGMENT_SHADER = `
${QUAD_FRAGMENT}
uniform sampler2D u_atlas;
uniform sampler2D u_palette;
uniform float u_rows;
uniform float u_atlasSize;
varying float v_row;
void main() {
  float index = floor(texture2D(u_atlas, (cellTexel() + 0.5) / u_atlasSize).r * 255.0 + 0.5);
  vec4 color = texture2D(u_palette, vec2((index + 0.5) / 256.0, (v_row + 0.5) / u_rows));
  if (color.a == 0.0) discard;
  gl_FragColor = color;
}
`

// Object program (specs/003-map-objects/research.md §2, §3): pages bound to units 0–5, palette to
// unit 6; the flag colour of the owner is looked up per vertex (uniform arrays may only be indexed
// dynamically in vertex shaders in GLSL ES 1.0).

export const OBJECT_VERTEX_SHADER = `
attribute float a_row;
attribute float a_page;
attribute float a_owner;
uniform vec3 u_flags[9];
varying float v_row;
varying float v_page;
varying vec3 v_flag;
${QUAD_VERTEX}
void main() {
  placeQuad();
  v_row = a_row;
  v_page = a_page;
  v_flag = u_flags[int(a_owner + 0.5)];
}
`

export const OBJECT_FRAGMENT_SHADER = `
${QUAD_FRAGMENT}
uniform sampler2D u_page0;
uniform sampler2D u_page1;
uniform sampler2D u_page2;
uniform sampler2D u_page3;
uniform sampler2D u_page4;
uniform sampler2D u_page5;
uniform sampler2D u_palette;
uniform float u_rows;
uniform float u_pageSize;
uniform int u_mode;
varying float v_row;
varying float v_page;
varying vec3 v_flag;
void main() {
  vec2 uv = (cellTexel() + 0.5) / u_pageSize;
  vec4 t;
  if (v_page < 0.5) t = texture2D(u_page0, uv);
  else if (v_page < 1.5) t = texture2D(u_page1, uv);
  else if (v_page < 2.5) t = texture2D(u_page2, uv);
  else if (v_page < 3.5) t = texture2D(u_page3, uv);
  else if (v_page < 4.5) t = texture2D(u_page4, uv);
  else t = texture2D(u_page5, uv);
  float index = floor(t.r * 255.0 + 0.5);
  vec4 color = texture2D(u_palette, vec2((index + 0.5) / 256.0, (v_row + 0.5) / u_rows));
  float alpha = floor(color.a * 255.0 + 0.5);
  if (alpha == 0.0) discard;
  bool body = alpha == 255.0;
  if (u_mode == 0) {
    // Colour target: body pixels only.
    if (!body) discard;
    gl_FragColor = index == 5.0 ? vec4(v_flag, 1.0) : color;
  } else {
    // Shadow-count target (blend ONE, ONE_MINUS_SRC_ALPHA): body resets, shadows add one step.
    if (body) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    else if (alpha == 128.0) gl_FragColor = vec4(1.0 / 255.0, 0.0, 0.0, 0.0);
    else gl_FragColor = vec4(0.0, 1.0 / 255.0, 0.0, 0.0);
  }
}
`

// Resolve pass: applies counted shadow steps (R = dark, G = light) to the colour target in 16-bit
// colour, as the game does (research.md T046).
export const RESOLVE_VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const RESOLVE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_color;
uniform sampler2D u_shadow;
uniform vec2 u_size;
vec3 darken(vec3 c, float dark, float light) {
  for (int i = 0; i < 8; i++) {
    if (float(i) >= dark) break;
    c = floor(c / 2.0);
  }
  for (int i = 0; i < 8; i++) {
    if (float(i) >= light) break;
    c = floor(c / 2.0) + floor(c / 4.0);
  }
  return c;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec3 color = texture2D(u_color, uv).rgb;
  vec4 counts = texture2D(u_shadow, uv);
  float dark = floor(counts.r * 255.0 + 0.5);
  float light = floor(counts.g * 255.0 + 0.5);
  if (dark == 0.0 && light == 0.0) {
    gl_FragColor = vec4(color, 1.0);
    return;
  }
  vec3 bits = vec3(31.0, 63.0, 31.0);
  vec3 c = darken(floor(color * bits + 0.5), dark, light);
  gl_FragColor = vec4(c / bits, 1.0);
}
`
