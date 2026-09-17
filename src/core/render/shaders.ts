// One program for all terrain layers: palette-index atlas → palette row lookup (research.md §5, §6).

export const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute float a_row;
uniform vec2 u_translate;
uniform vec2 u_viewport;
uniform float u_scale;
varying vec2 v_uv;
varying float v_row;
void main() {
  // Snap to device pixels: at fractional scales a quad edge on a pixel centre samples the next atlas cell.
  vec2 px = floor((a_position + u_translate) * u_scale + 0.5);
  vec2 clip = px / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_row = a_row;
}
`

export const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_atlas;
uniform sampler2D u_palette;
uniform float u_rows;
varying vec2 v_uv;
varying float v_row;
void main() {
  float index = floor(texture2D(u_atlas, v_uv).r * 255.0 + 0.5);
  vec4 color = texture2D(u_palette, vec2((index + 0.5) / 256.0, (v_row + 0.5) / u_rows));
  if (color.a == 0.0) discard;
  gl_FragColor = color;
}
`

// Object program (specs/003-map-objects/research.md §2, §3): pages bound to units 0–5, palette to
// unit 6; the flag colour of the owner is looked up per vertex (uniform arrays may only be indexed
// dynamically in vertex shaders in GLSL ES 1.0).

export const OBJECT_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute float a_row;
attribute float a_page;
attribute float a_owner;
uniform vec2 u_translate;
uniform vec2 u_viewport;
uniform float u_scale;
uniform vec3 u_flags[9];
varying vec2 v_uv;
varying float v_row;
varying float v_page;
varying vec3 v_flag;
void main() {
  // Snap to device pixels: at fractional scales a quad edge on a pixel centre samples the next atlas cell.
  vec2 px = floor((a_position + u_translate) * u_scale + 0.5);
  vec2 clip = px / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_row = a_row;
  v_page = a_page;
  v_flag = u_flags[int(a_owner + 0.5)];
}
`

export const OBJECT_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_page0;
uniform sampler2D u_page1;
uniform sampler2D u_page2;
uniform sampler2D u_page3;
uniform sampler2D u_page4;
uniform sampler2D u_page5;
uniform sampler2D u_palette;
uniform float u_rows;
uniform int u_mode;
varying vec2 v_uv;
varying float v_row;
varying float v_page;
varying vec3 v_flag;
void main() {
  vec4 t;
  if (v_page < 0.5) t = texture2D(u_page0, v_uv);
  else if (v_page < 1.5) t = texture2D(u_page1, v_uv);
  else if (v_page < 2.5) t = texture2D(u_page2, v_uv);
  else if (v_page < 3.5) t = texture2D(u_page3, v_uv);
  else if (v_page < 4.5) t = texture2D(u_page4, v_uv);
  else t = texture2D(u_page5, v_uv);
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
