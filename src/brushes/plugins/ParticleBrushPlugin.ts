import { BaseBrushPlugin, BrushDrawContext, BrushMetadata } from '../BrushPlugin';
import { BrushSettings } from '../../types';

/**
 * Particle Brush Plugin - Creates scattered particle effects
 * Example of a simple user-created brush plugin
 */
export class ParticleBrushPlugin extends BaseBrushPlugin {
  readonly id = 'particle-brush';
  readonly metadata: BrushMetadata = {
    id: 'particle-brush',
    name: 'Particle Brush',
    description: 'Scatters particles for spray paint and texture effects',
    author: 'Vessel Team',
    version: '1.0.0',
    category: 'Artistic',
    tags: ['particle', 'spray', 'texture', 'scatter'],
  };

  private particleDensity = 20; // Number of particles per stamp
  private scatterRadius = 1.5; // How far particles scatter (multiplier of brush size)

  performanceHints = {
    preferredFPS: 60,
    usesGPU: false,
    requiresImageData: false,
    maxStrokePoints: 1000
  };

  draw(context: BrushDrawContext): void {
    const { ctx, x, y, pressure, settings } = context;
    const size = settings.size * (pressure || 1);
    const particleCount = Math.floor(this.particleDensity * pressure);
    const scatter = size * this.scatterRadius;

    ctx.save();
    ctx.fillStyle = settings.color;
    ctx.globalAlpha = (settings.opacity * 0.3) / Math.sqrt(particleCount); // Adjust opacity per particle
    ctx.globalCompositeOperation = settings.blendMode || 'source-over';

    // Draw scattered particles
    for (let i = 0; i < particleCount; i++) {
      // Random position within scatter radius
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * scatter;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      
      // Random particle size
      const particleSize = Math.random() * 3 + 1;
      
      // Draw particle
      ctx.beginPath();
      ctx.arc(px, py, particleSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: BrushSettings
  ): void {
    // Draw particles along the line
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / 5)); // Sample every 5 pixels
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      
      this.draw({
        ctx,
        x,
        y,
        pressure: 1,
        settings,
        lastPoint: null
      });
    }
  }
}

export default ParticleBrushPlugin;