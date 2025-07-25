import React, { useRef, useEffect, useState } from 'react';
import Input from '../ui/Input';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

class Picker {
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
  oldColor: string;
  onColorChange: (color: string) => void;
  
  // Bound methods for proper event listener cleanup
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
    this.oldColor = initialColor;
    
    // Bind methods for consistent event listener cleanup
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    
    this.target.width = width;
    this.target.height = height;
    this.hueCanvas.width = hueWidth;
    this.hueCanvas.height = hueHeight;
    
    // Critical CSS for proper pointer event handling
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
    
    // Parse initial color
    this.hexToHSV(initialColor);
    
    this.init();
  }

  init() {
    this.drawHueGrad();
    this.drawHSVGrad();
    
    // Main canvas events - using pointer events for stylus/pen support
    this.target.addEventListener("pointerdown", (e) => {
      this.handleMouseDown(e);
    }, { passive: false });
    
    // Hue canvas events - using pointer events for stylus/pen support
    this.hueCanvas.addEventListener("pointerdown", (e) => {
      this.handleHueMouseDown(e);
    }, { passive: false });
    
    // Global pointer events for dragging - using bound methods for proper cleanup
    document.addEventListener("pointermove", this.boundHandleMouseMove, { passive: false });
    document.addEventListener("pointerup", this.boundHandleMouseUp, { passive: false });
  }
  
  destroy() {
    // Proper cleanup of event listeners
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

  drawHSVGrad() {
    // Create HSV gradient: saturation horizontally (0-100%), value vertically (100% at top, 0% at bottom)
    for (let row = 0; row < this.height; row++) {
      const grad = this.context.createLinearGradient(0, 0, this.width, 0);
      const value = ((this.height - row) / this.height) * 100;
      
      // Left side: no saturation (white/gray)
      const leftColor = this.HSVToRGBString(this.hue, 0, value);
      // Right side: full saturation
      const rightColor = this.HSVToRGBString(this.hue, 100, value);
      
      grad.addColorStop(0, leftColor);
      grad.addColorStop(1, rightColor);
      this.context.fillStyle = grad;
      this.context.fillRect(0, row, this.width, 1);
    }
    this.calcSelector();
    this.drawSelector();
  }

  // Helper method to convert HSV to RGB string for canvas gradients
  HSVToRGBString(h: number, s: number, v: number): string {
    const hNorm = h / 60;
    const sNorm = s / 100;
    const vNorm = v / 100;

    const c = vNorm * sNorm;
    const x = c * (1 - Math.abs((hNorm % 2) - 1));
    const m = vNorm - c;

    let r, g, b;

    if (hNorm >= 0 && hNorm < 1) {
      r = c; g = x; b = 0;
    } else if (hNorm >= 1 && hNorm < 2) {
      r = x; g = c; b = 0;
    } else if (hNorm >= 2 && hNorm < 3) {
      r = 0; g = c; b = x;
    } else if (hNorm >= 3 && hNorm < 4) {
      r = 0; g = x; b = c;
    } else if (hNorm >= 4 && hNorm < 5) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    const red = Math.round((r + m) * 255);
    const green = Math.round((g + m) * 255);
    const blue = Math.round((b + m) * 255);

    return `rgb(${red}, ${green}, ${blue})`;
  }

  calcSelector() {
    this.pickerCircle.x = Math.round(this.saturation * this.width / 100);
    this.pickerCircle.y = Math.round((100 - this.value) * this.height / 100);
    this.hueSelector.y = Math.round(this.hue * this.hueHeight / 360);
  }

  drawSelector() {
    this.context.beginPath();
    this.context.arc(this.pickerCircle.x, this.pickerCircle.y, 6, 0, 2 * Math.PI);
    this.context.strokeStyle = "#000";
    this.context.lineWidth = 2;
    this.context.stroke();
    this.context.strokeStyle = "#fff";
    this.context.lineWidth = 1;
    this.context.stroke();
  }

  drawHueSelector() {
    this.hueContext.strokeStyle = "#000";
    this.hueContext.lineWidth = 2;
    this.hueContext.strokeRect(0, this.hueSelector.y - 2, this.hueWidth, 4);
    this.hueContext.strokeStyle = "#fff";
    this.hueContext.lineWidth = 1;
    this.hueContext.strokeRect(0, this.hueSelector.y - 2, this.hueWidth, 4);
  }

  selectSL(x: number, y: number) {
    this.saturation = Math.round(x / this.width * 100);
    this.value = Math.round((this.height - y) / this.height * 100);
    this.saturation = Math.max(0, Math.min(100, this.saturation));
    this.value = Math.max(0, Math.min(100, this.value));
    this.drawHSVGrad();
    this.HSVToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  selectHue(y: number) {
    this.hue = Math.round(y / this.hueHeight * 360);
    this.hue = Math.max(0, Math.min(360, this.hue));
    this.drawHueGrad();
    this.drawHSVGrad();
    this.HSVToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  handleMouseDown(e: PointerEvent) {
    e.preventDefault();
    // Only handle if no other pointer is active
    if (this.activePointerId === null) {
      this.activePointerId = e.pointerId;
      this.clicked = true;
      this.selectSL(e.offsetX, e.offsetY);
    }
  }

  handleHueMouseDown(e: PointerEvent) {
    e.preventDefault();
    // Only handle if no other pointer is active
    if (this.activePointerId === null) {
      this.activePointerId = e.pointerId;
      this.hueClicked = true;
      this.selectHue(e.offsetY);
    }
  }

  handleMouseMove(e: PointerEvent) {
    // Only handle move events from the active pointer
    if (e.pointerId !== this.activePointerId) return;
    
    if (this.clicked) {
      e.preventDefault();
      const rect = this.target.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      const constrainedX = Math.max(0, Math.min(this.width, canvasX));
      const constrainedY = Math.max(0, Math.min(this.height, canvasY));
      
      this.selectSL(constrainedX, constrainedY);
    } else if (this.hueClicked) {
      e.preventDefault();
      const rect = this.hueCanvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;
      
      const constrainedY = Math.max(0, Math.min(this.hueHeight, canvasY));
      this.selectHue(constrainedY);
    }
  }

  handleMouseUp(e: PointerEvent) {
    // Only handle up events from the active pointer
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

  updateFromInputs(r: number, g: number, b: number) {
    this.red = r;
    this.green = g;
    this.blue = b;
    this.RGBToHex();
    this.RGBToHSV();
    this.drawHueGrad();
    this.drawHSVGrad();
    this.updateColor();
  }

  RGBToHSV() {
    const r = this.red / 255;
    const g = this.green / 255;
    const b = this.blue / 255;

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
  }
}

export default function ColorPicker({ color, onChange }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const pickerRef = useRef<Picker | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [localColor, setLocalColor] = useState(color);
  const [originalColor, setOriginalColor] = useState(color);
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });
  const [hsvValues, setHsvValues] = useState({ h: 0, s: 0, v: 0 });
  const [position, setPosition] = useState({ top: 100, left: 50 });

  useEffect(() => {
    if (isOpen && canvasRef.current && hueCanvasRef.current) {
      try {
        pickerRef.current = new Picker(
          canvasRef.current, 
          hueCanvasRef.current,
          300, 300, 30, 300, 
          color,
          (newColor) => {
            setLocalColor(newColor);
            // Use setTimeout to break the synchronous update loop
            setTimeout(() => onChange(newColor), 0);
            if (pickerRef.current) {
              setRgbValues({ 
                r: pickerRef.current.red, 
                g: pickerRef.current.green, 
                b: pickerRef.current.blue 
              });
              setHsvValues({ 
                h: pickerRef.current.hue, 
                s: pickerRef.current.saturation, 
                v: pickerRef.current.value 
              });
            }
          }
        );
        
        if (pickerRef.current) {
          setRgbValues({ 
            r: pickerRef.current.red, 
            g: pickerRef.current.green, 
            b: pickerRef.current.blue 
          });
          setHsvValues({ 
            h: pickerRef.current.hue, 
            s: pickerRef.current.saturation, 
            v: pickerRef.current.value 
          });
        }
      } catch (error) {
      }
    }
    
    return () => {
      if (pickerRef.current) {
        pickerRef.current.destroy();
      }
    };
  }, [isOpen]); // Removed color and onChange from dependencies

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (isOpen && buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        const pickerElement = document.querySelector('.color-picker-popup');
        if (pickerElement && !pickerElement.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [isOpen]);

  const handleRGBChange = (component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    if (pickerRef.current) {
      pickerRef.current.updateFromInputs(newRgb.r, newRgb.g, newRgb.b);
      setLocalColor(pickerRef.current.hexcode);
      setTimeout(() => onChange(pickerRef.current!.hexcode), 0); // Break update loop
      setHsvValues({ 
        h: pickerRef.current.hue, 
        s: pickerRef.current.saturation, 
        v: pickerRef.current.value 
      });
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (buttonRef.current && !isOpen) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPosition({
              top: rect.top, // Align to top of swatch
              left: rect.left - 600 // Position further left from the swatch
            });
            setOriginalColor(color);
            setLocalColor(color);
          }
          
          setIsOpen(!isOpen);
        }}
        className="h-[25px] w-[25px] text-base hover:opacity-80 transition-opacity cursor-pointer border-2 border-[#D9D9D9] outline-none"
        style={{ backgroundColor: color }}
        title="Color Picker"
      />
      
      {isOpen && (
        <div className="fixed z-[9999] bg-[#31313A] rounded-lg shadow-lg color-picker-popup" style={{ top: `${position.top}px`, left: `${position.left}px`, padding: '16px' }}>
          <div className="flex" style={{ gap: '16px' }}>
            {/* Main color area and hue slider */}
            <div className="flex" style={{ gap: '8px' }}>
              <canvas
                ref={canvasRef}
                className="cursor-crosshair outline-none focus:outline-none"
                width={300}
                height={300}
              />
              <canvas
                ref={hueCanvasRef}
                className="cursor-crosshair outline-none focus:outline-none"
                width={30}
                height={300}
              />
            </div>
            
            {/* Controls */}
            <div style={{ width: '200px', paddingTop: '8px' }}>
              {/* Color swatches - New/Old comparison */}
              <div className="flex justify-center items-center" style={{ gap: '24px', padding: '8px 0', marginBottom: '16px' }}>
                <div className="text-center w-16">
                  <div 
                    className="cursor-pointer rounded"
                    style={{ 
                      backgroundColor: localColor,
                      width: '40px',
                      height: '40px'
                    }}
                    onClick={() => onChange(localColor)}
                    title={`Apply new color: ${localColor}`}
                  />
                  <div className="text-base text-[#D9D9D9] mt-1 w-16 text-center">{localColor}</div>
                </div>
                <div className="text-center w-16">
                  <div 
                    className="cursor-pointer rounded"
                    style={{ 
                      backgroundColor: originalColor,
                      width: '40px',
                      height: '40px'
                    }}
                    onClick={() => {
                      setLocalColor(originalColor);
                      if (pickerRef.current) {
                        pickerRef.current.hexToHSV(originalColor);
                        pickerRef.current.drawHueGrad();
                        pickerRef.current.drawHSVGrad();
                        setRgbValues({ 
                          r: pickerRef.current.red, 
                          g: pickerRef.current.green, 
                          b: pickerRef.current.blue 
                        });
                        setHsvValues({ 
                          h: pickerRef.current.hue, 
                          s: pickerRef.current.saturation, 
                          v: pickerRef.current.value 
                        });
                      }
                    }}
                    title={`Revert to original: ${originalColor}`}
                  />
                  <div className="text-base text-[#D9D9D9] mt-1 w-16 text-center">{originalColor}</div>
                </div>
              </div>
              
              {/* RGB inputs */}
              <div className="grid grid-cols-2 text-base" style={{ gap: '8px', marginBottom: '16px' }}>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">R:</span>
                  <Input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.r}
                    onChange={(e) => handleRGBChange('r', parseInt(e.target.value) || 0)}
                    className="w-[60px]"
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">H:</span>
                  <Input
                    type="number"
                    min="0"
                    max="360"
                    value={hsvValues.h}
                    readOnly
                    className="w-[60px]"
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">G:</span>
                  <Input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.g}
                    onChange={(e) => handleRGBChange('g', parseInt(e.target.value) || 0)}
                    className="w-[60px]"
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">S:</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={hsvValues.s}
                    readOnly
                    className="w-[60px]"
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">B:</span>
                  <Input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.b}
                    onChange={(e) => handleRGBChange('b', parseInt(e.target.value) || 0)}
                    className="w-[60px]"
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-[#D9D9D9] w-6 font-medium">V:</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={hsvValues.v}
                    readOnly
                    className="w-[60px]"
                  />
                </div>
              </div>
              
              {/* Hex input */}
              <div className="flex items-center text-base" style={{ gap: '6px', marginBottom: '8px' }}>
                <span className="text-[#D9D9D9] font-medium w-8">Hex:</span>
                <Input
                  type="text"
                  variant="hex"
                  value={localColor}
                  onChange={(e) => {
                    setLocalColor(e.target.value);
                    setTimeout(() => onChange(e.target.value), 0); // Break update loop
                  }}
                  className="w-8"
                  placeholder="#000000"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}