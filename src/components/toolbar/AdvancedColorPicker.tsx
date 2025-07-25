import React, { useRef, useEffect, useState } from 'react';

interface AdvancedColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

class AdvancedPicker {
  target: HTMLCanvasElement;
  hueCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  hueWidth: number;
  hueHeight: number;
  context: CanvasRenderingContext2D;
  hueContext: CanvasRenderingContext2D;
  pickerCircle: { x: number; y: number };
  hueSelector: { y: number };
  clicked: boolean;
  hueClicked: boolean;
  activePointerId: number | null = null;
  hue: number = 0;
  saturation: number = 0;
  value: number = 0;
  red: number = 0;
  green: number = 0;
  blue: number = 0;
  hexcode: string = "#000000";
  onColorChange: (color: string) => void;
  
  boundHandleMouseMove: (e: PointerEvent) => void;
  boundHandleMouseUp: (e: PointerEvent) => void;

  constructor(
    target: HTMLCanvasElement, 
    hueCanvas: HTMLCanvasElement,
    width: number, 
    height: number,
    hueWidth: number,
    hueHeight: number,
    initialColor: string,
    onColorChange: (color: string) => void
  ) {
    this.target = target;
    this.hueCanvas = hueCanvas;
    this.width = width;
    this.height = height;
    this.hueWidth = hueWidth;
    this.hueHeight = hueHeight;
    this.onColorChange = onColorChange;
    
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    
    this.target.width = width;
    this.target.height = height;
    this.hueCanvas.width = hueWidth;
    this.hueCanvas.height = hueHeight;
    
    this.target.style.touchAction = 'none';
    this.target.style.userSelect = 'none';
    this.hueCanvas.style.touchAction = 'none';
    this.hueCanvas.style.userSelect = 'none';
    
    const context = this.target.getContext("2d");
    const hueContext = this.hueCanvas.getContext("2d");
    if (!context || !hueContext) throw new Error("Cannot get 2D context");
    this.context = context;
    this.hueContext = hueContext;
    
    this.pickerCircle = { x: 10, y: 10 };
    this.hueSelector = { y: 10 };
    this.clicked = false;
    this.hueClicked = false;
    
    this.hexToHSV(initialColor);
    this.init();
  }

  init() {
    this.drawHueGrad();
    this.drawHSLGrad();
    
    this.target.addEventListener("pointerdown", (e) => {
      this.handleMouseDown(e);
    }, { passive: false });
    
    this.hueCanvas.addEventListener("pointerdown", (e) => {
      this.handleHueMouseDown(e);
    }, { passive: false });
    
    document.addEventListener("pointermove", this.boundHandleMouseMove, { passive: false });
    document.addEventListener("pointerup", this.boundHandleMouseUp, { passive: false });
  }
  
  destroy() {
    document.removeEventListener("pointermove", this.boundHandleMouseMove);
    document.removeEventListener("pointerup", this.boundHandleMouseUp);
  }

  hexToHSV(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    
    let h = 0;
    let s = 0;
    const v = max;

    if (delta !== 0) {
      s = delta / max;
      
      switch (max) {
        case r: h = (g - b) / delta + (g < b ? 6 : 0); break;
        case g: h = (b - r) / delta + 2; break;
        case b: h = (r - g) / delta + 4; break;
      }
      h /= 6;
    }

    this.hue = Math.round(h * 360);
    this.saturation = Math.round(s * 100);
    this.value = Math.round(v * 100);
    this.red = Math.round(r * 255);
    this.green = Math.round(g * 255);
    this.blue = Math.round(b * 255);
    this.hexcode = hex;
  }

  drawHueGrad() {
    const grad = this.hueContext.createLinearGradient(0, 0, 0, this.hueHeight);
    grad.addColorStop(0, '#ff0000');
    grad.addColorStop(0.17, '#ffff00');
    grad.addColorStop(0.33, '#00ff00');
    grad.addColorStop(0.5, '#00ffff');
    grad.addColorStop(0.67, '#0000ff');
    grad.addColorStop(0.83, '#ff00ff');
    grad.addColorStop(1, '#ff0000');
    
    this.hueContext.fillStyle = grad;
    this.hueContext.fillRect(0, 0, this.hueWidth, this.hueHeight);
    
    this.drawHueSelector();
  }

  drawHSLGrad() {
    for (let row = 0; row < this.height; row++) {
      const grad = this.context.createLinearGradient(0, 0, this.width, 0);
      const lightness = ((this.height - row) / this.height) * 100;
      grad.addColorStop(0, `hsl(${this.hue}, 0%, ${lightness}%)`);
      grad.addColorStop(1, `hsl(${this.hue}, 100%, ${lightness}%)`);
      this.context.fillStyle = grad;
      this.context.fillRect(0, row, this.width, 1);
    }
    this.calcSelector();
    this.drawSelector();
  }

  calcSelector() {
    this.pickerCircle.x = Math.round(this.saturation * this.width / 100);
    this.pickerCircle.y = Math.round((100 - this.lightness) * this.height / 100);
    this.hueSelector.y = Math.round(this.hue * this.hueHeight / 360);
  }

  drawSelector() {
    this.context.beginPath();
    this.context.arc(this.pickerCircle.x, this.pickerCircle.y, 8, 0, 2 * Math.PI);
    this.context.strokeStyle = "#000";
    this.context.lineWidth = 3;
    this.context.stroke();
    this.context.strokeStyle = "#fff";
    this.context.lineWidth = 2;
    this.context.stroke();
  }

  drawHueSelector() {
    this.hueContext.strokeStyle = "#000";
    this.hueContext.lineWidth = 3;
    this.hueContext.strokeRect(-1, this.hueSelector.y - 3, this.hueWidth + 2, 6);
    this.hueContext.strokeStyle = "#fff";
    this.hueContext.lineWidth = 2;
    this.hueContext.strokeRect(-1, this.hueSelector.y - 3, this.hueWidth + 2, 6);
  }

  selectSL(x: number, y: number) {
    // Account for canvas scaling
    const scaleX = this.width / this.target.offsetWidth;
    const scaleY = this.height / this.target.offsetHeight;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    
    this.saturation = Math.round(canvasX / this.width * 100);
    this.lightness = Math.round((this.height - canvasY) / this.height * 100);
    this.saturation = Math.max(0, Math.min(100, this.saturation));
    this.lightness = Math.max(0, Math.min(100, this.lightness));
    this.drawHSLGrad();
    this.HSVToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  selectHue(y: number) {
    // Account for canvas scaling
    const scaleY = this.hueHeight / this.hueCanvas.offsetHeight;
    const canvasY = y * scaleY;
    
    this.hue = Math.round(canvasY / this.hueHeight * 360);
    this.hue = Math.max(0, Math.min(360, this.hue));
    this.drawHueGrad();
    this.drawHSLGrad();
    this.HSVToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  handleMouseDown(e: PointerEvent) {
    e.preventDefault();
    if (this.activePointerId === null) {
      this.activePointerId = e.pointerId;
      this.clicked = true;
      const rect = this.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.selectSL(x, y);
    }
  }

  handleHueMouseDown(e: PointerEvent) {
    e.preventDefault();
    if (this.activePointerId === null) {
      this.activePointerId = e.pointerId;
      this.hueClicked = true;
      const rect = this.hueCanvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      this.selectHue(y);
    }
  }

  handleMouseMove(e: PointerEvent) {
    if (e.pointerId !== this.activePointerId) return;
    
    if (this.clicked) {
      e.preventDefault();
      const rect = this.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const constrainedX = Math.max(0, Math.min(this.target.offsetWidth, x));
      const constrainedY = Math.max(0, Math.min(this.target.offsetHeight, y));
      
      this.selectSL(constrainedX, constrainedY);
    } else if (this.hueClicked) {
      e.preventDefault();
      const rect = this.hueCanvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      
      const constrainedY = Math.max(0, Math.min(this.hueCanvas.offsetHeight, y));
      this.selectHue(constrainedY);
    }
  }

  handleMouseUp(e: PointerEvent) {
    if (e.pointerId === this.activePointerId) {
      this.clicked = false;
      this.hueClicked = false;
      this.activePointerId = null;
    }
  }

  HSVToRGB() {
    const h = this.hue / 60;
    const s = this.saturation / 100;
    const v = this.value / 100;

    const c = v * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = v - c;

    let r, g, b;

    if (h >= 0 && h < 1) {
      r = c; g = x; b = 0;
    } else if (h >= 1 && h < 2) {
      r = x; g = c; b = 0;
    } else if (h >= 2 && h < 3) {
      r = 0; g = c; b = x;
    } else if (h >= 3 && h < 4) {
      r = 0; g = x; b = c;
    } else if (h >= 4 && h < 5) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    this.red = Math.round((r + m) * 255);
    this.green = Math.round((g + m) * 255);
    this.blue = Math.round((b + m) * 255);
  }

  RGBToHex() {
    this.hexcode = "#" + ((1 << 24) + (this.red << 16) + (this.green << 8) + this.blue).toString(16).slice(1);
  }

  updateColor() {
    this.onColorChange(this.hexcode);
  }
}

export default function AdvancedColorPicker({ color, onChange }: AdvancedColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const pickerRef = useRef<AdvancedPicker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (canvasRef.current && hueCanvasRef.current && containerRef.current) {
      // Wait for next frame to ensure container is fully rendered
      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        
        // Get actual container width (full column width)
        const containerWidth = containerRef.current.offsetWidth;
        const hueWidth = 20;
        const gap = 4;
        const mainWidth = containerWidth - hueWidth - gap;
        const height = Math.min(mainWidth, 180); // Reasonable height limit
        
        try {
          pickerRef.current = new AdvancedPicker(
            canvasRef.current!, 
            hueCanvasRef.current!,
            mainWidth, height, hueWidth, height, 
            color,
            (newColor) => {
              onChange(newColor);
            }
          );
        } catch (error) {
          console.error('Failed to initialize color picker:', error);
        }
      });
    }
    
    return () => {
      if (pickerRef.current) {
        pickerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (pickerRef.current && color !== pickerRef.current.hexcode) {
      pickerRef.current.hexToHSV(color);
      pickerRef.current.drawHueGrad();
      pickerRef.current.drawHSLGrad();
    }
  }, [color]);

  return (
    <div ref={containerRef} className="flex bg-[#2A2A32] rounded w-full" style={{ gap: '4px' }}>
      <canvas
        ref={canvasRef}
        className="cursor-crosshair outline-none focus:outline-none rounded flex-1"
        style={{ width: '100%', height: 'auto' }}
      />
      <canvas
        ref={hueCanvasRef}
        className="cursor-crosshair outline-none focus:outline-none rounded"
        style={{ width: '20px', height: 'auto' }}
      />
    </div>
  );
}