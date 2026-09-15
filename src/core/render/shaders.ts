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
  vec2 px = (a_position + u_translate) * u_scale;
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
