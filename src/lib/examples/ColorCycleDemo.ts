/**
 * ColorCycleDemo - Demonstration of the color cycling animation system
 * Shows various drawing operations and animation effects
 */

import { ColorCycleAnimator } from '../ColorCycleAnimator';
import { AnimationController } from '../AnimationController';

export class ColorCycleDemo {
  private animator: ColorCycleAnimator;
  private container: HTMLElement;
  private controlsContainer: HTMLElement;
  
  constructor(container: HTMLElement, width: number = 800, height: number = 600) {
    this.container = container;
    
    // Create animator with rainbow gradient
    this.animator = new ColorCycleAnimator({
      width,
      height,
      fps: 30,
      speed: 1.0,
      autoStart: false
    });
    
    // Add canvas to container
    const canvas = this.animator.getCanvas();
    canvas.style.border = '1px solid #ccc';
    canvas.style.imageRendering = 'pixelated'; // For pixel art
    container.appendChild(canvas);
    
    // Create controls
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.style.marginTop = '10px';
    container.appendChild(this.controlsContainer);
    
    this.setupControls();
    this.setupDrawingHandlers(canvas);
    
    // Draw initial demo content
    this.drawDemoContent();
  }
  
  /**
   * Setup UI controls
   */
  private setupControls() {
    // Play/Pause button
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.onclick = () => {
      this.animator.toggle();
      playBtn.textContent = this.animator.isAnimating() ? 'Pause' : 'Play';
    };
    this.controlsContainer.appendChild(playBtn);
    
    // Speed control
    const speedLabel = document.createElement('label');
    speedLabel.textContent = ' Speed: ';
    const speedInput = document.createElement('input');
    speedInput.type = 'range';
    speedInput.min = '0.1';
    speedInput.max = '5';
    speedInput.step = '0.1';
    speedInput.value = '1';
    speedInput.oninput = () => {
      this.animator.setSpeed(parseFloat(speedInput.value));
      speedValue.textContent = speedInput.value;
    };
    const speedValue = document.createElement('span');
    speedValue.textContent = '1.0';
    speedLabel.appendChild(speedInput);
    speedLabel.appendChild(speedValue);
    this.controlsContainer.appendChild(speedLabel);
    
    // FPS control
    const fpsLabel = document.createElement('label');
    fpsLabel.textContent = ' FPS: ';
    const fpsInput = document.createElement('input');
    fpsInput.type = 'range';
    fpsInput.min = '1';
    fpsInput.max = '60';
    fpsInput.value = '30';
    fpsInput.oninput = () => {
      this.animator.setFPS(parseInt(fpsInput.value));
      fpsValue.textContent = fpsInput.value;
    };
    const fpsValue = document.createElement('span');
    fpsValue.textContent = '30';
    fpsLabel.appendChild(fpsInput);
    fpsLabel.appendChild(fpsValue);
    this.controlsContainer.appendChild(fpsLabel);
    
    // Gradient presets
    const presetLabel = document.createElement('label');
    presetLabel.textContent = ' Gradient: ';
    const presetSelect = document.createElement('select');
    ['rainbow', 'fire', 'ocean', 'sunset', 'grayscale'].forEach(preset => {
      const option = document.createElement('option');
      option.value = preset;
      option.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
      presetSelect.appendChild(option);
    });
    presetSelect.onchange = () => {
      this.animator.setPresetGradient(presetSelect.value as any);
    };
    presetLabel.appendChild(presetSelect);
    this.controlsContainer.appendChild(presetLabel);
    
    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      this.animator.clear();
    };
    this.controlsContainer.appendChild(clearBtn);
    
    // Demo patterns
    const demoBtn = document.createElement('button');
    demoBtn.textContent = 'Demo Pattern';
    demoBtn.onclick = () => {
      this.drawDemoContent();
    };
    this.controlsContainer.appendChild(demoBtn);
    
    // Stats display
    const statsDiv = document.createElement('div');
    statsDiv.style.marginTop = '10px';
    statsDiv.style.fontFamily = 'monospace';
    statsDiv.style.fontSize = '12px';
    this.controlsContainer.appendChild(statsDiv);
    
    // Update stats periodically
    setInterval(() => {
      if (this.animator.isAnimating()) {
        const stats = this.animator.getStats();
        statsDiv.textContent = `FPS: ${stats.actualFPS.toFixed(1)} / ${stats.targetFPS} | Frames: ${stats.frameCount} | Time: ${stats.totalTime.toFixed(1)}s`;
      }
    }, 100);
  }
  
  /**
   * Setup drawing handlers
   */
  private setupDrawingHandlers(canvas: HTMLCanvasElement) {
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    
    canvas.onmousedown = (e) => {
      isDrawing = true;
      const rect = canvas.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;
      
      this.animator.paint(lastX, lastY, 10);
    };
    
    canvas.onmousemove = (e) => {
      if (!isDrawing) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      this.animator.paintLine(lastX, lastY, x, y, 10);
      
      lastX = x;
      lastY = y;
    };
    
    canvas.onmouseup = () => {
      isDrawing = false;
    };
    
    canvas.onmouseleave = () => {
      isDrawing = false;
    };
    
    // Right click to fill
    canvas.oncontextmenu = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      this.animator.fill(x, y);
    };
  }
  
  /**
   * Draw demo content
   */
  private drawDemoContent() {
    const { width, height } = this.animator.getDimensions();
    
    // Clear first
    this.animator.clear();
    
    // Draw concentric circles
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 3;
    
    for (let r = maxRadius; r > 0; r -= 20) {
      const angle = (r / maxRadius) * Math.PI * 2;
      const colorIndex = Math.floor((r / maxRadius) * 255);
      
      // Draw circle outline
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const x = centerX + Math.cos(a) * r;
        const y = centerY + Math.sin(a) * r;
        this.animator.paint(x, y, 5, colorIndex);
      }
    }
    
    // Draw gradient rectangles in corners
    const rectSize = 80;
    const margin = 20;
    
    // Top-left
    this.animator.createGradientFill(margin, margin, rectSize, rectSize, 0, 64);
    
    // Top-right
    this.animator.createGradientFill(width - margin - rectSize, margin, rectSize, rectSize, 64, 128);
    
    // Bottom-left
    this.animator.createGradientFill(margin, height - margin - rectSize, rectSize, rectSize, 128, 192);
    
    // Bottom-right
    this.animator.createGradientFill(width - margin - rectSize, height - margin - rectSize, rectSize, rectSize, 192, 255);
    
    // Draw radial gradients
    this.animator.createRadialGradient(width * 0.25, height * 0.5, 50, 0, 128);
    this.animator.createRadialGradient(width * 0.75, height * 0.5, 50, 128, 255);
    
    // Draw some lines
    for (let i = 0; i < 5; i++) {
      const y = height * 0.7 + i * 15;
      const colorIndex = 50 + i * 30;
      this.animator.paintLine(width * 0.1, y, width * 0.9, y, 3, colorIndex);
    }
  }
  
  /**
   * Animate a drawing sequence
   */
  animateDrawing() {
    const { width, height } = this.animator.getDimensions();
    let angle = 0;
    
    const drawFrame = () => {
      // Draw a spiral
      const x = width / 2 + Math.cos(angle) * angle * 2;
      const y = height / 2 + Math.sin(angle) * angle * 2;
      
      const colorIndex = Math.floor((angle / (Math.PI * 20)) * 255);
      this.animator.paint(x, y, 5, colorIndex);
      
      angle += 0.2;
      
      if (angle < Math.PI * 20) {
        requestAnimationFrame(drawFrame);
      }
    };
    
    this.animator.clear();
    drawFrame();
  }
  
  /**
   * Create animated transition between gradients
   */
  animateGradientTransition(
    fromPreset: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'grayscale',
    toPreset: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'grayscale',
    duration: number = 2000
  ) {
    // This would interpolate between gradient stops over time
    // Implementation would use AnimationController.withEasing
    
    const controller = AnimationController.withEasing(
      duration / 1000,
      AnimationController.Easing.easeInOutCubic,
      (progress) => {
        // Interpolate between gradients based on progress
        // This is a simplified example
        if (progress < 0.5) {
          this.animator.setPresetGradient(fromPreset);
        } else {
          this.animator.setPresetGradient(toPreset);
        }
      },
      () => {}
    );
    
    controller.start();
  }
}

// Export function to create demo
export function createColorCycleDemo(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error(`Container with id "${containerId}" not found`);
  }
  
  return new ColorCycleDemo(container);
}
