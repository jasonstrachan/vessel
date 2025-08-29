/**
 * Simple Color Cycle Brush - Canvas-based implementation
 * Draws strokes that cycle through a gradient over time
 */

export class ColorCycleBrushSimple {
  private cycleSpeed: number;
  private cycleOffset: number;
  private gradientStops: Array<{ position: number; color: string }>;
  private animationId: number | null = null;
  private isAnimating: boolean = false;
  private lastFrameTime: number = 0;
  private fps: number;
  private frameInterval: number;
  private brushSize: number;
  
  // Store painted strokes for animation
  private strokes: Array<{
    x: number;
    y: number;
    size: number;
    startOffset: number; // Random offset in gradient for this stroke
    opacity: number;
  }> = [];

  constructor(options: {
    brushSize?: number;
    fps?: number;
    cycleSpeed?: number;
  } = {}) {
    this.brushSize = options.brushSize || 20;
    this.fps = options.fps || 30;
    this.frameInterval = 1000 / this.fps;
    this.cycleSpeed = options.cycleSpeed || 1.0;
    this.cycleOffset = 0;
    
    // Default rainbow gradient
    this.gradientStops = [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
    
    this.startAnimation();
  }
  
  // Paint a single stamp
  paint(ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number = 1.0) {
    const radius = this.brushSize / 2;
    const startOffset = Math.random(); // Random position in gradient
    
    // Get current color from gradient
    const colorPosition = (startOffset + this.cycleOffset) % 1.0;
    const color = this.getColorAtPosition(colorPosition);
    
    // Draw the brush stamp
    ctx.save();
    ctx.globalAlpha = pressure;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Store stroke info for future animation updates
    this.strokes.push({
      x,
      y,
      size: this.brushSize,
      startOffset,
      opacity: pressure
    });
  }
  
  // Get interpolated color at a position in the gradient
  private getColorAtPosition(position: number): string {
    // Ensure position is between 0 and 1
    position = Math.max(0, Math.min(1, position));
    
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
    
    // Calculate interpolation factor
    const range = after.position - before.position;
    const t = range > 0 ? (position - before.position) / range : 0;
    
    // Parse colors and interpolate
    const beforeRGB = this.hexToRgb(before.color);
    const afterRGB = this.hexToRgb(after.color);
    
    const r = Math.round(beforeRGB.r + (afterRGB.r - beforeRGB.r) * t);
    const g = Math.round(beforeRGB.g + (afterRGB.g - beforeRGB.g) * t);
    const b = Math.round(beforeRGB.b + (afterRGB.b - beforeRGB.b) * t);
    
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
  
  // Update animation
  private startAnimation() {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    this.animate();
  }
  
  private animate() {
    if (!this.isAnimating) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    
    // Limit frame rate
    if (deltaTime >= this.frameInterval) {
      // Update cycle offset with more granular control
      // Scale down the speed for finer control (0.1 instead of 0.2)
      this.cycleOffset += (deltaTime / 1000) * this.cycleSpeed * 0.1;
      this.cycleOffset = this.cycleOffset % 1.0;
      
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);
    }
    
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  // Render all strokes with current animation state
  renderAnimatedStrokes(ctx: CanvasRenderingContext2D) {
    ctx.save();
    
    for (const stroke of this.strokes) {
      const colorPosition = (stroke.startOffset + this.cycleOffset) % 1.0;
      const color = this.getColorAtPosition(colorPosition);
      
      ctx.globalAlpha = stroke.opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(stroke.x, stroke.y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  // Public API
  setGradient(stops: Array<{ position: number; color: string }>) {
    this.gradientStops = stops;
  }
  
  setBrushSize(size: number) {
    this.brushSize = size;
  }
  
  setSpeed(speed: number) {
    // Cap speed to maximum of 1.0
    this.cycleSpeed = Math.min(1.0, Math.max(0, speed));
  }
  
  setFPS(fps: number) {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
  }
  
  getCycleOffset(): number {
    return this.cycleOffset;
  }
  
  clear() {
    this.strokes = [];
  }
  
  destroy() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}