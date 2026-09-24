import { TONE_LUT_LOG_MAX, TONE_LUT_LOG_MIN, TONE_LUT_SIZE } from '../develop/toneLut.ts';

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

const COLOR_GLSL = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }

vec3 linearToOklab(vec3 c) {
  float l = cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  float m = cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  float s = cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

vec3 oklabToLinear(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

/* Pull out-of-gamut colours towards grey of the same luminance. */
vec3 gamutCompress(vec3 c, float lum) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float t = 1.0;
  if (mx > 1.0) t = min(t, (1.0 - lum) / max(mx - lum, 1e-6));
  if (mn < 0.0) t = min(t, lum / max(lum - mn, 1e-6));
  return clamp(vec3(lum) + (c - vec3(lum)) * clamp(t, 0.0, 1.0), 0.0, 1.0);
}

vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/**
 * Develop pass: linear scene-referred RGB -> final sRGB-encoded colour.
 * Output stays at the preview resolution (1:1 texels).
 */
export const DEVELOP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uImage;     // linear RGB
uniform sampler2D uToneLut;   // R: display-linear luminance, indexed by log2(scene luminance)
uniform sampler2D uRgbLut;    // RGB curves in the encoded domain
uniform bool uUseRgbCurves;
uniform vec3 uWb;
uniform float uExposure;
uniform float uVibrance;      // -1..1
uniform float uSaturation;    // -1..1
uniform vec3 uHsl[8];         // per band: hue, sat, lum in -1..1
uniform bool uUseHsl;
out vec4 outColor;
${COLOR_GLSL}

const float LUT_MIN = ${TONE_LUT_LOG_MIN.toFixed(1)};
const float LUT_MAX = ${TONE_LUT_LOG_MAX.toFixed(1)};
const float LUT_SIZE = ${TONE_LUT_SIZE.toFixed(1)};
const float PI = 3.14159265;
// Band centres as OKLCh hue angles (degrees): red, orange, yellow, green, aqua, blue, purple, magenta.
const float BAND_HUE[8] = float[8](20.0, 55.0, 100.0, 140.0, 195.0, 255.0, 295.0, 335.0);

float toneLookup(float lum) {
  float x = (log2(max(lum, 1e-9)) - LUT_MIN) / (LUT_MAX - LUT_MIN);
  float u = (clamp(x, 0.0, 1.0) * (LUT_SIZE - 1.0) + 0.5) / LUT_SIZE;
  return texture(uToneLut, vec2(u, 0.5)).r;
}

vec3 hslAdjust(float hueDeg) {
  // Smooth partition of unity between neighbouring band centres.
  for (int i = 0; i < 8; i++) {
    float c0 = BAND_HUE[i];
    float c1 = i == 7 ? BAND_HUE[0] + 360.0 : BAND_HUE[i + 1];
    float h = hueDeg < c0 ? hueDeg + 360.0 : hueDeg;
    if (h >= c0 && h < c1) {
      float t = smoothstep(0.0, 1.0, (h - c0) / (c1 - c0));
      return mix(uHsl[i], uHsl[(i + 1) % 8], t);
    }
  }
  return uHsl[0];
}

void main() {
  vec3 c = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0).rgb;
  c *= uWb * exp2(uExposure);

  // Global tone mapping on luminance, applied as a ratio to keep hue.
  float lum = dot(c, LUMA);
  float lumOut = toneLookup(lum);
  vec3 d = lum > 1e-9 ? c * (lumOut / lum) : vec3(lumOut);
  d = gamutCompress(d, lumOut);

  // Colour work in OKLCh (perceptually uniform hue/chroma).
  vec3 lab = linearToOklab(d);
  float chroma = length(lab.yz);
  float hue = atan(lab.z, lab.y);
  float hueDeg = mod(degrees(hue), 360.0);
  float colorful = smoothstep(0.0, 0.06, chroma);

  if (uUseHsl) {
    vec3 adj = hslAdjust(hueDeg);
    // Hue and luminance shifts fade out on near-neutral pixels (their hue is noise);
    // saturation is a multiplier, so it is safe to apply everywhere.
    hue += radians(adj.x * colorful * 30.0);
    chroma *= 1.0 + adj.y;
    lab.x = clamp(lab.x + adj.z * colorful * 0.2 * lab.x * (1.0 - lab.x) * 2.0, 0.0, 1.0);
  }
  // Vibrance boosts muted colours most and goes easy on skin tones.
  float skin = smoothstep(25.0, 45.0, hueDeg) * (1.0 - smoothstep(70.0, 90.0, hueDeg));
  float vib = uVibrance * (1.0 - smoothstep(0.0, 0.22, chroma));
  if (uVibrance > 0.0) vib *= 1.0 - 0.6 * skin;
  chroma *= max(0.0, 1.0 + vib);
  chroma *= max(0.0, 1.0 + uSaturation);

  lab.yz = chroma * vec2(cos(hue), sin(hue));
  vec3 rgb = oklabToLinear(lab);
  rgb = gamutCompress(rgb, clamp(dot(rgb, LUMA), 0.0, 1.0));

  vec3 enc = srgbEncode(rgb);
  if (uUseRgbCurves) {
    enc = vec3(
      texture(uRgbLut, vec2((enc.r * 255.0 + 0.5) / 256.0, 0.5)).r,
      texture(uRgbLut, vec2((enc.g * 255.0 + 0.5) / 256.0, 0.5)).g,
      texture(uRgbLut, vec2((enc.b * 255.0 + 0.5) / 256.0, 0.5)).b);
  }
  outColor = vec4(enc, 1.0);
}`;

/**
 * Edge-aware noise reduction (bilateral), luma and colour separately.
 * `uScale` widens the kernel for full-resolution export so the look matches
 * the half-size preview.
 */
export const DENOISE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uImage;   // sRGB-encoded
uniform float uLuma;        // 0..1
uniform float uColor;       // 0..1
uniform float uScale;
out vec4 outColor;

vec3 toYcc(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
}
vec3 fromYcc(vec3 v) {
  return vec3(v.x + 1.403 * v.z, v.x - 0.344 * v.y - 0.714 * v.z, v.x + 1.773 * v.y);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uImage, 0) - 1;
  vec3 center = toYcc(texelFetch(uImage, p, 0).rgb);
  float sigmaL = mix(0.004, 0.09, uLuma);
  float sigmaC = 0.12;
  float sumWL = 0.0, sumWC = 0.0;
  float sumY = 0.0;
  vec2 sumC = vec2(0.0);
  int step = int(max(1.0, uScale));
  for (int dy = -3; dy <= 3; dy++) {
    for (int dx = -3; dx <= 3; dx++) {
      vec3 s = toYcc(texelFetch(uImage, clamp(p + ivec2(dx, dy) * step, ivec2(0), size), 0).rgb);
      float r2 = float(dx * dx + dy * dy);
      float dY = s.x - center.x;
      float wl = exp(-r2 / 4.5 - dY * dY / (2.0 * sigmaL * sigmaL));
      float wc = exp(-r2 / 18.0 - dY * dY / (2.0 * sigmaC * sigmaC));
      sumWL += wl; sumY += wl * s.x;
      sumWC += wc; sumC += wc * s.yz;
    }
  }
  vec3 outYcc = vec3(
    mix(center.x, sumY / sumWL, uLuma > 0.0 ? 1.0 : 0.0),
    mix(center.yz, sumC / sumWC, uColor));
  outColor = vec4(clamp(fromYcc(outYcc), 0.0, 1.0), 1.0);
}`;

/** Unsharp mask on luminance with a "detail" mask that spares flat/noisy areas. */
export const SHARPEN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uAmount;   // 0..1.5
uniform float uRadius;   // texels
uniform float uDetail;   // 0..1
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 size = vec2(textureSize(uImage, 0));
  vec2 uv = gl_FragCoord.xy / size;
  vec2 px = uRadius / size;
  vec3 c = texture(uImage, uv).rgb;
  float y = luma(c);
  float blur = y * 0.25;
  blur += 0.125 * (luma(texture(uImage, uv + vec2(px.x, 0.0)).rgb) + luma(texture(uImage, uv - vec2(px.x, 0.0)).rgb)
                 + luma(texture(uImage, uv + vec2(0.0, px.y)).rgb) + luma(texture(uImage, uv - vec2(0.0, px.y)).rgb));
  blur += 0.0625 * (luma(texture(uImage, uv + px).rgb) + luma(texture(uImage, uv - px).rgb)
                  + luma(texture(uImage, uv + vec2(px.x, -px.y)).rgb) + luma(texture(uImage, uv + vec2(-px.x, px.y)).rgb));
  float detail = y - blur;
  float mask = mix(smoothstep(0.004, 0.03, abs(detail)), 1.0, uDetail);
  float delta = clamp(detail * uAmount * 2.0 * mask, -0.25, 0.25);
  outColor = vec4(clamp(c + delta, 0.0, 1.0), 1.0);
}`;

/** Final image -> canvas: straighten + crop, zoom/pan, before/after split. */
export const DISPLAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uAfter;
uniform sampler2D uBefore;
uniform vec2 uCanvas;       // device pixels
uniform vec2 uImageSize;    // developed image, pixels
uniform vec4 uCrop;         // x, y, w, h of the straightened frame (normalised)
uniform float uAngle;       // radians, + = clockwise
uniform float uCoverScale;  // scale that hides empty corners after rotation
uniform float uPixelScale;  // canvas pixels per frame pixel
uniform vec2 uCenter;       // view centre in crop-normalised coords
uniform float uSplit;       // canvas x (device px) of the before/after divider, <0 = off
uniform bool uShowBefore;
uniform vec3 uBackground;
out vec4 outColor;

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 frameSize = uCrop.zw * uImageSize;
  vec2 f = uCenter + (frag - uCanvas * 0.5) / (uPixelScale * frameSize);
  if (any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(1.0)))) {
    outColor = vec4(uBackground, 1.0);
    return;
  }
  vec2 g = uCrop.xy + f * uCrop.zw;                 // position in the straightened frame
  vec2 v = (g - 0.5) * uImageSize / uCoverScale;    // pixels from the image centre
  float cs = cos(uAngle), sn = sin(uAngle);
  vec2 src = vec2(cs * v.x + sn * v.y, -sn * v.x + cs * v.y);
  vec2 uv = src / uImageSize + 0.5;

  bool before = uShowBefore || (uSplit >= 0.0 && frag.x < uSplit);
  vec3 c = before ? texture(uBefore, uv).rgb : texture(uAfter, uv).rgb;
  if (uSplit >= 0.0 && abs(frag.x - uSplit) < 1.0) c = vec3(0.95);
  outColor = vec4(c, 1.0);
}`;
