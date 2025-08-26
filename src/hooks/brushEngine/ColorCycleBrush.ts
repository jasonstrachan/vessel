/**
 * Color Cycle Brush - GPU-accelerated color cycling for web paint application
 * Implements a single cohesive module with WebGL rendering
 */

export class ColorCycleBrush {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  
  // Core settings
  private brushSize: number;
  private cycleSpeed: number;
  private cycleOffset: number;
  private fps: number;
  private frameInterval: number;
  private lastFrameTime: number;
  
  // Gradient
  private gradientStops: Array<{ position: number; color: string }>;
  
  // WebGL state
  private program: WebGLProgram | null = null;
  private indexTexture: WebGLTexture | null = null;
  private paletteTexture: WebGLTexture | null = null;
  private uniformLocations: {
    indexTexture?: WebGLUniformLocation | null;
    paletteTexture?: WebGLUniformLocation | null;
    cycleOffset?: WebGLUniformLocation | null;
    forceOpacity?: WebGLUniformLocation | null;
  } = {};
  
  // Paint buffer - stores index values for each pixel
  private width: number;
  private height: number;
  private paintBuffer: Uint8Array;
  
  // PERFORMANCE: Batch texture updates
  private needsTextureUpdate: boolean = false;
  private updateBatchTimer: number | null = null;
  
  // Animation
  private isAnimating: boolean = false;
  private animationId: number | null = null;
  private isPaused: boolean = false;
  
  // Stroke tracking for gradient flow
  private strokeCounter: number = 0;
  private strokeLength: number = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;

  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
  } = {}) {
    this.canvas = canvas;
    this.gl = this.initWebGL(canvas);
    
    // Core settings
    this.brushSize = options.brushSize || 20;
    this.cycleSpeed = 1.0;
    this.cycleOffset = 0.0;
    this.fps = options.fps || 30;
    this.frameInterval = 1000 / this.fps;
    this.lastFrameTime = 0;
    
    // Default gradient
    this.gradientStops = this.defaultGradient();
    
    // Paint buffer
    this.width = canvas.width;
    this.height = canvas.height;
    this.paintBuffer = new Uint8Array(this.width * this.height * 4);
    this.paintBuffer.fill(0); // Explicitly clear to ensure no painted areas
    
    this.init();
  }
  
  private initWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext {
    const gl = canvas.getContext('webgl', {
      alpha: true,  // Enable alpha for transparency
      preserveDrawingBuffer: true,
      premultipliedAlpha: true  // Changed to true for proper blending
    }) || canvas.getContext('experimental-webgl', {
      alpha: true,  // Enable alpha for transparency
      preserveDrawingBuffer: true,
      premultipliedAlpha: true  // Changed to true for proper blending
    });
    
    if (!gl) {
      throw new Error('WebGL not supported');
    }
    
    return gl as WebGLRenderingContext;
  }
  
  private defaultGradient() {
    return [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
  }
  
  private init() {
    const gl = this.gl;
    
    // Verify buffer is clear
    const hasContent = this.paintBuffer.some(v => v !== 0);
    if (hasContent) {
      console.warn('[ColorCycleBrush] Paint buffer not empty on init!');
    }
    
    // Create shader program
    const vertexShader = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_position * 0.5 + 0.5;
        v_texCoord.y = 1.0 - v_texCoord.y; // Flip Y
      }
    `;
    
    const fragmentShader = `
      precision mediump float;
      
      uniform sampler2D u_indexTexture;
      uniform sampler2D u_paletteTexture;
      uniform float u_cycleOffset;
      uniform float u_forceOpacity;  // 0.0 = use stored alpha, 1.0 = force full opacity
      
      varying vec2 v_texCoord;
      
      void main() {
        vec4 indexColor = texture2D(u_indexTexture, v_texCoord);
        float index = indexColor.r;
        float storedAlpha = indexColor.a;
        
        // Only render where we've painted (alpha > 0)
        if (storedAlpha < 0.01) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);  // Fully transparent
          return;
        }
        
        float palettePos = mod(index + u_cycleOffset, 1.0);
        vec4 color = texture2D(u_paletteTexture, vec2(palettePos, 0.5));
        
        // Always use full opacity since we paint at full opacity
        // The opacity slider is applied at the canvas compositing level
        gl_FragColor = vec4(color.rgb, 1.0);  // Always full opacity
      }
    `;
    
    this.program = this.createProgram(vertexShader, fragmentShader);
    
    // Get uniform locations
    this.uniformLocations = {
      indexTexture: gl.getUniformLocation(this.program, 'u_indexTexture'),
      paletteTexture: gl.getUniformLocation(this.program, 'u_paletteTexture'),
      cycleOffset: gl.getUniformLocation(this.program, 'u_cycleOffset'),
      forceOpacity: gl.getUniformLocation(this.program, 'u_forceOpacity')
    };
    
    // Create geometry (simple quad)
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const positionLocation = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Create textures
    this.createTextures();
    
    // Start animation loop (playing by default)
    this.isAnimating = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    this.animate();
  }
  
  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compile error:', gl.getShaderInfoLog(vertexShader));
      throw new Error('Failed to compile vertex shader');
    }
    
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) throw new Error('Failed to create fragment shader');
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compile error:', gl.getShaderInfoLog(fragmentShader));
      throw new Error('Failed to compile fragment shader');
    }
    
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link failed:', gl.getProgramInfoLog(program));
      throw new Error('Failed to link shader program');
    }
    
    return program;
  }
  
  private createTextures() {
    const gl = this.gl;
    
    // Ensure paint buffer is clear
    this.paintBuffer.fill(0);
    
    // Index texture (stores where each pixel starts in the gradient)
    this.indexTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.indexTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      this.width, this.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      this.paintBuffer
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Palette texture (the gradient colors)
    this.paletteTexture = gl.createTexture();
    this.updatePaletteTexture();
  }
  
  private updatePaletteTexture() {
    const gl = this.gl;
    const gradientData = this.generateGradientData();
    console.log('[ColorCycleBrush] updatePaletteTexture - gradientData sample:', gradientData.slice(0, 16));
    
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      256, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      gradientData
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    console.log('[ColorCycleBrush] updatePaletteTexture - texture updated');
  }
  
  private generateGradientData(): Uint8Array {
    const data = new Uint8Array(256 * 4);
    
    for (let i = 0; i < 256; i++) {
      const position = i / 255;
      const color = this.interpolateGradient(position);
      data[i * 4] = color.r;
      data[i * 4 + 1] = color.g;
      data[i * 4 + 2] = color.b;
      data[i * 4 + 3] = 255;
    }
    
    return data;
  }
  
  private interpolateGradient(position: number): { r: number; g: number; b: number } {
    // Find surrounding stops
    let before = this.gradientStops[0];
    let after = this.gradientStops[this.gradientStops.length - 1];
    
    for (let i = 0; i < this.gradientStops.length - 1; i++) {
      if (position >= this.gradientStops[i].position && 
          position <= this.gradientStops[i + 1].position) {
        before = this.gradientStops[i];
        after = this.gradientStops[i + 1];
        break;
      }
    }
    
    // Interpolate color
    const t = (position - before.position) / (after.position - before.position);
    const beforeRGB = this.hexToRgb(before.color);
    const afterRGB = this.hexToRgb(after.color);
    
    return {
      r: Math.round(beforeRGB.r + (afterRGB.r - beforeRGB.r) * t),
      g: Math.round(beforeRGB.g + (afterRGB.g - beforeRGB.g) * t),
      b: Math.round(beforeRGB.b + (afterRGB.b - beforeRGB.b) * t)
    };
  }
  
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
  
  // Painting methods
  paint(x: number, y: number) {
    const halfSize = Math.floor(this.brushSize / 2);
    
    // Calculate distance traveled for gradient position
    if (this.lastPoint) {
      const dx = x - this.lastPoint.x;
      const dy = y - this.lastPoint.y;
      this.strokeLength += Math.sqrt(dx * dx + dy * dy);
    } else {
      // Start of new stroke
      this.strokeCounter = 0;
      this.strokeLength = 0;
    }
    
    // Use stroke length to determine position in gradient
    // Invert the value so colors flow in the direction of drawing
    // Normalize to 0-1 range, cycling every 200 pixels
    const gradientCycleLength = 200;
    const indexValue = 1.0 - ((this.strokeLength / gradientCycleLength) % 1.0);
    
    // Paint SQUARE stamp to buffer - much faster than circle
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    
    // ALWAYS use full opacity - ignore pressure completely
    const opacity = 255; // Full opacity always
    const indexByte = Math.floor(indexValue * 255);
    
    // Direct pixel manipulation for square - no distance calculations needed
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = (py * this.width + px) * 4;
        
        // Paint all pixels with full opacity
        // Store index value in red channel
        this.paintBuffer[idx] = indexByte;
        this.paintBuffer[idx + 1] = 0;
        this.paintBuffer[idx + 2] = 0;
        this.paintBuffer[idx + 3] = opacity; // Always 255 (full opacity)
      }
    }
    
    // Update last point for next paint call
    this.lastPoint = { x, y };
    
    // PERFORMANCE: Use batched texture updates during active painting
    // Immediate update during finalization, batched during painting
    if (this.isDrawing) {
      this.batchedUpdateIndexTexture();
    } else {
      this.updateIndexTexture();
    }
  }
  
  // Reset stroke tracking (call when starting new stroke)
  startStroke() {
    this.lastPoint = null;
    this.strokeCounter = 0;
    this.strokeLength = 0;
    this.isDrawing = true;
  }
  
  // End stroke (call when lifting pen/mouse)
  endStroke() {
    this.lastPoint = null;
    this.isDrawing = false;
  }
  
  private updateIndexTexture() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.indexTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      this.width, this.height,
      gl.RGBA, gl.UNSIGNED_BYTE,
      this.paintBuffer
    );
  }

  // PERFORMANCE: Batched texture update - reduces WebGL calls during painting
  private batchedUpdateIndexTexture() {
    this.needsTextureUpdate = true;
    
    // Clear existing timer
    if (this.updateBatchTimer) {
      clearTimeout(this.updateBatchTimer);
    }
    
    // Batch updates: wait 4ms before actually updating texture
    this.updateBatchTimer = window.setTimeout(() => {
      if (this.needsTextureUpdate) {
        this.updateIndexTexture();
        this.needsTextureUpdate = false;
      }
      this.updateBatchTimer = null;
    }, 4);
  }
  
  // Animation
  startAnimation() {
    if (this.isAnimating && !this.isPaused) return;
    this.isAnimating = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    if (!this.animationId) {
      this.animate();
    }
  }
  
  stopAnimation() {
    this.isAnimating = false;
    this.isPaused = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  
  pauseAnimation() {
    this.isPaused = true;
  }
  
  resumeAnimation() {
    this.isPaused = false;
    this.lastFrameTime = performance.now();
  }
  
  isPlaying(): boolean {
    return this.isAnimating && !this.isPaused;
  }
  
  private animate() {
    if (!this.isAnimating) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    
    // Limit frame rate
    if (deltaTime >= this.frameInterval) {
      // Update cycle offset when:
      // 1. Drawing (always animates while drawing)
      // 2. OR when not paused (play button is active)
      if (this.isDrawing || !this.isPaused) {
        this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.2;
        this.cycleOffset = this.cycleOffset % 1.0;
      }
      
      // Always render to show current state
      this.render();
      
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
    }
    
    // Continue animation loop even when paused (to keep rendering)
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  render(forceFullOpacity: boolean = false) {
    const gl = this.gl;
    
    if (!this.program) {
      console.warn('ColorCycleBrush: No program available for rendering');
      return;
    }
    
    gl.useProgram(this.program);
    
    // Enable alpha blending with premultiplied alpha
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    
    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.indexTexture);
    if (this.uniformLocations.indexTexture) {
      gl.uniform1i(this.uniformLocations.indexTexture, 0);
    }
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    if (this.uniformLocations.paletteTexture) {
      gl.uniform1i(this.uniformLocations.paletteTexture, 1);
    }
    
    // Set uniforms
    if (this.uniformLocations.cycleOffset) {
      gl.uniform1f(this.uniformLocations.cycleOffset, this.cycleOffset);
    }
    if (this.uniformLocations.forceOpacity) {
      gl.uniform1f(this.uniformLocations.forceOpacity, forceFullOpacity ? 1.0 : 0.0);
    }
    
    // Clear to transparent and draw
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);  // Clear to transparent
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    // Check for WebGL errors
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.warn(`ColorCycleBrush WebGL error: ${error}`);
    }
  }
  
  // Public API
  setGradient(stops: Array<{ position: number; color: string }>) {
    console.log('[ColorCycleBrush] setGradient called with stops:', stops);
    console.log('[ColorCycleBrush] Current gradient stops before update:', this.gradientStops);
    this.gradientStops = stops;
    this.updatePaletteTexture();
    console.log('[ColorCycleBrush] Gradient stops updated to:', this.gradientStops);
    console.log('[ColorCycleBrush] Palette texture updated - affects all strokes (color cycle behavior)');
  }
  
  setBrushSize(size: number) {
    this.brushSize = size;
  }
  
  setSpeed(speed: number) {
    this.cycleSpeed = speed;
  }
  
  setFPS(fps: number) {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
  }
  
  clear() {
    this.paintBuffer.fill(0);
    this.updateIndexTexture();
    // Reset stroke tracking
    this.strokeCounter = 0;
    this.strokeLength = 0;
    this.lastPoint = null;
    this.isDrawing = false;
  }
  
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.paintBuffer = new Uint8Array(width * height * 4);
    this.createTextures();
  }
  
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  
  // PERFORMANCE: Check if brush has any painted content
  hasContent(): boolean {
    // Quick check: if we've never drawn anything, buffer should be mostly empty
    // Check a few key bytes instead of scanning entire buffer
    for (let i = 3; i < this.paintBuffer.length; i += 4) { // Check alpha channel every 4 bytes
      if (this.paintBuffer[i] > 0) return true;
    }
    return false;
  }

  destroy() {
    this.stopAnimation();
    
    // Clean up batch timer
    if (this.updateBatchTimer) {
      clearTimeout(this.updateBatchTimer);
      this.updateBatchTimer = null;
    }
    
    const gl = this.gl;
    
    // Clean up WebGL resources
    if (this.indexTexture) gl.deleteTexture(this.indexTexture);
    if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
    if (this.program) gl.deleteProgram(this.program);
  }
}