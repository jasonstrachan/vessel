import React, { useRef, useEffect, useCallback, useState } from 'react';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  className?: string;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

function hexToHsv(hex: string): HSV {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  
  return { h, s: s * 100, v: v * 100 };
}

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;
  
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  
  let r = 0, g = 0, b = 0;
  
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }
  
  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);
  
  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

export default function ColorPicker({ color, onChange, className = '' }: ColorPickerProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDraggingHue, setIsDraggingHue] = useState(false);
  
  const hsv = hexToHsv(color);
  const [currentHsv, setCurrentHsv] = useState(hsv);
  
  // Cache for SV gradient
  const svImageDataCache = useRef<Map<number, ImageData>>(new Map());
  
  const drawSVCanvas = useCallback((hue: number) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Check cache first
    const cacheKey = Math.round(hue);
    let imageData = svImageDataCache.current.get(cacheKey);
    
    if (!imageData) {
      imageData = ctx.createImageData(width, height);
      const data = imageData.data;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const s = (x / width) * 100;
          const v = ((height - y) / height) * 100;
          const hex = hsvToHex(hue, s, v);
          
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          
          const index = (y * width + x) * 4;
          data[index] = r;
          data[index + 1] = g;
          data[index + 2] = b;
          data[index + 3] = 255;
        }
      }
      
      // Limit cache size
      if (svImageDataCache.current.size > 20) {
        const firstKey = svImageDataCache.current.keys().next().value;
        if (firstKey !== undefined) {
          svImageDataCache.current.delete(firstKey);
        }
      }
      svImageDataCache.current.set(cacheKey, imageData);
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Draw selection indicator
    const x = (currentHsv.s / 100) * width;
    const y = ((100 - currentHsv.v) / 100) * height;
    
    ctx.strokeStyle = currentHsv.v > 50 ? '#000' : '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.stroke();
  }, [currentHsv.s, currentHsv.v]);
  
  const drawHueCanvas = useCallback(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#ff0000');
    gradient.addColorStop(1/6, '#ffff00');
    gradient.addColorStop(2/6, '#00ff00');
    gradient.addColorStop(3/6, '#00ffff');
    gradient.addColorStop(4/6, '#0000ff');
    gradient.addColorStop(5/6, '#ff00ff');
    gradient.addColorStop(1, '#ff0000');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw selection indicator
    const y = (currentHsv.h / 360) * canvas.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, y - 2, canvas.width, 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(2, y - 1, canvas.width - 4, 2);
  }, [currentHsv.h]);
  
  useEffect(() => {
    const newHsv = hexToHsv(color);
    setCurrentHsv(newHsv);
  }, [color]);
  
  useEffect(() => {
    drawSVCanvas(currentHsv.h);
    drawHueCanvas();
  }, [drawSVCanvas, drawHueCanvas, currentHsv.h]);
  
  const updateColor = useCallback((newHsv: HSV) => {
    const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setCurrentHsv(newHsv);
    onChange(hex);
  }, [onChange]);
  
  const handleSVPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    
    canvas.setPointerCapture(e.pointerId);
    setIsPointerDown(true);
    
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
    
    const s = (x / canvas.width) * 100;
    const v = ((canvas.height - y) / canvas.height) * 100;
    
    updateColor({ ...currentHsv, s, v });
  }, [currentHsv, updateColor]);
  
  const handleSVPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPointerDown) return;
    
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
    
    const s = (x / canvas.width) * 100;
    const v = ((canvas.height - y) / canvas.height) * 100;
    
    updateColor({ ...currentHsv, s, v });
  }, [isPointerDown, currentHsv, updateColor]);
  
  const handleSVPointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    
    canvas.releasePointerCapture(e.pointerId);
    setIsPointerDown(false);
  }, []);
  
  const handleHuePointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    
    canvas.setPointerCapture(e.pointerId);
    setIsDraggingHue(true);
    
    const rect = canvas.getBoundingClientRect();
    const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
    const h = (y / canvas.height) * 360;
    
    updateColor({ ...currentHsv, h });
  }, [currentHsv, updateColor]);
  
  const handleHuePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingHue) return;
    
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
    const h = (y / canvas.height) * 360;
    
    updateColor({ ...currentHsv, h });
  }, [isDraggingHue, currentHsv, updateColor]);
  
  const handleHuePointerUp = useCallback((e: React.PointerEvent) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    
    canvas.releasePointerCapture(e.pointerId);
    setIsDraggingHue(false);
  }, []);
  
  return (
    <div className={`flex items-start justify-center gap-0 ${className}`}>
      <canvas
        ref={svCanvasRef}
        width={240}
        height={240}
        className="border border-gray-300 cursor-crosshair"
        onPointerDown={handleSVPointerDown}
        onPointerMove={handleSVPointerMove}
        onPointerUp={handleSVPointerUp}
        style={{ touchAction: 'none' }}
      />
      <canvas
        ref={hueCanvasRef}
        width={20}
        height={240}
        className="border border-gray-300 cursor-pointer"
        onPointerDown={handleHuePointerDown}
        onPointerMove={handleHuePointerMove}
        onPointerUp={handleHuePointerUp}
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}