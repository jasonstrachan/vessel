/**
 * Color Cycle Brush - GPU-accelerated color cycling with multi-layer support
 * Each gradient change creates a new layer, allowing old strokes to keep their gradients
 */

import { colorCycleStorage, DeltaCompressor } from '../../utils/colorCycleStorage';

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
  
  // Multi-layer architecture with layer ID tracking
  private layers: Array<{
    layerId?: string; // ID of the app layer this WebGL layer corresponds to
    indexTexture: WebGLTexture;
    paletteTexture: WebGLTexture;
    paintBuffer: Uint8Array;
    gradientStops: Array<{ position: number; color: string }>;
    hasContent: boolean;
  }> = [];
  private currentLayerIndex: number = -1;
  
  // Layer ID mapping for quick lookups
  private layerIdToIndex: Map<string, number> = new Map();
  
  // Layer-specific stroke tracking
  private layerStrokes: Map<string, {
    paintBuffer: Uint8Array;
    hasContent: boolean;
    strokeCounter: number;
    strokeLength: number;
    lastPoint: { x: number; y: number } | null;
    gradientLayerIndices: number[]; // Track which gradient layers are used by this canvas layer
    currentGradientIndex: number; // Current gradient layer being painted to
  }> = new Map();
  
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
    console.log('⚡ [ColorCycle] Creating WebGL implementation - ORIGINAL');
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
    
    // Initialize animation state but don't start internal loop
    this.isAnimating = false;
    this.isPaused = true;
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
    
    // Don't start internal animation loop - will be driven externally
    this.lastFrameTime = performance.now();
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
  
  private addNewLayer(gradientStops: Array<{ position: number; color: string }>, layerId?: string) {
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
    
    // Add layer to array with optional layer ID
    const newLayerIndex = this.layers.length;
    this.layers.push({
      layerId,
      indexTexture: indexTexture!,
      paletteTexture: paletteTexture!,
      paintBuffer,
      gradientStops,
      hasContent: false
    });
    
    // Update layer ID mapping if provided
    if (layerId) {
      this.layerIdToIndex.set(layerId, newLayerIndex);
    }
    
    this.currentLayerIndex = newLayerIndex;
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
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string) {
    // If layer ID provided, ensure we're working with correct layer
    if (layerId) {
      this.setActiveLayer(layerId);
      
      // Initialize layer-specific stroke data if needed
      if (!this.layerStrokes.has(layerId)) {
        const currentGradient = this.currentLayerIndex >= 0 
          ? this.layers[this.currentLayerIndex].gradientStops 
          : this.defaultGradient();
        
        this.addNewLayer(currentGradient, `${layerId}_gradient_0`);
        const newGradientIndex = this.layers.length - 1;
        
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(this.width * this.height * 4),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [newGradientIndex],
          currentGradientIndex: newGradientIndex
        });
        
        this.currentLayerIndex = newGradientIndex;
      }
    }
    
    if (this.currentLayerIndex < 0) {
      console.warn('[ColorCycleBrush] No layer available for filling shape');
      return;
    }
    
    if (!vertices || vertices.length < 3) {
      console.warn('[ColorCycleBrush] Need at least 3 vertices to fill a shape');
      return;
    }
    
    const currentLayer = this.layers[this.currentLayerIndex];
    
    // Get the appropriate paint buffer (layer-specific or general)
    const targetBuffer = layerId && this.layerStrokes.has(layerId) 
      ? this.layerStrokes.get(layerId)!.paintBuffer
      : currentLayer.paintBuffer;
    
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
          
          // Paint pixel to appropriate buffer
          const idx = (y * this.width + x) * 4;
          targetBuffer[idx] = indexByte;
          targetBuffer[idx + 1] = 0;
          targetBuffer[idx + 2] = 0;
          targetBuffer[idx + 3] = 255; // Full opacity
        }
      }
    }
    
    // Update state based on whether we're using layer-specific tracking
    if (layerId && this.layerStrokes.has(layerId)) {
      const strokeData = this.layerStrokes.get(layerId)!;
      strokeData.hasContent = true;
      currentLayer.hasContent = true;
      
      // CRITICAL: Copy layer-specific buffer to the WebGL layer's paint buffer
      currentLayer.paintBuffer = new Uint8Array(targetBuffer);
      
      // Force immediate texture update
      this.updateIndexTexture(this.currentLayerIndex);
    } else {
      // Mark layer as having content and update texture
      currentLayer.hasContent = true;
      currentLayer.paintBuffer = targetBuffer;
      this.updateIndexTexture(this.currentLayerIndex);
    }
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
  
  // Get or create a layer for the given app layer ID
  private getOrCreateLayerForId(layerId: string): number {
    // Check if we already have a layer for this ID
    if (this.layerIdToIndex.has(layerId)) {
      return this.layerIdToIndex.get(layerId)!;
    }
    
    // Create a new layer for this ID with current gradient settings
    const currentGradient = this.currentLayerIndex >= 0 
      ? this.layers[this.currentLayerIndex].gradientStops 
      : this.defaultGradient();
    
    this.addNewLayer(currentGradient, layerId);
    return this.currentLayerIndex;
  }
  
  // Set the active layer by app layer ID
  setActiveLayer(layerId: string) {
    this.currentLayerIndex = this.getOrCreateLayerForId(layerId);
  }
  
  // Painting methods with optional layer ID support
  paint(x: number, y: number, layerId?: string) {
    // If layer ID provided, ensure we're painting to the correct layer
    if (layerId) {
      // Get or create layer-specific stroke data
      if (!this.layerStrokes.has(layerId)) {
        // Create a new gradient layer for this canvas layer
        const currentGradient = this.currentLayerIndex >= 0 
          ? this.layers[this.currentLayerIndex].gradientStops 
          : this.defaultGradient();
        
        this.addNewLayer(currentGradient, `${layerId}_gradient_0`);
        const newGradientIndex = this.layers.length - 1;
        
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(this.width * this.height * 4),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [newGradientIndex],
          currentGradientIndex: newGradientIndex
        });
        
        this.currentLayerIndex = newGradientIndex;
      } else {
        // Use existing gradient layer for this canvas layer
        const strokeData = this.layerStrokes.get(layerId)!;
        this.currentLayerIndex = strokeData.currentGradientIndex;
      }
    }
    
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
    
    // Get layer-specific stroke data
    const strokeData = layerId ? this.layerStrokes.get(layerId)! : {
      paintBuffer: currentLayer.paintBuffer,
      hasContent: currentLayer.hasContent,
      strokeCounter: this.strokeCounter,
      strokeLength: this.strokeLength,
      lastPoint: this.lastPoint,
      gradientLayerIndices: [this.currentLayerIndex],
      currentGradientIndex: this.currentLayerIndex
    };
    
    const halfSize = Math.floor(this.brushSize / 2);
    
    // Calculate distance traveled for gradient position
    if (strokeData.lastPoint) {
      const dx = x - strokeData.lastPoint.x;
      const dy = y - strokeData.lastPoint.y;
      strokeData.strokeLength += Math.sqrt(dx * dx + dy * dy);
    } else {
      // Start of new stroke
      strokeData.strokeCounter = 0;
      strokeData.strokeLength = 0;
    }
    
    // Use stroke length to determine position in gradient
    const gradientCycleLength = 200;
    const indexValue = 1.0 - ((strokeData.strokeLength / gradientCycleLength) % 1.0);
    
    // Paint SQUARE stamp to buffer
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    
    const opacity = 255; // Full opacity always
    const indexByte = Math.floor(indexValue * 255);
    
    // Paint to layer-specific buffer if layerId provided, otherwise to current layer
    const targetBuffer = layerId ? strokeData.paintBuffer : currentLayer.paintBuffer;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = (py * this.width + px) * 4;
        targetBuffer[idx] = indexByte;
        targetBuffer[idx + 1] = 0;
        targetBuffer[idx + 2] = 0;
        targetBuffer[idx + 3] = opacity;
      }
    }
    
    // Mark as having content
    strokeData.hasContent = true;
    strokeData.lastPoint = { x, y };
    
    // Update stroke tracking based on whether we're using layer-specific tracking
    if (layerId) {
      // Update the layer strokes map
      this.layerStrokes.set(layerId, strokeData);
      
      // CRITICAL FIX: Don't overwrite currentLayer.paintBuffer when using layer-specific tracking
      // Instead, only update the texture with layer-specific data during rendering
      currentLayer.hasContent = strokeData.hasContent;
    } else {
      // Update global stroke tracking
      currentLayer.hasContent = true;
      currentLayer.paintBuffer = targetBuffer; // Only update WebGL buffer for non-layer-specific mode
      this.lastPoint = { x, y };
      this.strokeCounter = strokeData.strokeCounter;
      this.strokeLength = strokeData.strokeLength;
    }
    
    // Update texture - use layer-specific data if available
    if (layerId && this.layerStrokes.has(layerId)) {
      // For layer-specific rendering, update texture with the layer's paint buffer
      const layerData = this.layerStrokes.get(layerId)!;
      // Always update texture immediately when painting to prevent content disappearing
      this.updateIndexTextureWithData(this.currentLayerIndex, layerData.paintBuffer);
      // Also render immediately to show the stroke
      this.render();
    } else {
      // Standard texture update for non-layer-specific mode
      this.updateIndexTexture(this.currentLayerIndex);
      // Render immediately to show the stroke
      this.render();
    }
  }
  
  // Reset stroke tracking (call when starting new stroke)
  startStroke(layerId?: string) {
    if (layerId) {
      // Reset layer-specific stroke tracking
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData) {
        strokeData.lastPoint = null;
        strokeData.strokeCounter = 0;
        strokeData.strokeLength = 0;
      } else {
        // Initialize stroke data if it doesn't exist
        const currentGradient = this.currentLayerIndex >= 0 
          ? this.layers[this.currentLayerIndex].gradientStops 
          : this.defaultGradient();
        
        this.addNewLayer(currentGradient, `${layerId}_gradient_0`);
        const newGradientIndex = this.layers.length - 1;
        
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(this.width * this.height * 4),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [newGradientIndex],
          currentGradientIndex: newGradientIndex
        });
      }
    } else {
      // Reset global stroke tracking
      this.lastPoint = null;
      this.strokeCounter = 0;
      this.strokeLength = 0;
    }
    this.isDrawing = true;
    // Ensure animation continues during drawing
    this.isAnimating = true;
    this.isPaused = false;
  }
  
  // End stroke (call when lifting pen/mouse)
  endStroke(layerId?: string) {
    if (layerId) {
      // Reset layer-specific last point
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData) {
        strokeData.lastPoint = null;
      }
    } else {
      this.lastPoint = null;
    }
    this.isDrawing = false;
    
    // Force update current layer's texture
    if (this.currentLayerIndex >= 0) {
      this.updateIndexTexture(this.currentLayerIndex);
      // Do a final render to ensure content is visible
      this.render();
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
  
  // Update texture with specific data buffer (for layer-specific rendering)
  private updateIndexTextureWithData(layerIndex: number, paintBuffer: Uint8Array) {
    if (layerIndex < 0 || layerIndex >= this.layers.length) return;
    
    const layer = this.layers[layerIndex];
    const gl = this.gl;
    
    gl.bindTexture(gl.TEXTURE_2D, layer.indexTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0,
      this.width, this.height,
      gl.RGBA, gl.UNSIGNED_BYTE,
      paintBuffer
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
  
  // Batched texture update with specific data buffer
  private batchedUpdateIndexTextureWithData(layerIndex: number, paintBuffer: Uint8Array) {
    this.needsTextureUpdate = true;
    
    // Clear existing timer
    if (this.updateBatchTimer) {
      clearTimeout(this.updateBatchTimer);
    }
    
    // Batch updates: wait 4ms before actually updating texture
    this.updateBatchTimer = window.setTimeout(() => {
      if (this.needsTextureUpdate) {
        this.updateIndexTextureWithData(layerIndex, paintBuffer);
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
    // Don't start the internal animation loop - rely on external render loop
    // This prevents multiple animation loops from running simultaneously
  }
  
  stopAnimation() {
    this.isAnimating = false;
    this.isPaused = false;
    // No need to cancel animation frame since we're not using internal loop
  }
  
  pauseAnimation() {
    this.isPaused = true;
  }
  
  resumeAnimation() {
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    // Don't start internal loop - rely on external render loop
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
    if (this.isPaused || !this.isAnimating) {
      this.resumeAnimation();
    } else {
      this.pauseAnimation();
    }
  }
  
  isPlaying(): boolean {
    return this.isAnimating && !this.isPaused;
  }
  
  setPlaying(play: boolean) {
    if (play) {
      this.resumeAnimation();
    } else {
      this.pauseAnimation();
    }
  }
  
  // Force play state regardless of current state
  forcePlay() {
    this.isAnimating = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
  }
  
  // Force pause state regardless of current state  
  forcePause() {
    this.isPaused = true;
  }
  
  // Manual update method for external render loops
  updateAnimation() {
    // Only update animation if playing and not currently drawing
    if (this.isAnimating && !this.isPaused && !this.isDrawing) {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastFrameTime;
      
      if (deltaTime >= this.frameInterval) {
        this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.2;
        this.cycleOffset = this.cycleOffset % 1.0;
        this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
        
        // Render the animated frame
        this.render();
        
        // Notify listeners for canvas updates
        if (this.onFrameRendered) {
          this.onFrameRendered();
        }
      }
    } else if (this.isDrawing) {
      // While drawing, just update the cycle offset but don't render
      // The painting methods will handle rendering
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastFrameTime;
      
      if (deltaTime >= this.frameInterval) {
        this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.2;
        this.cycleOffset = this.cycleOffset % 1.0;
        this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
      }
    }
  }
  
  // Removed internal animate loop - all animation is driven externally through updateAnimation()
  
  // Serialize current state for undo/redo
  createSnapshot(layerId: string): ArrayBuffer {
    const layerStroke = this.layerStrokes.get(layerId);
    if (!layerStroke) {
      // Return empty buffer if no strokes for this layer
      return new ArrayBuffer(0);
    }
    
    // Create typed array view of the paint buffer
    const paintData = new Uint8Array(layerStroke.paintBuffer);
    
    // Calculate total size needed
    const metadataSize = 32; // Fixed size for metadata
    const totalSize = metadataSize + paintData.byteLength;
    
    // Create output buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // Write metadata
    let offset = 0;
    view.setUint32(offset, layerStroke.strokeCounter, true); offset += 4;
    view.setFloat32(offset, layerStroke.strokeLength, true); offset += 4;
    view.setUint32(offset, layerStroke.gradientLayerIndices.length, true); offset += 4;
    view.setUint32(offset, layerStroke.currentGradientIndex, true); offset += 4;
    view.setUint8(offset, layerStroke.hasContent ? 1 : 0); offset += 1;
    
    // Pad to align with paint data
    offset = metadataSize;
    
    // Copy paint data
    const outputArray = new Uint8Array(buffer, offset);
    outputArray.set(paintData);
    
    return buffer;
  }
  
  // Create optimized snapshot using delta compression
  createOptimizedSnapshot(layerId: string, previousSnapshot?: ArrayBuffer): ArrayBuffer {
    const layerStroke = this.layerStrokes.get(layerId);
    if (!layerStroke) {
      return new ArrayBuffer(0);
    }
    
    const currentData = new Uint8Array(layerStroke.paintBuffer);
    
    // If we have a previous snapshot, create delta
    if (previousSnapshot && previousSnapshot.byteLength > 32) {
      // Extract previous paint data (skip metadata)
      const prevData = new Uint8Array(previousSnapshot, 32);
      
      if (prevData.length === currentData.length) {
        // Create delta compression
        const delta = DeltaCompressor.createDelta(prevData, currentData);
        
        // Create buffer with metadata + delta
        const metadataSize = 33; // Extra byte for delta flag
        const buffer = new ArrayBuffer(metadataSize + delta.byteLength);
        const view = new DataView(buffer);
        
        // Write metadata
        let offset = 0;
        view.setUint32(offset, layerStroke.strokeCounter, true); offset += 4;
        view.setFloat32(offset, layerStroke.strokeLength, true); offset += 4;
        view.setUint32(offset, layerStroke.gradientLayerIndices.length, true); offset += 4;
        view.setUint32(offset, layerStroke.currentGradientIndex, true); offset += 4;
        view.setUint8(offset, layerStroke.hasContent ? 1 : 0); offset += 1;
        view.setUint8(offset, 1); offset += 1; // Delta flag = true
        
        // Pad to metadata size
        offset = metadataSize;
        
        // Copy delta data
        new Uint8Array(buffer, offset).set(new Uint8Array(delta));
        
        return buffer;
      }
    }
    
    // Fall back to full snapshot
    return this.createSnapshot(layerId);
  }
  
  // Restore state from snapshot
  restoreSnapshot(layerId: string, snapshot: ArrayBuffer, baseSnapshot?: ArrayBuffer): void {
    if (snapshot.byteLength === 0) {
      // Clear layer if empty snapshot
      this.layerStrokes.delete(layerId);
      return;
    }
    
    const view = new DataView(snapshot);
    let metadataSize = 32;
    let isDelta = false;
    
    // Check if we have the delta flag (newer format)
    if (snapshot.byteLength > 32 && view.getUint8(32) === 1) {
      metadataSize = 33;
      isDelta = true;
    }
    
    // Read metadata
    let offset = 0;
    const strokeCounter = view.getUint32(offset, true); offset += 4;
    const strokeLength = view.getFloat32(offset, true); offset += 4;
    const gradientLayerIndicesLength = view.getUint32(offset, true); offset += 4;
    const currentGradientIndex = view.getUint32(offset, true); offset += 4;
    const hasContent = view.getUint8(offset) === 1; offset += 1;
    
    let paintBuffer: Uint8Array;
    
    if (isDelta && baseSnapshot && baseSnapshot.byteLength > 32) {
      // Apply delta to base snapshot
      const baseData = new Uint8Array(baseSnapshot, 32);
      const deltaData = snapshot.slice(metadataSize);
      paintBuffer = DeltaCompressor.applyDelta(baseData, deltaData);
    } else {
      // Extract paint data normally
      const paintData = new Uint8Array(snapshot, metadataSize);
      paintBuffer = new Uint8Array(this.width * this.height);
      if (paintData.length > 0) {
        paintBuffer.set(paintData.slice(0, Math.min(paintData.length, paintBuffer.length)));
      }
    }
    
    // Restore layer stroke data
    this.layerStrokes.set(layerId, {
      paintBuffer,
      hasContent,
      strokeCounter,
      strokeLength,
      lastPoint: null,
      gradientLayerIndices: Array(gradientLayerIndicesLength).fill(0).map((_, i) => i),
      currentGradientIndex
    });
    
    // Update texture if this is the current layer
    if (this.currentLayerIndex >= 0) {
      const layer = this.layers[this.currentLayerIndex];
      if (layer.layerId === layerId) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, layer.indexTexture);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE,
          this.width, this.height, 0,
          this.gl.LUMINANCE, this.gl.UNSIGNED_BYTE,
          paintBuffer
        );
      }
    }
  }
  
  // Get full state for serialization
  getFullState(): {
    gradients: Array<{ gradientStops: Array<{ position: number; color: string }> }>;
    animationState: { cycleOffset: number; speed: number; fps: number; isPaused: boolean };
    layerSnapshots: Map<string, ArrayBuffer>;
  } {
    const layerSnapshots = new Map<string, ArrayBuffer>();
    
    // Create snapshots for all layers
    for (const [layerId] of this.layerStrokes) {
      layerSnapshots.set(layerId, this.createSnapshot(layerId));
    }
    
    return {
      gradients: this.layers.map(layer => ({
        gradientStops: layer.gradientStops
      })),
      animationState: {
        cycleOffset: this.cycleOffset,
        speed: this.cycleSpeed,
        fps: this.fps,
        isPaused: this.isPaused
      },
      layerSnapshots
    };
  }
  
  // Restore full state
  restoreFullState(state: {
    gradients: Array<{ gradientStops: Array<{ position: number; color: string }> }>;
    animationState: { cycleOffset: number; speed: number; fps: number; isPaused: boolean };
    layerSnapshots: Map<string, ArrayBuffer>;
  }): void {
    // Clear existing layers
    this.layers = [];
    this.layerStrokes.clear();
    this.layerIdToIndex.clear();
    this.currentLayerIndex = -1;
    
    // Restore gradients
    state.gradients.forEach(gradientData => {
      this.addNewLayer(gradientData.gradientStops);
    });
    
    // Restore animation state
    this.cycleOffset = state.animationState.cycleOffset;
    this.cycleSpeed = state.animationState.speed;
    this.fps = state.animationState.fps;
    this.isPaused = state.animationState.isPaused;
    this.frameInterval = 1000 / this.fps;
    
    // Restore layer snapshots
    for (const [layerId, snapshot] of state.layerSnapshots) {
      this.restoreSnapshot(layerId, snapshot);
    }
    
    // Re-render
    this.render();
  }
  
  // Render only strokes for a specific layer to a target canvas
  renderForLayer(layerId: string, targetCanvas: HTMLCanvasElement): void {
    const layerStroke = this.layerStrokes.get(layerId);
    if (!layerStroke || !layerStroke.hasContent) {
      // No strokes for this layer, clear the target canvas
      const ctx = targetCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      return;
    }
    
    // Ensure the WebGL canvas matches the target dimensions
    if (this.canvas.width !== targetCanvas.width || this.canvas.height !== targetCanvas.height) {
      this.resize(targetCanvas.width, targetCanvas.height);
    }
    
    // Clear the WebGL canvas
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Render all gradient layers associated with this canvas layer
    for (const gradientIndex of layerStroke.gradientLayerIndices) {
      const gradientLayer = this.layers[gradientIndex];
      if (gradientLayer && gradientLayer.hasContent) {
        // Update the gradient layer's paint buffer with the combined stroke data
        // This ensures all strokes for this canvas layer are rendered
        gradientLayer.paintBuffer = new Uint8Array(layerStroke.paintBuffer);
        this.updateIndexTexture(gradientIndex);
        
        // Render this gradient layer (will composite on top of previous)
        this.renderSingleLayerAdditive(gradientIndex);
      }
    }
    
    // Copy the WebGL canvas to the target canvas
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.drawImage(this.canvas, 0, 0);
    }
  }
  
  /**
   * Direct render to a target canvas - new method for Phase 3
   * Renders the animated color cycle directly onto the provided canvas
   * without using intermediate drawing canvas
   */
  renderDirectToCanvas(targetCanvas: HTMLCanvasElement, layerId?: string): void {
    // If a specific layer ID is provided, render only that layer's strokes
    if (layerId) {
      this.renderForLayer(layerId, targetCanvas);
      return;
    }
    
    // Otherwise, render all layers
    // Ensure WebGL canvas matches target dimensions
    if (this.canvas.width !== targetCanvas.width || this.canvas.height !== targetCanvas.height) {
      this.resize(targetCanvas.width, targetCanvas.height);
    }
    
    // Render to internal WebGL canvas
    this.render();
    
    // Copy result directly to target canvas
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      // Don't clear - composite on top of existing content
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.drawImage(this.canvas, 0, 0);
    }
  }
  
  // Render a layer additively (without clearing)
  private renderSingleLayerAdditive(layerIndex: number): void {
    const gl = this.gl;
    
    if (!this.program || layerIndex < 0 || layerIndex >= this.layers.length) {
      return;
    }
    
    const layer = this.layers[layerIndex];
    if (!layer.hasContent) {
      return;
    }
    
    gl.useProgram(this.program);
    
    // Use additive blending to composite multiple gradient layers
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set uniforms
    if (this.uniformLocations.cycleOffset) {
      gl.uniform1f(this.uniformLocations.cycleOffset, this.cycleOffset);
    }
    if (this.uniformLocations.forceOpacity) {
      gl.uniform1f(this.uniformLocations.forceOpacity, 0.0);
    }
    
    // Bind layer's textures
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
  
  // Render a specific layer by ID, or all layers if no ID provided
  renderLayer(layerId?: string): void {
    if (!layerId) {
      this.render();
      return;
    }
    
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex === undefined) {
      console.warn(`[ColorCycleBrush] Layer ${layerId} not found`);
      return;
    }
    
    this.renderLayerByIndex(layerIndex);
  }
  
  // New method to render a single layer in isolation
  private renderSingleLayer(layerIndex: number): void {
    const gl = this.gl;
    
    if (!this.program || layerIndex < 0 || layerIndex >= this.layers.length) {
      return;
    }
    
    const layer = this.layers[layerIndex];
    if (!layer.hasContent) {
      // Clear the canvas if no content
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    
    gl.useProgram(this.program);
    
    // Use standard source-over blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Clear canvas for this layer
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Set uniforms
    if (this.uniformLocations.cycleOffset) {
      gl.uniform1f(this.uniformLocations.cycleOffset, this.cycleOffset);
    }
    if (this.uniformLocations.forceOpacity) {
      gl.uniform1f(this.uniformLocations.forceOpacity, 0.0);
    }
    
    // Bind layer's textures
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
  
  // Render a specific layer by its internal index
  private renderLayerByIndex(layerIndex: number): void {
    const gl = this.gl;
    
    if (!this.program || layerIndex < 0 || layerIndex >= this.layers.length) {
      return;
    }
    
    const layer = this.layers[layerIndex];
    if (!layer.hasContent) {
      return;
    }
    
    gl.useProgram(this.program);
    
    // Use standard source-over blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Clear canvas for this layer
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // Set uniforms
    if (this.uniformLocations.cycleOffset) {
      gl.uniform1f(this.uniformLocations.cycleOffset, this.cycleOffset);
    }
    if (this.uniformLocations.forceOpacity) {
      gl.uniform1f(this.uniformLocations.forceOpacity, 0.0);
    }
    
    // Bind layer's textures
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
  setGradient(stops: Array<{ position: number; color: string }>, layerId?: string) {
    // If a layer ID is provided, create a new gradient layer for that canvas layer
    if (layerId) {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData) {
        // Check if current gradient layer for this canvas layer already has this gradient
        const currentGradientLayer = this.layers[strokeData.currentGradientIndex];
        if (currentGradientLayer && this.gradientsMatch(currentGradientLayer.gradientStops, stops)) {
          return; // Already using this gradient
        }
        
        // Check if any existing gradient layer for this canvas layer has this gradient
        for (const gradientIndex of strokeData.gradientLayerIndices) {
          const layer = this.layers[gradientIndex];
          if (layer && this.gradientsMatch(layer.gradientStops, stops)) {
            strokeData.currentGradientIndex = gradientIndex;
            this.currentLayerIndex = gradientIndex;
            return;
          }
        }
        
        // Need to create a new gradient layer for this canvas layer
        const gradientLayerId = `${layerId}_gradient_${strokeData.gradientLayerIndices.length}`;
        this.addNewLayer(stops, gradientLayerId);
        const newGradientIndex = this.layers.length - 1;
        
        strokeData.gradientLayerIndices.push(newGradientIndex);
        strokeData.currentGradientIndex = newGradientIndex;
        this.currentLayerIndex = newGradientIndex;
        
        return;
      }
    }
    
    // Original behavior for non-layer-specific gradient changes
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
  
  // Clear a specific layer by ID, or all layers if no ID provided
  clearLayer(layerId?: string) {
    if (!layerId) {
      this.clear();
      return;
    }
    
    // Clear layer-specific stroke data
    const strokeData = this.layerStrokes.get(layerId);
    if (strokeData) {
      strokeData.paintBuffer.fill(0);
      strokeData.hasContent = false;
      strokeData.strokeCounter = 0;
      strokeData.strokeLength = 0;
      strokeData.lastPoint = null;
      
      // Clear all gradient layers associated with this canvas layer
      for (const gradientIndex of strokeData.gradientLayerIndices) {
        const layer = this.layers[gradientIndex];
        if (layer) {
          layer.paintBuffer.fill(0);
          layer.hasContent = false;
          this.updateIndexTextureForLayer(layer);
        }
      }
    }
    
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex === undefined) {
      return;
    }
    
    const layer = this.layers[layerIndex];
    if (layer) {
      layer.paintBuffer.fill(0);
      layer.hasContent = false;
      this.updateIndexTextureForLayer(layer);
    }
  }
  
  clear() {
    
    // Clear all layer-specific stroke data
    this.layerStrokes.clear();
    
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
  
  // Get list of layer IDs that have content
  getLayersWithContent(): string[] {
    return this.layers
      .filter(layer => layer.hasContent && layer.layerId)
      .map(layer => layer.layerId!);
  }
  
  // Check if a specific layer has content
  layerHasContent(layerId: string): boolean {
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex === undefined) {
      return false;
    }
    return this.layers[layerIndex]?.hasContent || false;
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
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.width = width;
    this.height = height;
    
    // Resize all layer-specific stroke buffers
    for (const [layerId, strokeData] of this.layerStrokes.entries()) {
      const newBuffer = new Uint8Array(width * height * 4);
      
      // Copy old data (what fits)
      const copyWidth = Math.min(oldWidth, width);
      const copyHeight = Math.min(oldHeight, height);
      
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const oldIdx = (y * oldWidth + x) * 4;
          const newIdx = (y * width + x) * 4;
          newBuffer[newIdx] = strokeData.paintBuffer[oldIdx];
          newBuffer[newIdx + 1] = strokeData.paintBuffer[oldIdx + 1];
          newBuffer[newIdx + 2] = strokeData.paintBuffer[oldIdx + 2];
          newBuffer[newIdx + 3] = strokeData.paintBuffer[oldIdx + 3];
        }
      }
      
      strokeData.paintBuffer = newBuffer;
    }
    
    // Recreate all layer buffers and textures with new size
    const gl = this.gl;
    
    for (const layer of this.layers) {
      // Create new buffer
      const newBuffer = new Uint8Array(width * height * 4);
      
      // Copy old data (what fits)
      const copyWidth = Math.min(oldWidth, width);
      const copyHeight = Math.min(oldHeight, height);
      
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const oldIdx = (y * oldWidth + x) * 4;
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

  setLayerId(layerId: string) {
    // Set the layer ID for the current gradient layer
    if (this.currentLayerIndex >= 0 && this.currentLayerIndex < this.layers.length) {
      this.layers[this.currentLayerIndex].layerId = layerId;
      this.layerIdToIndex.set(layerId, this.currentLayerIndex);
    }
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
  
  // Get memory usage statistics
  getMemoryStats(): {
    layerCount: number;
    totalPaintBufferSize: number;
    textureMemory: number;
    estimatedTotalMemory: number;
  } {
    let totalPaintBufferSize = 0;
    
    // Calculate paint buffer sizes
    for (const stroke of this.layerStrokes.values()) {
      totalPaintBufferSize += stroke.paintBuffer.byteLength;
    }
    
    // Also count layer paint buffers
    for (const layer of this.layers) {
      totalPaintBufferSize += layer.paintBuffer.byteLength;
    }
    
    // Estimate texture memory (width * height * bytes per pixel * number of textures)
    const bytesPerPixel = 1; // LUMINANCE format for index texture
    const paletteBytes = 256 * 4; // 256 colors * RGBA
    const textureSize = this.width * this.height * bytesPerPixel + paletteBytes;
    const textureMemory = this.layers.length * textureSize;
    
    const estimatedTotalMemory = totalPaintBufferSize + textureMemory;
    
    return {
      layerCount: this.layers.length,
      totalPaintBufferSize,
      textureMemory,
      estimatedTotalMemory
    };
  }
}