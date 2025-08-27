/**
 * Color Cycle Brush - GPU-accelerated color cycling with multi-layer support
 * Each gradient change creates a new layer, allowing old strokes to keep their gradients
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
  
  // Multi-layer architecture
  private layers: Array<{
    indexTexture: WebGLTexture;
    paletteTexture: WebGLTexture;
    paintBuffer: Uint8Array;
    gradientStops: Array<{ position: number; color: string }>;
    hasContent: boolean;
  }> = [];
  private currentLayerIndex: number = -1;
  
  // WebGL state
  private program: WebGLProgram | null = null;
  private uniformLocations: {
    indexTexture?: WebGLUniformLocation | null;
    paletteTexture?: WebGLUniformLocation | null;
    cycleOffset?: WebGLUniformLocation | null;
    forceOpacity?: WebGLUniformLocation | null;
  } = {};
  
  // Canvas dimensions
  private width: number;
  private height: number;
  
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
  
  // Frame callback for main canvas updates
  private onFrameRendered?: () => void;

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
    
    // Canvas dimensions
    this.width = canvas.width;
    this.height = canvas.height;
    
    this.init();
    
    // Create first layer with default gradient
    this.addNewLayer(this.defaultGradient());
    
    // Start animation loop
    this.isAnimating = true;
    this.isPaused = false;
  }
  
  // Set callback for frame updates
  setOnFrameRendered(callback: () => void) {
    this.onFrameRendered = callback;
  }
  
  private initWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext {
    const gl = canvas.getContext('webgl', {
      alpha: true,  // Enable alpha for transparency
      preserveDrawingBuffer: true,
      premultipliedAlpha: false  // Use unpremultiplied alpha for correct blending
    }) || canvas.getContext('experimental-webgl', {
      alpha: true,  // Enable alpha for transparency
      preserveDrawingBuffer: true,
      premultipliedAlpha: false  // Use unpremultiplied alpha for correct blending
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
          discard; // More efficient than setting transparent color
        }
        
        float palettePos = mod(index + u_cycleOffset, 1.0);
        vec4 color = texture2D(u_paletteTexture, vec2(palettePos, 0.5));
        
        gl_FragColor = vec4(color.rgb, 1.0);
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
    
    // Start animation loop
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
  
  private addNewLayer(gradientStops: Array<{ position: number; color: string }>) {
    const gl = this.gl;
    
    
    // Create new paint buffer for this layer
    const paintBuffer = new Uint8Array(this.width * this.height * 4);
    paintBuffer.fill(0);
    
    // Create index texture for this layer
    const indexTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, indexTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      this.width, this.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE,
      paintBuffer
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Create palette texture for this layer
    const paletteTexture = gl.createTexture();
    const gradientData = this.generateGradientData(gradientStops);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
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
    
    // Add layer to array
    this.layers.push({
      indexTexture: indexTexture!,
      paletteTexture: paletteTexture!,
      paintBuffer,
      gradientStops,
      hasContent: false
    });
    
    this.currentLayerIndex = this.layers.length - 1;
  }
  
  
  private generateGradientData(gradientStops: Array<{ position: number; color: string }>): Uint8Array {
    const data = new Uint8Array(256 * 4);
    
    for (let i = 0; i < 256; i++) {
      const position = i / 255;
      const color = this.interpolateGradient(position, gradientStops);
      data[i * 4] = color.r;
      data[i * 4 + 1] = color.g;
      data[i * 4 + 2] = color.b;
      data[i * 4 + 3] = 255;
    }
    
    return data;
  }
  
  private interpolateGradient(position: number, gradientStops: Array<{ position: number; color: string }>): { r: number; g: number; b: number } {
    // Find surrounding stops
    let before = gradientStops[0];
    let after = gradientStops[gradientStops.length - 1];
    
    for (let i = 0; i < gradientStops.length - 1; i++) {
      if (position >= gradientStops[i].position && 
          position <= gradientStops[i + 1].position) {
        before = gradientStops[i];
        after = gradientStops[i + 1];
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
  
  // Fill a shape with gradient from edges to center
  fillShape(vertices: Array<{ x: number; y: number }>) {
    if (this.currentLayerIndex < 0) {
      console.warn('[ColorCycleBrush] No layer available for filling shape');
      return;
    }
    
    if (!vertices || vertices.length < 3) {
      console.warn('[ColorCycleBrush] Need at least 3 vertices to fill a shape');
      return;
    }
    
    const currentLayer = this.layers[this.currentLayerIndex];
    
    // Calculate shape bounds
    let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
    vertices.forEach(v => {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    });
    
    // Calculate shape center
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate max distance from center to any vertex (for normalization)
    let maxDistance = 0;
    vertices.forEach(v => {
      const dist = Math.sqrt((v.x - centerX) ** 2 + (v.y - centerY) ** 2);
      maxDistance = Math.max(maxDistance, dist);
    });
    
    // Scan the bounding box and fill pixels inside the polygon
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        
        // Check if point is inside polygon using ray casting
        if (this.isPointInPolygon(x, y, vertices)) {
          // Calculate distance from edge (use distance to nearest edge)
          const edgeDistance = this.distanceToPolygonEdge(x, y, vertices);
          
          // Normalize to 0-1 range (0 = edge, 1 = center)
          const normalizedDistance = Math.min(1.0, edgeDistance / (maxDistance * 0.5));
          
          // Invert so gradient goes from edge (0) to center (1)
          const gradientPosition = 1.0 - normalizedDistance;
          
          // Convert to byte value for texture
          const indexByte = Math.floor(gradientPosition * 255);
          
          // Paint pixel
          const idx = (y * this.width + x) * 4;
          currentLayer.paintBuffer[idx] = indexByte;
          currentLayer.paintBuffer[idx + 1] = 0;
          currentLayer.paintBuffer[idx + 2] = 0;
          currentLayer.paintBuffer[idx + 3] = 255; // Full opacity
        }
      }
    }
    
    // Mark layer as having content and update texture
    currentLayer.hasContent = true;
    this.updateIndexTexture(this.currentLayerIndex);
  }
  
  // Helper: Check if point is inside polygon
  private isPointInPolygon(x: number, y: number, vertices: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    const n = vertices.length;
    
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      
      if (((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
  
  // Helper: Calculate distance from point to polygon edge
  private distanceToPolygonEdge(x: number, y: number, vertices: Array<{ x: number; y: number }>): number {
    let minDistance = Infinity;
    const n = vertices.length;
    
    // Check distance to each edge
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      
      // Calculate distance to line segment
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const lenSq = dx * dx + dy * dy;
      
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((x - v1.x) * dx + (y - v1.y) * dy) / lenSq));
      }
      
      const projX = v1.x + t * dx;
      const projY = v1.y + t * dy;
      const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
      
      minDistance = Math.min(minDistance, dist);
    }
    
    return minDistance;
  }
  
  // Painting methods
  paint(x: number, y: number) {
    if (this.currentLayerIndex < 0 || this.currentLayerIndex >= this.layers.length) {
      console.warn('[ColorCycleBrush] Invalid layer index, reinitializing');
      // Safety: create a default layer if we somehow have no valid layer
      if (this.layers.length === 0) {
        this.addNewLayer(this.defaultGradient());
      } else {
        this.currentLayerIndex = this.layers.length - 1;
      }
    }
    
    const currentLayer = this.layers[this.currentLayerIndex];
    if (!currentLayer) {
      console.error('[ColorCycleBrush] Layer is null, cannot paint');
      return;
    }
    
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
    const gradientCycleLength = 200;
    const indexValue = 1.0 - ((this.strokeLength / gradientCycleLength) % 1.0);
    
    // Paint SQUARE stamp to buffer
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    
    const opacity = 255; // Full opacity always
    const indexByte = Math.floor(indexValue * 255);
    
    // Paint to current layer's buffer
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = (py * this.width + px) * 4;
        currentLayer.paintBuffer[idx] = indexByte;
        currentLayer.paintBuffer[idx + 1] = 0;
        currentLayer.paintBuffer[idx + 2] = 0;
        currentLayer.paintBuffer[idx + 3] = opacity;
      }
    }
    
    // Mark layer as having content
    currentLayer.hasContent = true;
    
    // Update last point
    this.lastPoint = { x, y };
    
    // Update texture
    if (this.isDrawing) {
      this.batchedUpdateIndexTexture(this.currentLayerIndex);
    } else {
      this.updateIndexTexture(this.currentLayerIndex);
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
    
    // Force update current layer's texture
    if (this.currentLayerIndex >= 0) {
      this.updateIndexTexture(this.currentLayerIndex);
    }
  }
  
  private updateIndexTexture(layerIndex: number) {
    if (layerIndex < 0 || layerIndex >= this.layers.length) return;
    
    const layer = this.layers[layerIndex];
    const gl = this.gl;
    
    gl.bindTexture(gl.TEXTURE_2D, layer.indexTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      this.width, this.height,
      gl.RGBA, gl.UNSIGNED_BYTE,
      layer.paintBuffer
    );
  }

  // PERFORMANCE: Batched texture update - reduces WebGL calls during painting
  private batchedUpdateIndexTexture(layerIndex: number) {
    this.needsTextureUpdate = true;
    
    // Clear existing timer
    if (this.updateBatchTimer) {
      clearTimeout(this.updateBatchTimer);
    }
    
    // Batch updates: wait 4ms before actually updating texture
    this.updateBatchTimer = window.setTimeout(() => {
      if (this.needsTextureUpdate) {
        this.updateIndexTexture(layerIndex);
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
    
    // Ensure animation loop is running
    if (!this.animationId) {
      this.isAnimating = true;
      this.animate();
    }
  }
  
  private createDemoContent() {
    if (this.currentLayerIndex < 0) return;
    
    const currentLayer = this.layers[this.currentLayerIndex];
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    const radius = Math.min(this.width, this.height) / 8;
    
    // Create a simple circle pattern with gradient index values
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
          const pixelX = centerX + x;
          const pixelY = centerY + y;
          
          if (pixelX >= 0 && pixelX < this.width && pixelY >= 0 && pixelY < this.height) {
            const idx = (pixelY * this.width + pixelX) * 4;
            
            // Create a radial gradient index value
            const gradientIndex = distance / radius;
            const indexByte = Math.floor(gradientIndex * 255);
            
            currentLayer.paintBuffer[idx] = indexByte;
            currentLayer.paintBuffer[idx + 1] = 0;
            currentLayer.paintBuffer[idx + 2] = 0;
            currentLayer.paintBuffer[idx + 3] = 255; // Full opacity
          }
        }
      }
    }
    
    // Mark layer as having content and update texture
    currentLayer.hasContent = true;
    this.updateIndexTexture(this.currentLayerIndex);
  }
  
  togglePlayPause() {
    if (this.isPaused) {
      this.resumeAnimation();
    } else {
      this.pauseAnimation();
    }
  }
  
  isPlaying(): boolean {
    return this.isAnimating && !this.isPaused;
  }
  
  // Manual update method for external render loops
  updateAnimation() {
    if (!this.isPaused && !this.isDrawing) {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastFrameTime;
      
      if (deltaTime >= this.frameInterval) {
        this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.2;
        this.cycleOffset = this.cycleOffset % 1.0;
        this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
        
        // CRITICAL: Also render when manually updating animation
        this.render();
      }
    }
  }
  
  private animate() {
    if (!this.isAnimating) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    
    // Only log occasionally for debugging
    
    // Limit frame rate
    if (deltaTime >= this.frameInterval) {
      // Update cycle offset when:
      // 1. Drawing (always animates while drawing)
      // 2. OR when not paused (play button is active)
      if (this.isDrawing || !this.isPaused) {
        this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.2;
        this.cycleOffset = this.cycleOffset % 1.0;
      }
      
      // Render when drawing OR when playing (not paused)
      // This ensures animations play even when cursor is not moving
      if (this.isDrawing || !this.isPaused) {
        this.render();
        
        // CRITICAL FIX: Notify main canvas to update when animating (both drawing and playing)
        // This ensures the animation is visible
        if (!this.isPaused && this.onFrameRendered) {
          this.onFrameRendered();
        }
      }
      
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
    }
    
    // CRITICAL: Continue animation loop to keep updating cycle offset
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  render(forceFullOpacity: boolean = false) {
    const gl = this.gl;
    
    if (!this.program) {
      console.warn('ColorCycleBrush: No program available for rendering');
      return;
    }
    
    // Safety check: ensure we have at least one layer
    if (this.layers.length === 0) {
      // Create a default layer if none exists
      this.addNewLayer(this.defaultGradient());
    }
    
    gl.useProgram(this.program);
    
    // Use standard source-over blending to maintain layer order
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Clear canvas
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Set common uniforms
    if (this.uniformLocations.cycleOffset) {
      gl.uniform1f(this.uniformLocations.cycleOffset, this.cycleOffset);
    }
    if (this.uniformLocations.forceOpacity) {
      gl.uniform1f(this.uniformLocations.forceOpacity, forceFullOpacity ? 1.0 : 0.0);
    }
    
    // Debug: Count how many layers we're rendering
    let layersRendered = 0;
    
    // Render each layer
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      
      // Skip empty layers
      if (!layer.hasContent) {
        continue;
      }
      
      // Debug: Check if layer actually has painted pixels
      let hasPixels = false;
      for (let j = 3; j < layer.paintBuffer.length; j += 4) {
        if (layer.paintBuffer[j] > 0) {
          hasPixels = true;
          break;
        }
      }
      
      if (!hasPixels) {
        console.warn(`Layer ${i} marked as hasContent but has no pixels!`);
        continue;
      }
      
      layersRendered++;
      
      // Bind this layer's textures
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, layer.indexTexture);
      if (this.uniformLocations.indexTexture) {
        gl.uniform1i(this.uniformLocations.indexTexture, 0);
      }
      
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, layer.paletteTexture);
      if (this.uniformLocations.paletteTexture) {
        gl.uniform1i(this.uniformLocations.paletteTexture, 1);
      }
      
      // Draw this layer
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    // Force a readback to ensure WebGL flushes
    const pixel = new Uint8Array(4);
    gl.readPixels(this.width / 2, this.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  }
  
  // Helper to check if two gradients are the same
  private gradientsMatch(stops1: Array<{ position: number; color: string }>, 
                         stops2: Array<{ position: number; color: string }>): boolean {
    if (stops1.length !== stops2.length) return false;
    
    for (let i = 0; i < stops1.length; i++) {
      if (stops1[i].position !== stops2[i].position || 
          stops1[i].color !== stops2[i].color) {
        return false;
      }
    }
    
    return true;
  }
  
  // Public API
  setGradient(stops: Array<{ position: number; color: string }>) {
    
    // First, check if we already have a layer with this exact gradient
    for (let i = 0; i < this.layers.length; i++) {
      if (this.gradientsMatch(this.layers[i].gradientStops, stops)) {
        this.currentLayerIndex = i;
        return; // Use existing layer
      }
    }
    
    // No matching layer found, need to create or update
    if (this.currentLayerIndex >= 0) {
      const currentLayer = this.layers[this.currentLayerIndex];
      
      // Only create new layer if current one has content
      if (currentLayer.hasContent) {
        this.addNewLayer(stops);
      } else {
        // Update current empty layer's gradient
        const gl = this.gl;
        const gradientData = this.generateGradientData(stops);
        
        gl.bindTexture(gl.TEXTURE_2D, currentLayer.paletteTexture);
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA,
          256, 1, 0,
          gl.RGBA, gl.UNSIGNED_BYTE,
          gradientData
        );
        
        currentLayer.gradientStops = stops;
      }
    } else {
      // No layers exist, create first one
      this.addNewLayer(stops);
    }
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
    
    // Clear all layers
    for (const layer of this.layers) {
      layer.paintBuffer.fill(0);
      layer.hasContent = false;
      this.updateIndexTextureForLayer(layer);
    }
    
    // Reset stroke tracking
    this.strokeCounter = 0;
    this.strokeLength = 0;
    this.lastPoint = null;
    this.isDrawing = false;
  }
  
  private updateIndexTextureForLayer(layer: any) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, layer.indexTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      this.width, this.height,
      gl.RGBA, gl.UNSIGNED_BYTE,
      layer.paintBuffer
    );
  }
  
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    
    // Recreate all layer buffers and textures with new size
    const gl = this.gl;
    
    for (const layer of this.layers) {
      // Create new buffer
      const newBuffer = new Uint8Array(width * height * 4);
      
      // Copy old data (what fits)
      // This is simplified - you might want more sophisticated resizing
      const copyWidth = Math.min(this.width, width);
      const copyHeight = Math.min(this.height, height);
      
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const oldIdx = (y * this.width + x) * 4;
          const newIdx = (y * width + x) * 4;
          newBuffer[newIdx] = layer.paintBuffer[oldIdx];
          newBuffer[newIdx + 1] = layer.paintBuffer[oldIdx + 1];
          newBuffer[newIdx + 2] = layer.paintBuffer[oldIdx + 2];
          newBuffer[newIdx + 3] = layer.paintBuffer[oldIdx + 3];
        }
      }
      
      layer.paintBuffer = newBuffer;
      
      // Recreate texture with new size
      gl.bindTexture(gl.TEXTURE_2D, layer.indexTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE,
        layer.paintBuffer
      );
    }
  }
  
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  
  hasContent(): boolean {
    return this.layers.some(layer => layer.hasContent);
  }

  destroy() {
    this.stopAnimation();
    
    if (this.updateBatchTimer) {
      clearTimeout(this.updateBatchTimer);
      this.updateBatchTimer = null;
    }
    
    const gl = this.gl;
    
    // Clean up all layers
    for (const layer of this.layers) {
      if (layer.indexTexture) gl.deleteTexture(layer.indexTexture);
      if (layer.paletteTexture) gl.deleteTexture(layer.paletteTexture);
    }
    
    if (this.program) gl.deleteProgram(this.program);
    
    this.layers = [];
  }
}