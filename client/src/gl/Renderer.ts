import { defaultEditParams, type EditParams, HSL_BANDS } from '@raw/shared';
import type { LinearImage } from '../raw/rawLoader.ts';
import { buildRgbCurveLut, buildToneLut, TONE_LUT_SIZE } from '../develop/toneLut.ts';
import { isIdentityCurve } from '../develop/curves.ts';
import { whiteBalanceGains } from '../develop/color.ts';
import { compileProgram, uniformLocations } from './glUtils.ts';
import { DENOISE_FS, DEVELOP_FS, DISPLAY_FS, FULLSCREEN_VS, SHARPEN_FS, UNPACK_FS } from './shaders.ts';
import { coverScale, FIT_VIEW, FULL_CROP, pixelScale, type Layout, type ViewTransform } from './viewMath.ts';

export interface DisplayOptions {
  view: ViewTransform;
  /** Before/after divider position as a fraction of canvas width; null = off. */
  split: number | null;
  showBefore: boolean;
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
  total: number;
}

const BACKGROUND: [number, number, number] = [0.067, 0.071, 0.078];
export const VIEW_PADDING_CSS = 12;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

/**
 * GPU image pipeline:
 *   linear (RGBA16F) --develop--> A --denoise--> B --sharpen--> A  --display--> canvas
 * Develop/detail passes only re-run when the edit params change; zooming,
 * panning and the before/after split only re-run the cheap display pass.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private programs;
  private uniforms;
  private linearTex: WebGLTexture | null = null;
  private work: [Target, Target] | null = null;
  private before: Target | null = null;
  private finalTex: WebGLTexture | null = null;
  private toneLut: WebGLTexture;
  private rgbLut: WebGLTexture;
  private image: { width: number; height: number } | null = null;
  private params: EditParams = defaultEditParams();
  private display: DisplayOptions = { view: FIT_VIEW, split: null, showBefore: false };
  private developDirty = false;
  private frame = 0;
  private dpr = 1;
  /** Called after the develop passes re-run (e.g. to refresh the histogram). */
  onDeveloped: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not supported by this browser');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('This GPU cannot render to floating-point textures');
    }
    this.gl = gl;
    const prog = (fs: string) => compileProgram(gl, FULLSCREEN_VS, fs);
    this.programs = {
      unpack: prog(UNPACK_FS),
      develop: prog(DEVELOP_FS),
      denoise: prog(DENOISE_FS),
      sharpen: prog(SHARPEN_FS),
      display: prog(DISPLAY_FS),
    };
    const p = this.programs;
    this.uniforms = {
      develop: uniformLocations(gl, p.develop, [
        'uImage', 'uToneLut', 'uRgbLut', 'uUseRgbCurves', 'uWb', 'uExposure', 'uVibrance', 'uSaturation', 'uHsl', 'uUseHsl',
      ] as const),
      denoise: uniformLocations(gl, p.denoise, ['uImage', 'uLuma', 'uColor', 'uScale'] as const),
      sharpen: uniformLocations(gl, p.sharpen, ['uImage', 'uAmount', 'uRadius', 'uDetail'] as const),
      display: uniformLocations(gl, p.display, [
        'uAfter', 'uBefore', 'uCanvas', 'uImageSize', 'uCrop', 'uAngle', 'uCoverScale', 'uPixelScale', 'uCenter',
        'uSplit', 'uShowBefore', 'uBackground',
      ] as const),
    };
    this.toneLut = this.createLutTexture();
    this.rgbLut = this.createLutTexture();
    gl.bindVertexArray(gl.createVertexArray());
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
  }

  get imageSize() {
    return this.image;
  }

  // ---------------------------------------------------------------- setup

  private createLutTexture(): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private createTarget(width: number, height: number, mipmapped: boolean): Target {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = mipmapped ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  private deleteTarget(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private releaseImage() {
    const { gl } = this;
    if (this.linearTex) gl.deleteTexture(this.linearTex);
    this.work?.forEach((t) => this.deleteTarget(t));
    this.deleteTarget(this.before);
    this.linearTex = null;
    this.work = null;
    this.before = null;
    this.finalTex = null;
    this.image = null;
  }

  setImage(img: LinearImage) {
    const { gl } = this;
    if (img.width > this.maxTextureSize || img.height > this.maxTextureSize) {
      throw new Error(`Image ${img.width}x${img.height} exceeds GPU texture limit ${this.maxTextureSize}`);
    }
    this.releaseImage();

    const rawTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, img.width, img.height, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, img.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const linearTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, linearTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, img.width, img.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, linearTex, 0);
    gl.viewport(0, 0, img.width, img.height);
    gl.useProgram(this.programs.unpack);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.uniform1i(gl.getUniformLocation(this.programs.unpack, 'uRaw'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(rawTex);

    this.linearTex = linearTex;
    this.image = { width: img.width, height: img.height };
    this.work = [this.createTarget(img.width, img.height, true), this.createTarget(img.width, img.height, true)];
    this.before = this.createTarget(img.width, img.height, true);
    this.developInto(this.before, defaultEditParams(), false);
    this.developDirty = true;
    this.requestRender();
  }

  clearImage() {
    this.releaseImage();
    this.requestRender();
  }

  setParams(params: EditParams) {
    this.params = params;
    this.developDirty = true;
    this.requestRender();
  }

  setDisplay(display: Partial<DisplayOptions>) {
    this.display = { ...this.display, ...display };
    this.requestRender();
  }

  /** Match the drawing buffer to the element's on-screen size. */
  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestRender();
  }

  /** Current layout in device pixels (for pointer maths in the viewer). */
  layout(): Layout | null {
    if (!this.image) return null;
    const crop = this.params.geometry.crop ?? FULL_CROP;
    return {
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      frameW: crop.w * this.image.width,
      frameH: crop.h * this.image.height,
      padding: VIEW_PADDING_CSS * this.dpr,
    };
  }

  // ---------------------------------------------------------------- passes

  private drawTo(target: Target, program: WebGLProgram, input: WebGLTexture) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.image!.width, this.image!.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private uploadLuts(p: EditParams) {
    const { gl } = this;
    const lumaCurve = isIdentityCurve(p.curve.luma) ? undefined : p.curve.luma;
    gl.bindTexture(gl.TEXTURE_2D, this.toneLut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, TONE_LUT_SIZE, 1, 0, gl.RED, gl.FLOAT, buildToneLut(p.light, lumaCurve));
    gl.bindTexture(gl.TEXTURE_2D, this.rgbLut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, buildRgbCurveLut(p.curve.red, p.curve.green, p.curve.blue));
  }

  /** Runs develop (+ detail passes if `withDetail`) and returns the texture holding the result. */
  private developInto(target: Target, p: EditParams, withDetail: boolean): WebGLTexture {
    const { gl } = this;
    const u = this.uniforms.develop;
    this.uploadLuts(p);
    gl.useProgram(this.programs.develop);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.toneLut);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.rgbLut);
    gl.uniform1i(u.uImage, 0);
    gl.uniform1i(u.uToneLut, 1);
    gl.uniform1i(u.uRgbLut, 2);
    const { red, green, blue } = p.curve;
    gl.uniform1i(u.uUseRgbCurves, [red, green, blue].some((c) => !isIdentityCurve(c)) ? 1 : 0);
    gl.uniform3fv(u.uWb, whiteBalanceGains(p.wb.temp, p.wb.tint));
    gl.uniform1f(u.uExposure, p.light.exposure);
    gl.uniform1f(u.uVibrance, p.color.vibrance / 100);
    gl.uniform1f(u.uSaturation, p.color.saturation / 100);
    const hsl = HSL_BANDS.flatMap((b) => [p.hsl[b].hue / 100, p.hsl[b].sat / 100, p.hsl[b].lum / 100]);
    gl.uniform3fv(u.uHsl, hsl);
    gl.uniform1i(u.uUseHsl, hsl.some((v) => v !== 0) ? 1 : 0);
    this.drawTo(target, this.programs.develop, this.linearTex!);
    let result = target;

    if (withDetail && this.work) {
      const other = () => (result === this.work![0] ? this.work![1] : this.work![0]);
      const d = p.detail;
      if (d.noiseLuma > 0 || d.noiseColor > 0) {
        const next = other();
        gl.useProgram(this.programs.denoise);
        const du = this.uniforms.denoise;
        gl.uniform1i(du.uImage, 0);
        gl.uniform1f(du.uLuma, d.noiseLuma / 100);
        gl.uniform1f(du.uColor, d.noiseColor / 100);
        gl.uniform1f(du.uScale, 1);
        this.drawTo(next, this.programs.denoise, result.tex);
        result = next;
      }
      if (d.sharpen > 0) {
        const next = other();
        gl.useProgram(this.programs.sharpen);
        const su = this.uniforms.sharpen;
        gl.uniform1i(su.uImage, 0);
        gl.uniform1f(su.uAmount, d.sharpen / 100);
        gl.uniform1f(su.uRadius, d.sharpenRadius);
        gl.uniform1f(su.uDetail, d.sharpenDetail / 100);
        this.drawTo(next, this.programs.sharpen, result.tex);
        result = next;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, result.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    return result.tex;
  }

  // ---------------------------------------------------------------- frame

  /** Coalesce redraws into one per animation frame. */
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    const { gl, canvas } = this;
    if (this.image && this.work && this.developDirty) {
      this.finalTex = this.developInto(this.work[0], this.params, true);
      this.developDirty = false;
      this.onDeveloped?.();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const layout = this.layout();
    if (!this.finalTex || !this.before || !this.image || !layout) {
      gl.clearColor(...BACKGROUND, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const { view, split, showBefore } = this.display;
    const { width, height } = this.image;
    const crop = this.params.geometry.crop ?? FULL_CROP;
    const angle = (this.params.geometry.angle * Math.PI) / 180;
    const u = this.uniforms.display;
    gl.useProgram(this.programs.display);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.finalTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.before.tex);
    gl.uniform1i(u.uAfter, 0);
    gl.uniform1i(u.uBefore, 1);
    gl.uniform2f(u.uCanvas, canvas.width, canvas.height);
    gl.uniform2f(u.uImageSize, width, height);
    gl.uniform4f(u.uCrop, crop.x, crop.y, crop.w, crop.h);
    gl.uniform1f(u.uAngle, angle);
    gl.uniform1f(u.uCoverScale, coverScale(angle, width, height));
    gl.uniform1f(u.uPixelScale, pixelScale(layout, view));
    gl.uniform2f(u.uCenter, view.cx, view.cy);
    gl.uniform1f(u.uSplit, split === null ? -1 : split * canvas.width);
    gl.uniform1i(u.uShowBefore, showBefore ? 1 : 0);
    gl.uniform3f(u.uBackground, ...BACKGROUND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Renders `params` (without detail passes) into a JPEG whose long side is at
   * most `maxSide`, e.g. for sending to Claude. The on-screen image is untouched.
   */
  async renderJpeg(params: EditParams, maxSide: number, quality = 0.85): Promise<Blob> {
    const { gl } = this;
    if (!this.image || !this.linearTex) throw new Error('No image loaded');
    const { width, height } = this.image;
    const target = this.createTarget(width, height, true);
    let pixels: ImageData;
    try {
      this.developInto(target, params, false);
      // Read the smallest mip level that is still at least `maxSide`, then scale on a 2D canvas.
      const level = Math.max(0, Math.floor(Math.log2(Math.max(width, height) / maxSide)));
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, level);
      const data = new Uint8ClampedArray(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      pixels = new ImageData(data, w, h);
    } finally {
      this.deleteTarget(target);
      // The LUT textures now hold `params`; make the next frame re-upload the current ones.
      this.developDirty = true;
      this.requestRender();
    }
    const scale = Math.min(1, maxSide / Math.max(pixels.width, pixels.height));
    const src = document.createElement('canvas');
    src.width = pixels.width;
    src.height = pixels.height;
    src.getContext('2d')!.putImageData(pixels, 0, 0);
    const out = document.createElement('canvas');
    out.width = Math.round(pixels.width * scale);
    out.height = Math.round(pixels.height * scale);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
    );
  }

  /** Histogram of the developed image, read from a small mip level. */
  readHistogram(maxSide = 360): Histogram | null {
    const { gl } = this;
    if (!this.finalTex || !this.image) return null;
    const level = Math.max(0, Math.ceil(Math.log2(Math.max(this.image.width, this.image.height) / maxSide)));
    const w = Math.max(1, this.image.width >> level);
    const h = Math.max(1, this.image.height >> level);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.finalTex, level);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    const hist: Histogram = {
      r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), total: w * h,
    };
    for (let i = 0; i < px.length; i += 4) {
      hist.r[px[i]]++;
      hist.g[px[i + 1]]++;
      hist.b[px[i + 2]]++;
      hist.l[Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
    }
    return hist;
  }

  /** Frees GPU resources. The context itself stays usable, since a canvas only ever has one. */
  dispose() {
    cancelAnimationFrame(this.frame);
    this.releaseImage();
    const { gl } = this;
    Object.values(this.programs).forEach((p) => gl.deleteProgram(p));
    gl.deleteTexture(this.toneLut);
    gl.deleteTexture(this.rgbLut);
  }
}
