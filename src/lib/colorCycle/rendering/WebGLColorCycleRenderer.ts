/**
 * WebGLColorCycleRenderer
 *
 * GPU renderer that maps an 8-bit index texture to RGBA via a 1D palette
 * texture, with animation achieved by a uniform palette offset (cyclic).
 *
 * Goals
 * - Eliminate main-thread O(pixels) mapping and putImageData per frame
 * - Upload index buffer as an 8-bit texture (RED/LUMINANCE)
 * - Upload palette as a 256x1 RGBA texture (NEAREST sampling)
 * - Animate by shifting the sampling offset (uniform), not re-uploading
 *
 * Notes
 * - Supports WebGL2 (preferred) and falls back to WebGL1
 * - Index value 0 is treated as transparent (alpha = 0)
 */

// Debug logs suppressed for GPU renderer

export interface GLRendererConfig {
  width: number;
  height: number;
  canvas?: HTMLCanvasElement; // optional external canvas; will acquire WebGL context on it
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

type LoseContextExtension = {
  loseContext?: () => void;
};

type FillMode = 0 | 1; // 0 = concentric, 1 = linear

interface FillRequest {
  vertices: Float32Array;
  bands: number;
  baseOffset: number;
  colorStep: number;
  maxDist: number;
  bbox: { minX: number; minY: number; width: number; height: number };
  canvasHeight: number;
  mode?: FillMode;
  direction?: { x: number; y: number };
  directionOrigin?: { x: number; y: number };
  directionRange?: { min: number; range: number };
  ditherStrength?: number;
  ditherPixelSize?: number;
  noiseSeed?: number;
}

export class WebGLColorCycleRenderer {
  private static readonly MAX_CONTEXTS = 8;
  private static activeContexts = 0;

  private canvas: HTMLCanvasElement;
  private gl: GL;
  private isWebGL2: boolean;
  private hasContextSlot = false;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null = null;
  private vbo: WebGLBuffer | null = null;

  private uIndexTexLoc: WebGLUniformLocation | null = null;
  private uPaletteTexLoc: WebGLUniformLocation | null = null;
  private uPaletteSizeLoc: WebGLUniformLocation | null = null;
  private uOffsetLoc: WebGLUniformLocation | null = null;

  private indexTex: WebGLTexture | null = null;
  private paletteTex: WebGLTexture | null = null;
  private width: number;
  private height: number;
  private indexTexAllocated: boolean = false;

  private paletteSize: number = 256;
  private paletteUploaded: boolean = false;

  // Offscreen resources for compute-style polygon fills
  private fillProgram: WebGLProgram | null = null;
  private fillFbo: WebGLFramebuffer | null = null;
  private fillTex: WebGLTexture | null = null;
  private static readonly MAX_VERTS = 256; // hard cap
  private fillMaxVerts: number = 128; // runtime-adaptive max based on uniform limits

  private static _supportCached: boolean | null = null;

  /**
   * Detect WebGL support once and cache the result.
   * Uses WEBGL_lose_context to immediately release any probe context to avoid
   * exceeding browser limits for simultaneous WebGL contexts.
   */
  static isSupported(): boolean {
    if (this._supportCached !== null) return this._supportCached;
    if (typeof window === 'undefined') {
      this._supportCached = false;
      return false;
    }
    try {
      const canvas = document.createElement('canvas');
      // Prefer WebGL2
      const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      if (gl2) {
        try {
          const loseContext = gl2.getExtension('WEBGL_lose_context') as LoseContextExtension | null;
          loseContext?.loseContext?.();
        } catch {}
        this._supportCached = true;
        return true;
      }
      const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (gl) {
        try {
          const loseContext = gl.getExtension('WEBGL_lose_context') as LoseContextExtension | null;
          loseContext?.loseContext?.();
        } catch {}
        this._supportCached = true;
        return true;
      }
      this._supportCached = false;
      return false;
    } catch {
      this._supportCached = false;
      return false;
    }
  }

  constructor(config: GLRendererConfig) {
    if (typeof window === 'undefined') {
      throw new Error('WebGLColorCycleRenderer requires a browser environment');
    }

    if (!WebGLColorCycleRenderer.reserveContextSlot()) {
      throw new Error('WEBGL_CONTEXT_BUDGET_EXCEEDED');
    }
    this.hasContextSlot = true;

    this.width = Math.max(1, Math.floor(config.width));
    this.height = Math.max(1, Math.floor(config.height));

    this.canvas = config.canvas || document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    try {
      // Prefer WebGL2, fallback to WebGL1
      const gl2 = this.canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true }) as WebGL2RenderingContext | null;
      if (gl2) {
        this.gl = gl2;
        this.isWebGL2 = true;
      } else {
        const gl = (this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true }) ||
                    this.canvas.getContext('experimental-webgl', { premultipliedAlpha: false, alpha: true })) as WebGLRenderingContext | null;
        if (!gl) {
          throw new Error('Failed to create WebGL context');
        }
        this.gl = gl;
        this.isWebGL2 = false;
      }

      this.program = this.createProgram();
      this.setupGeometry();
      this.setupUniformsAndSamplers();
      this.createTextures();
    } catch (error) {
      WebGLColorCycleRenderer.releaseContextSlot();
      this.hasContextSlot = false;
      throw error;
    }

    // Determine safe vertex limit for fragment uniform array
    try {
      // Prefer querying in vec4 units
      let maxVec4 = 64;
      const gl = this.gl;
      if ('MAX_FRAGMENT_UNIFORM_VECTORS' in gl) {
        const uniformVecEnum = (gl as WebGLRenderingContext).MAX_FRAGMENT_UNIFORM_VECTORS;
        const reported = gl.getParameter(uniformVecEnum);
        if (typeof reported === 'number') {
          maxVec4 = reported;
        }
      }

      if (this.isWebGL2) {
        const gl2 = gl as WebGL2RenderingContext;
        const componentsEnum = gl2.MAX_FRAGMENT_UNIFORM_COMPONENTS;
        const components = gl2.getParameter(componentsEnum);
        if (typeof components === 'number') {
          maxVec4 = Math.floor(components / 4);
        }
      }
      // Reserve some headroom for other uniforms; each vec2 consumes 1 vec4 slot on many drivers
      const reserve = 24;
      const allowed = Math.max(8, maxVec4 - reserve);
      this.fillMaxVerts = Math.min(WebGLColorCycleRenderer.MAX_VERTS, allowed);
      } catch {}
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    // Reallocate index texture storage on next setIndexData() call
    // Palette texture remains 256x1
    this.indexTexAllocated = false;
  }

  setPaletteColors(paletteRGBA: Uint8Array | Uint8ClampedArray) {
    // Expect length == 256 * 4
    const gl = this.gl;
    gl.useProgram(this.program);
    if (!this.paletteTex) this.createTextures();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    // Ensure alignment for tightly-packed RGBA bytes
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Upload as 256x1 RGBA texture
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, this.paletteSize, 1, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, paletteRGBA);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.paletteSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteRGBA as Uint8Array);
    }

    this.paletteUploaded = true;
  }

  setIndexData(indexData: Uint8Array) {
    const gl = this.gl;
    gl.useProgram(this.program);
    if (!this.indexTex) this.createTextures();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.indexTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Define or update the index texture. Use a single channel if available.
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      if (!this.indexTexAllocated) {
        // Allocate storage once, then sub-image updates
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, this.width, this.height, 0, gl2.RED, gl2.UNSIGNED_BYTE, null);
        this.indexTexAllocated = true;
      }
      gl2.texSubImage2D(gl2.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl2.RED, gl2.UNSIGNED_BYTE, indexData);
    } else {
      // WebGL1 fallback: use LUMINANCE as 8-bit channel
      if (!this.indexTexAllocated) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
        this.indexTexAllocated = true;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.LUMINANCE, gl.UNSIGNED_BYTE, indexData);
    }
  }

  render(offset: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);

    // Set uniforms
    if (this.uOffsetLoc) gl.uniform1f(this.uOffsetLoc, offset);
    if (this.uPaletteSizeLoc) gl.uniform1f(this.uPaletteSizeLoc, this.paletteSize);

    // Bind textures to texture units 0 (index) and 1 (palette)
    if (this.uIndexTexLoc) gl.uniform1i(this.uIndexTexLoc, 0);
    if (this.uPaletteTexLoc) gl.uniform1i(this.uPaletteTexLoc, 1);

    // Draw full-screen quad
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      if (this.vao) gl2.bindVertexArray(this.vao as WebGLVertexArrayObject);
      gl2.drawArrays(gl2.TRIANGLES, 0, 6);
      if (this.vao) gl2.bindVertexArray(null);
    } else {
      // WebGL1 path: no VAO; attributes already enabled
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose() {
    const gl = this.gl;

    if (this.indexTex) { gl.deleteTexture(this.indexTex); this.indexTex = null; }
    if (this.paletteTex) { gl.deleteTexture(this.paletteTex); this.paletteTex = null; }
    if (this.fillTex) { gl.deleteTexture(this.fillTex); this.fillTex = null; }
    if (this.fillFbo) { gl.deleteFramebuffer(this.fillFbo); this.fillFbo = null; }
    if (this.vbo) { gl.deleteBuffer(this.vbo); this.vbo = null; }
    if (this.isWebGL2 && this.vao) {
      (this.gl as WebGL2RenderingContext).deleteVertexArray(this.vao as WebGLVertexArrayObject);
      this.vao = null;
    }

    if (this.program) {
      gl.deleteProgram(this.program);
    }
    if (this.fillProgram) {
      gl.deleteProgram(this.fillProgram);
      this.fillProgram = null;
    }

    const loseContext = gl.getExtension('WEBGL_lose_context') as LoseContextExtension | null;
    loseContext?.loseContext?.();

    // Hint to the browser that this canvas is no longer in use
    this.canvas.width = 0;
    this.canvas.height = 0;

    if (this.hasContextSlot) {
      WebGLColorCycleRenderer.releaseContextSlot();
      this.hasContextSlot = false;
    }
  }

  private static reserveContextSlot(): boolean {
    if (this.activeContexts >= this.MAX_CONTEXTS) {
      return false;
    }
    this.activeContexts += 1;
    return true;
  }

  private static releaseContextSlot(): void {
    if (this.activeContexts > 0) {
      this.activeContexts -= 1;
    }
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const vertSrc = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_uv;
      void main() {
        v_uv = a_texCoord;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Note: Using float arithmetic for compatibility with WebGL1
    const fragSrc = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_indexTex;
      uniform sampler2D u_paletteTex;
      uniform float u_paletteSize; // 256
      uniform float u_offset;       // cycles in [0,1)

      void main() {
        // Flip Y to match Canvas/ImageData top-left origin
        vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
        // Index texture is single channel (0..1). Convert to 0..255 with rounding.
        float idxN = texture2D(u_indexTex, uv).r;
        float fIdx = floor(idxN * 255.0 + 0.5);

        // Index 0 = transparent
        if (fIdx < 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }

        // Convert to palette index in [0, paletteSize)
        float base = (fIdx - 1.0);
        // Apply cyclic offset in palette space
        float shift = u_offset * u_paletteSize;
        float pIdx = mod(base + shift + u_paletteSize * 4.0, u_paletteSize);
        // Sample palette with NEAREST by addressing the center of the texel
        float u = (floor(pIdx) + 0.5) / u_paletteSize;
        vec4 color = texture2D(u_paletteTex, vec2(u, 0.5));
        gl_FragColor = color;
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(vs);
      gl.deleteShader(vs);
      throw new Error('Vertex shader compile failed: ' + info);
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('Fragment shader compile failed: ' + info);
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_texCoord');
    gl.linkProgram(program);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program link failed: ' + info);
    }

    return program;
  }

  /**
   * Create program for concentric polygon fill with band quantization.
   * Writes the banded index into the red channel of an offscreen RGBA8 target.
   */
  private createFillProgram(): WebGLProgram {
    const gl = this.gl;
    const MAX = this.fillMaxVerts;
    const vertSrc = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_uv;
      void main() {
        v_uv = a_texCoord;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fragSrc = `
      precision mediump float;
      varying vec2 v_uv;
      uniform float u_minX;
      uniform float u_minY;
      uniform float u_bboxW;
      uniform float u_bboxH;
      uniform float u_canvasH;

      uniform int u_count;
      uniform vec2 u_verts[${MAX}];

      uniform float u_bands;
      uniform float u_bandStep;
      uniform float u_baseOffset;
      uniform float u_colorStep;
      uniform float u_maxDist;
      uniform float u_mode; // 0 = concentric, 1 = linear
      uniform vec2 u_dirVector;
      uniform vec2 u_dirOrigin;
      uniform float u_dirMinProj;
      uniform float u_dirRange;
      uniform float u_ditherStrength;
      uniform float u_ditherPixelSize;
      uniform float u_noiseSeed;

      float hash(vec2 p, float seed) {
        float h = dot(p, vec2(12.9898, 78.233)) + seed * 43758.5453123;
        return fract(sin(h) * 43758.5453123);
      }

      float sampleNoise(vec2 coord) {
        float cell = max(u_ditherPixelSize, 1.0);
        vec2 cellCoord = floor(coord / cell);
        return hash(cellCoord, u_noiseSeed);
      }

      // Compute min distance to polygon edges and inside/outside via crossing parity
      void main() {
        // Map fragment to top-left pixel coordinates in canvas space
        float x = u_minX + v_uv.x * u_bboxW;
        float yGL = v_uv.y * u_bboxH;             // 0..bboxH bottom->top
        float y = u_minY + (u_bboxH - 1.0 - yGL); // convert to top-left origin

        // Crossing parity inside test and min distance to segments
        float minDistSq = 1.0e20;
        bool inside = false;
        for (int i = 0; i < ${MAX}; i++) {
          if (i >= u_count) break;
          int j = (i + 1) >= u_count ? 0 : (i + 1);
          vec2 a = u_verts[i];
          vec2 b = u_verts[j];

          // Crossing test (top-left coords)
          bool cond = ((a.y > y) != (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
          if (cond) inside = !inside;

          // Distance to segment squared (for concentric mode)
          vec2 pa = vec2(x, y) - a;
          vec2 ba = b - a;
          float denomSeg = max(dot(ba, ba), 1e-6);
          float h = clamp(dot(pa, ba) / denomSeg, 0.0, 1.0);
          vec2 proj = a + h * ba;
          vec2 d = vec2(x, y) - proj;
          float dsq = dot(d, d);
          if (dsq < minDistSq) minDistSq = dsq;
        }

        if (!inside) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        float padding = clamp(1.0 / max(u_bands * 4.0, 8.0), 0.001, 0.02);
        float normalized = 0.0;
        if (u_mode < 0.5) {
          float maxDist = max(u_maxDist, 1.0);
          float dist = sqrt(minDistSq);
          normalized = clamp(dist / maxDist, padding, 1.0 - padding);
        } else {
          vec2 rel = vec2(x, y) - u_dirOrigin;
          float safeRange = max(abs(u_dirRange), 1e-6);
          vec2 dir = normalize(u_dirVector);
          float proj = dot(rel, dir);
          normalized = clamp((proj - u_dirMinProj) / safeRange, 0.0, 1.0);
          normalized = clamp(normalized, padding, 1.0 - padding);
        }

        float denom = max(1.0, u_bands - 1.0);
        float bandCoord = normalized * denom;

        if (u_ditherStrength > 0.0) {
          float noise = sampleNoise(vec2(x, y));
          bandCoord += (noise - 0.5) * u_ditherStrength;
        }

        float bandF = clamp(floor(bandCoord + 0.5), 0.0, denom);
        float colorIndex = mod(u_baseOffset + bandF * u_colorStep, 255.0) + 1.0;
        // Output index in red channel (normalized)
        gl_FragColor = vec4(colorIndex / 255.0, 0.0, 0.0, 1.0);
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(vs);
      gl.deleteShader(vs);
      throw new Error('Fill vertex shader compile failed: ' + info);
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('Fill fragment shader compile failed: ' + info);
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_texCoord');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Fill program link failed: ' + info);
    }
    return program;
  }

  getFillMaxVerts(): number { return this.fillMaxVerts; }

  private ensureFillResources(width: number, height: number) {
    const gl = this.gl;
    if (!this.fillProgram) {
      this.fillProgram = this.createFillProgram();
    }
    // Create/resize fill target
    if (!this.fillTex) {
      this.fillTex = gl.createTexture();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.fillTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, width, height, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    if (!this.fillFbo) {
      this.fillFbo = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fillFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fillTex, 0);
    // No need for depth/stencil
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn('[WebGLColorCycleRenderer] Fill FBO incomplete:', status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * GPU concentric polygon fill. Returns an 8-bit index buffer for bbox (R channel).
   */
  fillPolygonConcentric(params: FillRequest): Uint8Array | null {
    const gl = this.gl;
    const maxVerts = this.fillMaxVerts;
    const count = Math.min((params.vertices.length / 2) | 0, maxVerts);
    if (count < 3) return null;

    const bw = Math.max(1, Math.floor(params.bbox.width));
    const bh = Math.max(1, Math.floor(params.bbox.height));
    this.ensureFillResources(bw, bh);

    // Set up drawing to FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fillFbo);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.fillProgram!);

    // Attributes (reuse VBO already bound in setupGeometry if needed)
    // Bind VBO and enable attribs for pos/uv
    // Rebuild the same quad as main program expects
    // Assumes setupGeometry was called and VBO is still valid
    const posLoc = 0;
    const uvLoc = 1;
    if (this.vbo) gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    // Uniforms
    const loc_minX = gl.getUniformLocation(this.fillProgram!, 'u_minX');
    const loc_minY = gl.getUniformLocation(this.fillProgram!, 'u_minY');
    const loc_bboxW = gl.getUniformLocation(this.fillProgram!, 'u_bboxW');
    const loc_bboxH = gl.getUniformLocation(this.fillProgram!, 'u_bboxH');
    const loc_canvasH = gl.getUniformLocation(this.fillProgram!, 'u_canvasH');
    const loc_count = gl.getUniformLocation(this.fillProgram!, 'u_count');
    const loc_verts = gl.getUniformLocation(this.fillProgram!, 'u_verts[0]');
    const loc_bands = gl.getUniformLocation(this.fillProgram!, 'u_bands');
    const loc_bandStep = gl.getUniformLocation(this.fillProgram!, 'u_bandStep');
    const loc_baseOffset = gl.getUniformLocation(this.fillProgram!, 'u_baseOffset');
    const loc_colorStep = gl.getUniformLocation(this.fillProgram!, 'u_colorStep');
    const loc_maxDist = gl.getUniformLocation(this.fillProgram!, 'u_maxDist');
    const loc_mode = gl.getUniformLocation(this.fillProgram!, 'u_mode');
    const loc_dirVector = gl.getUniformLocation(this.fillProgram!, 'u_dirVector');
    const loc_dirOrigin = gl.getUniformLocation(this.fillProgram!, 'u_dirOrigin');
    const loc_dirMinProj = gl.getUniformLocation(this.fillProgram!, 'u_dirMinProj');
    const loc_dirRange = gl.getUniformLocation(this.fillProgram!, 'u_dirRange');
    const loc_ditherStrength = gl.getUniformLocation(this.fillProgram!, 'u_ditherStrength');
    const loc_ditherPixel = gl.getUniformLocation(this.fillProgram!, 'u_ditherPixelSize');
    const loc_noiseSeed = gl.getUniformLocation(this.fillProgram!, 'u_noiseSeed');

    if (loc_minX) gl.uniform1f(loc_minX, params.bbox.minX);
    if (loc_minY) gl.uniform1f(loc_minY, params.bbox.minY);
    if (loc_bboxW) gl.uniform1f(loc_bboxW, bw);
    if (loc_bboxH) gl.uniform1f(loc_bboxH, bh);
    if (loc_canvasH) gl.uniform1f(loc_canvasH, params.canvasHeight);
    if (loc_count) gl.uniform1i(loc_count, count);
    if (loc_verts) gl.uniform2fv(loc_verts, params.vertices.subarray(0, count * 2));
    if (loc_bands) gl.uniform1f(loc_bands, params.bands);
    if (loc_bandStep) gl.uniform1f(loc_bandStep, 1.0 / Math.max(2, params.bands));
    if (loc_baseOffset) gl.uniform1f(loc_baseOffset, params.baseOffset);
    if (loc_colorStep) gl.uniform1f(loc_colorStep, params.colorStep);
    if (loc_maxDist) gl.uniform1f(loc_maxDist, params.maxDist);
    if (loc_mode) gl.uniform1f(loc_mode, params.mode ?? 0);
    const dirVec = params.direction ?? { x: 1, y: 0 };
    if (loc_dirVector) gl.uniform2f(loc_dirVector, dirVec.x, dirVec.y);
    const dirOrigin = params.directionOrigin ?? { x: params.bbox.minX + bw * 0.5, y: params.bbox.minY + bh * 0.5 };
    if (loc_dirOrigin) gl.uniform2f(loc_dirOrigin, dirOrigin.x, dirOrigin.y);
    const dirRange = params.directionRange ?? { min: 0, range: 1 };
    if (loc_dirMinProj) gl.uniform1f(loc_dirMinProj, dirRange.min);
    if (loc_dirRange) gl.uniform1f(loc_dirRange, dirRange.range);
    if (loc_ditherStrength) gl.uniform1f(loc_ditherStrength, params.ditherStrength ?? 0);
    if (loc_ditherPixel) gl.uniform1f(loc_ditherPixel, Math.max(1, params.ditherPixelSize ?? 1));
    if (loc_noiseSeed) gl.uniform1f(loc_noiseSeed, params.noiseSeed ?? 0);

    // Clear to 0 index
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw full quad
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Read back RGBA and extract R channel
    const pixels = new Uint8Array(bw * bh * 4);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const out = new Uint8Array(bw * bh);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      const r = pixels[j];
      out[i] = r;
    }
    // quiet

    // Unbind FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  private setupGeometry() {
    const gl = this.gl;
    gl.useProgram(this.program);

    // Full-screen quad (two triangles) with UVs
    // position.xy, texcoord.xy
    const data = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
      -1,  1,  0, 1,
       1, -1,  1, 0,
       1,  1,  1, 1,
    ]);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const posLoc = 0; // bound above
    const uvLoc = 1;  // bound above

    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this.vao = gl2.createVertexArray();
      gl2.bindVertexArray(this.vao as WebGLVertexArrayObject);

      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

      gl2.bindVertexArray(null);
    } else {
      // WebGL1: no VAO extension used; enable attributes directly
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
    }
  }

  private setupUniformsAndSamplers() {
    const gl = this.gl;
    gl.useProgram(this.program);
    this.uIndexTexLoc = gl.getUniformLocation(this.program, 'u_indexTex');
    this.uPaletteTexLoc = gl.getUniformLocation(this.program, 'u_paletteTex');
    this.uPaletteSizeLoc = gl.getUniformLocation(this.program, 'u_paletteSize');
    this.uOffsetLoc = gl.getUniformLocation(this.program, 'u_offset');
  }

  private createTextures() {
    const gl = this.gl;
    gl.useProgram(this.program);

    // Index texture (8-bit single channel)
    this.indexTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.indexTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Palette texture (256x1 RGBA, NEAREST)
    this.paletteTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}
