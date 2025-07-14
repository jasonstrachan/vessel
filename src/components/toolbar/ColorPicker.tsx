import React, { useRef, useEffect, useState } from 'react';

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
  hue: number = 0;
  saturation: number = 0;
  lightness: number = 0;
  red: number = 0;
  green: number = 0;
  blue: number = 0;
  hexcode: string = "#000000";
  oldColor: string;
  onColorChange: (color: string) => void;

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
    
    this.target.width = width;
    this.target.height = height;
    this.hueCanvas.width = hueWidth;
    this.hueCanvas.height = hueHeight;
    
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
    this.hexToHSL(initialColor);
    
    this.init();
  }

  init() {
    this.drawHueGrad();
    this.drawHSLGrad();
    
    // Main canvas events
    this.target.addEventListener("mousedown", (e) => {
      this.handleMouseDown(e);
    });
    
    // Hue canvas events
    this.hueCanvas.addEventListener("mousedown", (e) => {
      this.handleHueMouseDown(e);
    });
    
    window.addEventListener("mousemove", (e) => {
      this.handleMouseMove(e);
    });
    window.addEventListener("mouseup", (e) => {
      this.handleMouseUp(e);
    });
  }

  hexToHSL(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    this.hue = Math.round(h * 360);
    this.saturation = Math.round(s * 100);
    this.lightness = Math.round(l * 100);
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
    this.lightness = Math.round((this.height - y) / this.height * 100);
    this.saturation = Math.max(0, Math.min(100, this.saturation));
    this.lightness = Math.max(0, Math.min(100, this.lightness));
    this.drawHSLGrad();
    this.HSLToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  selectHue(y: number) {
    this.hue = Math.round(y / this.hueHeight * 360);
    this.hue = Math.max(0, Math.min(360, this.hue));
    this.drawHueGrad();
    this.drawHSLGrad();
    this.HSLToRGB();
    this.RGBToHex();
    this.updateColor();
  }

  handleMouseDown(e: MouseEvent) {
    this.clicked = true;
    this.selectSL(e.offsetX, e.offsetY);
  }

  handleHueMouseDown(e: MouseEvent) {
    this.hueClicked = true;
    this.selectHue(e.offsetY);
  }

  handleMouseMove(e: MouseEvent) {
    if (this.clicked) {
      const rect = this.target.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      const constrainedX = Math.max(0, Math.min(this.width, canvasX));
      const constrainedY = Math.max(0, Math.min(this.height, canvasY));
      
      this.selectSL(constrainedX, constrainedY);
    } else if (this.hueClicked) {
      const rect = this.hueCanvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;
      
      const constrainedY = Math.max(0, Math.min(this.hueHeight, canvasY));
      this.selectHue(constrainedY);
    }
  }

  handleMouseUp(e: MouseEvent) {
    this.clicked = false;
    this.hueClicked = false;
  }

  HSLToRGB() {
    const h = this.hue / 360;
    const s = this.saturation / 100;
    const l = this.lightness / 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    this.red = Math.round(r * 255);
    this.green = Math.round(g * 255);
    this.blue = Math.round(b * 255);
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
    this.RGBToHSL();
    this.drawHueGrad();
    this.drawHSLGrad();
    this.updateColor();
  }

  RGBToHSL() {
    const r = this.red / 255;
    const g = this.green / 255;
    const b = this.blue / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    this.hue = Math.round(h * 360);
    this.saturation = Math.round(s * 100);
    this.lightness = Math.round(l * 100);
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
  const [hslValues, setHslValues] = useState({ h: 0, s: 0, l: 0 });
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
              setHslValues({ 
                h: pickerRef.current.hue, 
                s: pickerRef.current.saturation, 
                l: pickerRef.current.lightness 
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
          setHslValues({ 
            h: pickerRef.current.hue, 
            s: pickerRef.current.saturation, 
            l: pickerRef.current.lightness 
          });
        }
      } catch (error) {
        console.error("Failed to initialize color picker:", error);
      }
    }
    
    return () => {
      if (pickerRef.current) {
        window.removeEventListener("mousemove", pickerRef.current.handleMouseMove);
        window.removeEventListener("mouseup", pickerRef.current.handleMouseUp);
      }
    };
  }, [isOpen]); // Removed color and onChange from dependencies

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isOpen && buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        const pickerElement = document.querySelector('.color-picker-popup');
        if (pickerElement && !pickerElement.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleRGBChange = (component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    if (pickerRef.current) {
      pickerRef.current.updateFromInputs(newRgb.r, newRgb.g, newRgb.b);
      setLocalColor(pickerRef.current.hexcode);
      setTimeout(() => onChange(pickerRef.current!.hexcode), 0); // Break update loop
      setHslValues({ 
        h: pickerRef.current.hue, 
        s: pickerRef.current.saturation, 
        l: pickerRef.current.lightness 
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
        className="h-[28px] w-[28px] text-xs rounded hover:opacity-80 transition-opacity cursor-pointer"
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
                className="cursor-crosshair"
                width={300}
                height={300}
              />
              <canvas
                ref={hueCanvasRef}
                className="cursor-crosshair"
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
                  <div className="text-xs text-gray-400 mt-1 w-16 text-center">{localColor}</div>
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
                        pickerRef.current.hexToHSL(originalColor);
                        pickerRef.current.drawHueGrad();
                        pickerRef.current.drawHSLGrad();
                        setRgbValues({ 
                          r: pickerRef.current.red, 
                          g: pickerRef.current.green, 
                          b: pickerRef.current.blue 
                        });
                        setHslValues({ 
                          h: pickerRef.current.hue, 
                          s: pickerRef.current.saturation, 
                          l: pickerRef.current.lightness 
                        });
                      }
                    }}
                    title={`Revert to original: ${originalColor}`}
                  />
                  <div className="text-xs text-gray-400 mt-1 w-16 text-center">{originalColor}</div>
                </div>
              </div>
              
              {/* RGB inputs */}
              <div className="grid grid-cols-2 text-sm" style={{ gap: '8px', marginBottom: '16px' }}>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">R:</span>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.r}
                    onChange={(e) => handleRGBChange('r', parseInt(e.target.value) || 0)}
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">H:</span>
                  <input
                    type="number"
                    min="0"
                    max="360"
                    value={hslValues.h}
                    readOnly
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">G:</span>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.g}
                    onChange={(e) => handleRGBChange('g', parseInt(e.target.value) || 0)}
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">S:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={hslValues.s}
                    readOnly
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">B:</span>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgbValues.b}
                    onChange={(e) => handleRGBChange('b', parseInt(e.target.value) || 0)}
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <span className="text-white w-6 font-medium">L:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={hslValues.l}
                    readOnly
                    className="bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                    style={{ width: '60px', padding: '4px 6px', color: '#FFFFFF' }}
                  />
                </div>
              </div>
              
              {/* Hex input */}
              <div className="flex items-center text-sm" style={{ gap: '6px', marginBottom: '8px' }}>
                <span className="text-white font-medium w-8">Hex:</span>
                <input
                  type="text"
                  value={localColor}
                  onChange={(e) => {
                    setLocalColor(e.target.value);
                    setTimeout(() => onChange(e.target.value), 0); // Break update loop
                  }}
                  className="flex-1 bg-[#404040] border border-gray-600 text-white text-sm rounded" 
                  style={{ padding: '4px 6px', color: '#FFFFFF' }}
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