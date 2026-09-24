import type { LinearImage } from '../raw/rawLoader.ts';
import { compileProgram, uniformLocations } from './glUtils.ts';
import { DISPLAY_FS, FULLSCREEN_VS, UNPACK_FS } from './shaders.ts';

export interface ViewState {
  exposure: number;
}

const BACKGROUND: [number, number, number] = [0.067, 0.071, 0.078];

/**
 * GPU image pipeline. The decoded 16-bit linear image is uploaded once as an
 * integer texture, converted to a mipmapped half-float texture, and every
 * redraw only re-runs the (cheap) display shader.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private unpackProgram: WebGLProgram;
  private displayProgram: WebGLProgram;
  private displayUniforms;
  private linearTex: WebGLTexture | null = null;
  private image: { width: number; height: number } | null = null;
  private view: ViewState = { exposure: 0 };
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not supported by this browser');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('This GPU cannot render to floating-point textures');
    }
    this.gl = gl;
    this.unpackProgram = compileProgram(gl, FULLSCREEN_VS, UNPACK_FS);
    this.displayProgram = compileProgram(gl, FULLSCREEN_VS, DISPLAY_FS);
    this.displayUniforms = uniformLocations(gl, this.displayProgram, [
      'uImage', 'uRect', 'uCanvas', 'uExposure', 'uBackground',
    ] as const);
    gl.bindVertexArray(gl.createVertexArray());
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
  }

  setImage(img: LinearImage) {
    const { gl } = this;
    if (img.width > this.maxTextureSize || img.height > this.maxTextureSize) {
      throw new Error(`Image ${img.width}x${img.height} exceeds GPU texture limit ${this.maxTextureSize}`);
    }

    const rawTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, img.width, img.height, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, img.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    if (this.linearTex) gl.deleteTexture(this.linearTex);
    const linearTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, linearTex);
    const levels = Math.floor(Math.log2(Math.max(img.width, img.height))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, img.width, img.height);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, linearTex, 0);
    gl.viewport(0, 0, img.width, img.height);
    gl.useProgram(this.unpackProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.uniform1i(gl.getUniformLocation(this.unpackProgram, 'uRaw'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(rawTex);

    gl.bindTexture(gl.TEXTURE_2D, linearTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.linearTex = linearTex;
    this.image = { width: img.width, height: img.height };
    this.requestRender();
  }

  clearImage() {
    if (this.linearTex) this.gl.deleteTexture(this.linearTex);
    this.linearTex = null;
    this.image = null;
    this.requestRender();
  }

  setView(view: Partial<ViewState>) {
    this.view = { ...this.view, ...view };
    this.requestRender();
  }

  /** Match the drawing buffer to the element's on-screen size. */
  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestRender();
  }

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
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!this.linearTex || !this.image) {
      gl.clearColor(...BACKGROUND, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const scale = Math.min(canvas.width / this.image.width, canvas.height / this.image.height);
    const w = this.image.width * scale;
    const h = this.image.height * scale;
    const u = this.displayUniforms;
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.linearTex);
    gl.uniform1i(u.uImage, 0);
    gl.uniform4f(u.uRect, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    gl.uniform2f(u.uCanvas, canvas.width, canvas.height);
    gl.uniform1f(u.uExposure, this.view.exposure);
    gl.uniform3f(u.uBackground, ...BACKGROUND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Frees GPU resources. The context itself stays usable, since a canvas only ever has one. */
  dispose() {
    cancelAnimationFrame(this.frame);
    const { gl } = this;
    if (this.linearTex) gl.deleteTexture(this.linearTex);
    gl.deleteProgram(this.unpackProgram);
    gl.deleteProgram(this.displayProgram);
    this.linearTex = null;
    this.image = null;
  }
}
