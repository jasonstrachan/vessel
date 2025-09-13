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

export interface GLRendererConfig {
  width: number;
  height: number;
  canvas?: HTMLCanvasElement; // optional external canvas; will acquire WebGL context on it
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

export class WebGLColorCycleRenderer {
  private canvas: HTMLCanvasElement;
  private gl: GL;
  private isWebGL2: boolean;

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

  private paletteSize: number = 256;
  private paletteUploaded: boolean = false;

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) return true;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  }

  constructor(config: GLRendererConfig) {
    if (typeof window === 'undefined') {
      throw new Error('WebGLColorCycleRenderer requires a browser environment');
    }

    this.width = Math.max(1, Math.floor(config.width));
    this.height = Math.max(1, Math.floor(config.height));

    this.canvas = config.canvas || document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;

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
      // Allocate or re-allocate storage
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.R8, this.width, this.height, 0, gl2.RED, gl2.UNSIGNED_BYTE, indexData);
    } else {
      // WebGL1 fallback: use LUMINANCE as 8-bit channel
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.width, this.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, indexData);
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
    if (this.vbo) { gl.deleteBuffer(this.vbo); this.vbo = null; }
    if (this.isWebGL2 && this.vao) {
      (this.gl as WebGL2RenderingContext).deleteVertexArray(this.vao as WebGLVertexArrayObject);
      this.vao = null;
    }
    if (this.program) gl.deleteProgram(this.program);
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
