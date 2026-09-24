/** Full-screen triangle; no vertex buffers needed. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** 16-bit integer RGB from LibRaw -> normalised float texture (1:1 pixels). */
export const UNPACK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uRaw;
out vec4 outColor;
void main() {
  uvec3 v = texelFetch(uRaw, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(vec3(v) / 65535.0, 1.0);
}`;

/** Linear scene-referred image -> display. Grows into the full develop pipeline. */
export const DISPLAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec4 uRect;       // image rect on the canvas: x, y (from top), w, h in device pixels
uniform vec2 uCanvas;     // canvas size in device pixels
uniform float uExposure;  // EV
uniform vec3 uBackground;
out vec4 outColor;

vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    outColor = vec4(uBackground, 1.0);
    return;
  }
  vec3 c = texture(uImage, uv).rgb * exp2(uExposure);
  outColor = vec4(srgbEncode(c), 1.0);
}`;
