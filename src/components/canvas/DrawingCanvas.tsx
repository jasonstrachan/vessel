'use client';

import { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { useP5 } from '@/hooks/useP5';
import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';

export const DrawingCanvas = () => {
  const {
    project,
    currentTool,
    currentLayer,
    brushSettings,
    onionSkinSettings,
    isPlaying,
    setCurrentFrame,
    addUndoAction,
    zoom,
    panX,
    panY,
    setZoom,
    setPan,
  } = useAppStore();

  const p5InstanceRef = useRef<p5 | null>(null);
  const isDrawing = useRef(false);
  const isPanning = useRef(false);
  const isSpacePressed = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const canvasBuffer = useRef<any>(null);
  const layerBuffers = useRef<Map<string, any>>(new Map()); // Store P5 Graphics for each layer
  const [cursorUpdate, setCursorUpdate] = useState(0); // Force cursor updates
  const lastPanUpdate = useRef(0); // Throttle pan updates

  const setup = (p: p5) => {
    p.pixelDensity(1);
    p.noSmooth(); // For pixel-perfect drawing
    p5InstanceRef.current = p;
    
    // Also disable anti-aliasing on the canvas element itself
    const canvas = (p as any).canvas;
    if (canvas) {
      canvas.style.imageRendering = 'pixelated';
      canvas.style.imageRendering = 'crisp-edges'; // Fallback
      canvas.style.imageRendering = '-moz-crisp-edges'; // Firefox
      canvas.style.imageRendering = '-webkit-crisp-edges'; // Safari
    }
    
    // Initialize layer buffers for all layers
    project.layers.forEach(layer => {
      if (!layerBuffers.current.has(layer.id)) {
        const layerGraphics = p.createGraphics(project.width, project.height);
        layerGraphics.pixelDensity(1);
        layerGraphics.noSmooth();
        layerGraphics.background(0, 0, 0, 0); // Transparent background
        layerBuffers.current.set(layer.id, layerGraphics);
        console.log('Created layer buffer for:', layer.name);
      }
    });
    
    // Set main canvas background
    p.background(240); // Light background
    
    console.log('P5 Setup complete, canvas size:', p.width, p.height);
    console.log('Layer buffers created:', layerBuffers.current.size);
  };

  const draw = (p: p5) => {
    // Clear main canvas and composite all visible layers
    p.background(240); // Light background
    
    // Draw all visible layers in order
    project.layers.forEach((layer, index) => {
      if (layer.visible && layerBuffers.current.has(layer.id)) {
        const layerGraphics = layerBuffers.current.get(layer.id);
        p.image(layerGraphics, 0, 0);
      }
    });
  };

  const drawOnionSkin = (p: p5, layer: any, currentFrame: number) => {
    // Draw previous frames
    for (let i = 1; i <= onionSkinSettings.framesBefore; i++) {
      const frameIndex = currentFrame - i;
      if (frameIndex >= 0 && layer.frames[frameIndex]) {
        const opacity = onionSkinSettings.opacity * (1 - (i - 1) / onionSkinSettings.framesBefore);
        p.push();
        p.tint(255, 0, 0, opacity * 255); // Red tint for previous frames
        p.image(layer.frames[frameIndex], 0, 0);
        p.pop();
      }
    }
    
    // Draw next frames
    for (let i = 1; i <= onionSkinSettings.framesAfter; i++) {
      const frameIndex = currentFrame + i;
      if (frameIndex < layer.frames.length && layer.frames[frameIndex]) {
        const opacity = onionSkinSettings.opacity * (1 - (i - 1) / onionSkinSettings.framesAfter);
        p.push();
        p.tint(0, 255, 0, opacity * 255); // Green tint for next frames
        p.image(layer.frames[frameIndex], 0, 0);
        p.pop();
      }
    }
  };


  // Disable p5 mouse events - using DOM events instead
  const mousePressed = undefined;
  const mouseDragged = undefined; 
  const mouseReleased = undefined;

  const floodFill = (graphics: any, x: number, y: number, fillColor: string) => {
    const targetColor = graphics.get(x, y);
    const fillColorArray = graphics.color(fillColor);
    
    // Don't fill if clicking on the same color
    if (colorsEqual(targetColor, fillColorArray)) return;
    
    const stack = [{x: Math.floor(x), y: Math.floor(y)}];
    const visited = new Set<string>();
    
    graphics.loadPixels();
    
    while (stack.length > 0) {
      const {x: currentX, y: currentY} = stack.pop()!;
      const key = `${currentX},${currentY}`;
      
      if (visited.has(key)) continue;
      if (currentX < 0 || currentX >= graphics.width || currentY < 0 || currentY >= graphics.height) continue;
      
      const currentColor = graphics.get(currentX, currentY);
      if (!colorsEqual(currentColor, targetColor)) continue;
      
      visited.add(key);
      
      // Set pixel color
      const index = (currentY * graphics.width + currentX) * 4;
      graphics.pixels[index] = graphics.red(fillColorArray);
      graphics.pixels[index + 1] = graphics.green(fillColorArray);
      graphics.pixels[index + 2] = graphics.blue(fillColorArray);
      graphics.pixels[index + 3] = 255;
      
      // Add adjacent pixels to stack
      stack.push({x: currentX + 1, y: currentY});
      stack.push({x: currentX - 1, y: currentY});
      stack.push({x: currentX, y: currentY + 1});
      stack.push({x: currentX, y: currentY - 1});
    }
    
    graphics.updatePixels();
  };

  const colorsEqual = (color1: any, color2: any) => {
    return p5InstanceRef.current?.red(color1) === p5InstanceRef.current?.red(color2) &&
           p5InstanceRef.current?.green(color1) === p5InstanceRef.current?.green(color2) &&
           p5InstanceRef.current?.blue(color1) === p5InstanceRef.current?.blue(color2);
  };

  const performDrawAction = (p: p5, isDragging: boolean, currentMouseX?: number, currentMouseY?: number) => {
    // Use provided coordinates or calculate them
    const mouseX = currentMouseX !== undefined ? currentMouseX : (p.mouseX - panX) / zoom;
    const mouseY = currentMouseY !== undefined ? currentMouseY : (p.mouseY - panY) / zoom;
    
    // Get the active layer buffer
    const activeLayer = project.layers[currentLayer];
    if (!activeLayer || !layerBuffers.current.has(activeLayer.id)) {
      console.log('❌ No active layer buffer found');
      return;
    }
    
    const layerGraphics = layerBuffers.current.get(activeLayer.id);
    console.log('🎯 Drawing on layer:', activeLayer.name, 'isDragging:', isDragging, 'currentTool:', currentTool);
    
    switch (currentTool) {
      case Tool.BRUSH:
        console.log('🖌️ REGULAR BRUSH - pixelPerfect:', brushSettings.pixelPerfect);
        // Convert hex color to RGB with opacity
        const color = layerGraphics.color(brushSettings.color);
        
        // Regular brush respects pixel perfect setting
        if (brushSettings.pixelPerfect) {
          console.log('🔲 Using noSmooth() for pixel perfect');
          layerGraphics.noSmooth();
        } else {
          console.log('🔵 Using smooth() for anti-aliased');
          layerGraphics.smooth();
        }
        
        if (isDragging && lastPos.current !== null) {
          if (brushSettings.pixelPerfect) {
            // Pixel perfect mode: draw squares instead of lines
            console.log('🔲 Drawing PIXEL LINE from', lastPos.current, 'to', mouseX, mouseY, 'size:', brushSettings.size);
            layerGraphics.noStroke();
            const fillColor = layerGraphics.color(brushSettings.color);
            fillColor.setAlpha(brushSettings.opacity * 255);
            layerGraphics.fill(fillColor);
            
            // Draw squares along the line path
            const distance = Math.sqrt(
              Math.pow(mouseX - lastPos.current.x, 2) + 
              Math.pow(mouseY - lastPos.current.y, 2)
            );
            
            const steps = Math.max(1, Math.floor(distance / 2));
            for (let i = 0; i <= steps; i++) {
              const t = i / Math.max(1, steps);
              const x = Math.floor(lastPos.current.x + (mouseX - lastPos.current.x) * t);
              const y = Math.floor(lastPos.current.y + (mouseY - lastPos.current.y) * t);
              
              layerGraphics.rect(
                x - Math.floor(brushSettings.size/2), 
                y - Math.floor(brushSettings.size/2), 
                Math.floor(brushSettings.size), 
                Math.floor(brushSettings.size)
              );
            }
          } else {
            // Regular smooth line
            console.log('🖍️ Drawing LINE from', lastPos.current, 'to', mouseX, mouseY, 'size:', brushSettings.size);
            layerGraphics.stroke(color);
            layerGraphics.strokeWeight(brushSettings.size);
            layerGraphics.strokeCap(layerGraphics.ROUND);
            // Apply opacity to the stroke
            const strokeColor = layerGraphics.color(brushSettings.color);
            strokeColor.setAlpha(brushSettings.opacity * 255);
            layerGraphics.stroke(strokeColor);
            layerGraphics.line(lastPos.current.x, lastPos.current.y, mouseX, mouseY);
          }
        } else {
          if (brushSettings.pixelPerfect) {
            // Pixel perfect dot: draw a square
            console.log('🔲 Drawing PIXEL DOT at', mouseX, mouseY, 'size:', brushSettings.size);
            layerGraphics.noStroke();
            const fillColor = layerGraphics.color(brushSettings.color);
            fillColor.setAlpha(brushSettings.opacity * 255);
            layerGraphics.fill(fillColor);
            const pixelX = Math.floor(mouseX - brushSettings.size/2);
            const pixelY = Math.floor(mouseY - brushSettings.size/2);
            layerGraphics.rect(pixelX, pixelY, Math.floor(brushSettings.size), Math.floor(brushSettings.size));
          } else {
            // Regular smooth circle
            console.log('🔴 Drawing DOT at', mouseX, mouseY, 'size:', brushSettings.size);
            layerGraphics.noStroke();
            const fillColor = layerGraphics.color(brushSettings.color);
            fillColor.setAlpha(brushSettings.opacity * 255);
            layerGraphics.fill(fillColor);
            layerGraphics.circle(mouseX, mouseY, brushSettings.size);
          }
        }
        break;
        
      case Tool.PIXEL_BRUSH:
        console.log('🔲 PIXEL BRUSH ACTIVATED!', { currentTool, isDragging, mouseX, mouseY });
        // Pixel brush with hard edges - always pixel perfect
        layerGraphics.noSmooth();
        
        const pixelColor = layerGraphics.color(brushSettings.color);
        layerGraphics.noStroke();
        layerGraphics.fill(pixelColor);
        
        if (isDragging && lastPos.current !== null) {
          console.log('🔲 Drawing PIXEL LINE from', lastPos.current, 'to', mouseX, mouseY, 'size:', brushSettings.size);
          
          // Simple pixel line drawing - draw squares along the path
          const distance = Math.sqrt(
            Math.pow(mouseX - lastPos.current.x, 2) + 
            Math.pow(mouseY - lastPos.current.y, 2)
          );
          
          const steps = Math.max(1, Math.floor(distance));
          for (let i = 0; i <= steps; i++) {
            const t = i / Math.max(1, steps);
            const x = Math.floor(lastPos.current.x + (mouseX - lastPos.current.x) * t);
            const y = Math.floor(lastPos.current.y + (mouseY - lastPos.current.y) * t);
            
            // Draw pixel-perfect square
            layerGraphics.rect(
              x - Math.floor(brushSettings.size/2), 
              y - Math.floor(brushSettings.size/2), 
              Math.floor(brushSettings.size), 
              Math.floor(brushSettings.size)
            );
          }
        } else {
          // Draw a pixel-perfect square for single clicks
          console.log('🔲 Drawing PIXEL DOT at', mouseX, mouseY, 'size:', brushSettings.size);
          const pixelX = Math.floor(mouseX - brushSettings.size/2);
          const pixelY = Math.floor(mouseY - brushSettings.size/2);
          layerGraphics.rect(pixelX, pixelY, Math.floor(brushSettings.size), Math.floor(brushSettings.size));
        }
        break;
        
      case Tool.ERASER:
        layerGraphics.erase();
        if (isDragging && lastPos.current !== null) {
          layerGraphics.strokeWeight(brushSettings.size);
          layerGraphics.strokeCap(layerGraphics.ROUND);
          layerGraphics.line(lastPos.current.x, lastPos.current.y, mouseX, mouseY);
        } else {
          layerGraphics.noStroke();
          layerGraphics.fill(255);
          layerGraphics.circle(mouseX, mouseY, brushSettings.size);
        }
        layerGraphics.noErase();
        break;
        
      case Tool.FILL:
        floodFill(layerGraphics, mouseX, mouseY, brushSettings.color);
        break;
        
      case Tool.CLEAR:
        layerGraphics.clear();
        layerGraphics.background(0, 0, 0, 0); // Reset to transparent
        break;
    }
  };

  const drawDottedLine = (p: p5) => {
    if (!isDrawing.current || !lastPos.current) return;
    
    const dx = p.mouseX - lastPos.current.x;
    const dy = p.mouseY - lastPos.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < brushSettings.dottedStyle.spacing) return;
    
    const steps = Math.floor(distance / brushSettings.dottedStyle.spacing);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = lastPos.current.x + dx * t;
      const y = lastPos.current.y + dy * t;
      
      // Draw dash
      const dashLength = brushSettings.dottedStyle.dashLength;
      p.line(x, y, x + dashLength, y);
    }
  };

  // Keyboard events now handled globally

  // No longer needed - using DOM event handler instead
  const mouseWheel = undefined;

  // Use direct DOM event handling instead of p5 events
  const { containerRef, p5Instance } = useP5({
    setup,
    draw,
    mousePressed: undefined, // Using DOM events instead
    mouseDragged: undefined, // Using DOM events instead  
    mouseReleased: undefined, // Using DOM events instead
    keyPressed: undefined, // Using global keyboard events instead
    keyReleased: undefined, // Using global keyboard events instead
    mouseWheel: undefined, // Disable p5 mouseWheel to avoid conflicts
    width: project.width,
    height: project.height,
  });

  // Apply zoom and pan to canvas
  useEffect(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) {
        // Apply transform with translate first, then scale
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvas.style.transformOrigin = '0 0';
        
        // Force pixel-perfect rendering
        canvas.style.imageRendering = 'pixelated';
        canvas.style.imageRendering = 'crisp-edges';
        canvas.style.imageRendering = '-moz-crisp-edges';
        canvas.style.imageRendering = '-webkit-crisp-edges';
        console.log('🎨 Applied canvas styles:', canvas.style.imageRendering);
      }
    }
  }, [zoom, panX, panY]);

  // Add direct DOM event listener 
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelEvent = (event: WheelEvent) => {
      // Only handle wheel events on the canvas container
      if (!container.contains(event.target as Node)) return;
      
      event.preventDefault();
      event.stopPropagation();
      
      const zoomFactor = 0.05; // Smaller factor for smoother zoom
      const wheelDelta = event.deltaY;
      
      // Use a more reliable approach to get current zoom
      const state = useAppStore.getState();
      const currentZoom = state.zoom;
      const newZoom = currentZoom * (wheelDelta > 0 ? (1 - zoomFactor) : (1 + zoomFactor));
      const constrainedZoom = Math.max(0.1, Math.min(10, newZoom));
      
      // Reduced logging for performance
      // console.log('Zoom:', { wheelDelta, currentZoom: currentZoom.toFixed(3), newZoom: newZoom.toFixed(3), constrainedZoom: constrainedZoom.toFixed(3) });
      
      if (Math.abs(constrainedZoom - currentZoom) > 0.001) {
        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        setZoom(constrainedZoom, mouseX, mouseY);
      }
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
    };
  }, [setZoom]);

  // Add global keyboard event listeners for spacebar
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!isSpacePressed.current) {
          isSpacePressed.current = true;
          setCursorUpdate(prev => prev + 1);
          console.log('Global: Spacebar pressed - pan mode enabled');
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        isSpacePressed.current = false;
        isPanning.current = false;
        lastPanPos.current = null;
        setCursorUpdate(prev => prev + 1);
        console.log('Global: Spacebar released - pan mode disabled');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Add DOM mouse events for panning
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (isSpacePressed.current) {
        // Handle panning
        event.preventDefault();
        isPanning.current = true;
        lastPanPos.current = { x: event.clientX, y: event.clientY };
        setCursorUpdate(prev => prev + 1);
        console.log('DOM: Started panning at', event.clientX, event.clientY);
      } else {
        // Handle drawing
        event.preventDefault();
        
        // Get coordinates relative to container (not transformed canvas)
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const rect = container.getBoundingClientRect();
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        
        // Transform to canvas coordinates (inverse of CSS transform)
        const mouseX = (rawX - panX) / zoom;
        const mouseY = (rawY - panY) / zoom;
        
        console.log('🎨 DOM Drawing start:', { rawX, rawY, mouseX, mouseY, panX, panY, zoom, currentTool });
        
        // Check bounds
        if (mouseX < 0 || mouseX > project.width || mouseY < 0 || mouseY > project.height) {
          console.log('Mouse outside canvas bounds');
          return;
        }
        
        isDrawing.current = true;
        lastPos.current = { x: mouseX, y: mouseY };
        
        // Draw initial dot
        if (p5InstanceRef.current) {
          console.log('✅ p5 instance available, calling performDrawAction');
          performDrawAction(p5InstanceRef.current, false, mouseX, mouseY);
        } else {
          console.log('❌ p5 instance not available');
        }
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isPanning.current && lastPanPos.current && isSpacePressed.current) {
        // Handle panning
        event.preventDefault();
        
        // Throttle pan updates to every 16ms (~60fps max)
        const now = Date.now();
        if (now - lastPanUpdate.current < 16) return;
        lastPanUpdate.current = now;
        
        const deltaX = event.clientX - lastPanPos.current.x;
        const deltaY = event.clientY - lastPanPos.current.y;
        
        const newPanX = panX + deltaX;
        const newPanY = panY + deltaY;
        setPan(newPanX, newPanY);
        
        lastPanPos.current = { x: event.clientX, y: event.clientY };
      } else if (isDrawing.current && lastPos.current) {
        // Handle drawing
        event.preventDefault();
        
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const rect = container.getBoundingClientRect();
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        
        // Transform to canvas coordinates (inverse of CSS transform)
        const mouseX = (rawX - panX) / zoom;
        const mouseY = (rawY - panY) / zoom;
        
        console.log('🖌️ DOM Drawing drag:', { rawX, rawY, mouseX, mouseY });
        
        // Draw line
        if (p5InstanceRef.current) {
          performDrawAction(p5InstanceRef.current, true, mouseX, mouseY);
        } else {
          console.log('❌ p5 instance not available for drag');
        }
        
        lastPos.current = { x: mouseX, y: mouseY };
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (isPanning.current) {
        event.preventDefault();
        isPanning.current = false;
        lastPanPos.current = null;
        setCursorUpdate(prev => prev + 1);
        console.log('DOM: Stopped panning');
      } else if (isDrawing.current) {
        event.preventDefault();
        isDrawing.current = false;
        lastPos.current = null;
        setCursorUpdate(prev => prev + 1);
        console.log('DOM: Stopped drawing');
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panX, panY, setPan, zoom, project.width, project.height, currentTool, brushSettings]);

  // Canvas should be managed by useP5 hook only

  // Create layer buffers when layers are added
  useEffect(() => {
    if (!p5InstanceRef.current) return;
    
    project.layers.forEach(layer => {
      if (!layerBuffers.current.has(layer.id)) {
        const layerGraphics = p5InstanceRef.current!.createGraphics(project.width, project.height);
        layerGraphics.pixelDensity(1);
        layerGraphics.noSmooth();
        layerGraphics.background(0, 0, 0, 0); // Transparent background
        layerBuffers.current.set(layer.id, layerGraphics);
        console.log('Created layer buffer for new layer:', layer.name);
      }
    });
    
    // Remove buffers for deleted layers
    const existingLayerIds = new Set(project.layers.map(l => l.id));
    for (const [layerId, buffer] of layerBuffers.current.entries()) {
      if (!existingLayerIds.has(layerId)) {
        layerBuffers.current.delete(layerId);
        console.log('Removed layer buffer for deleted layer:', layerId);
      }
    }
  }, [project.layers]);

  // Animation loop (simplified for now)
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      // Simple frame counter for now
      const currentFrame = useAppStore.getState().project.currentFrame;
      setCurrentFrame((currentFrame + 1) % 10);
    }, 1000 / project.fps);
    
    return () => clearInterval(interval);
  }, [isPlaying, project.fps, setCurrentFrame]);

  const getCursorStyle = () => {
    if (isSpacePressed.current) {
      return isPanning.current ? 'grabbing' : 'grab';
    }
    
    switch (currentTool) {
      case Tool.BRUSH:
      case Tool.PIXEL_BRUSH:
        return 'crosshair';
      case Tool.ERASER:
        return 'grab';
      case Tool.FILL:
        return 'pointer';
      default:
        return 'default';
    }
  };

  const clearCanvas = () => {
    if (p5InstanceRef.current) {
      p5InstanceRef.current.clear();
      p5InstanceRef.current.background(240);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950">
      {/* Canvas Container */}
      <div className="relative w-full h-full">
        {/* Canvas Border */}
        <div className="relative w-full h-full overflow-hidden bg-white">
          <div 
            ref={containerRef}
            style={{
              cursor: getCursorStyle(),
            }}
            className="block"
          />
          
          {/* Canvas Info Overlay */}
          <div className="absolute top-2 left-2 bg-slate-900/80 backdrop-blur-sm text-slate-100 px-2 py-1 rounded text-xs font-mono">
            {project.width} × {project.height}
          </div>
          
          {/* Zoom Info */}
          <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-sm text-slate-100 px-2 py-1 rounded text-xs font-mono">
            {Math.round(zoom * 100)}%
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button 
            onClick={clearCanvas}
            className="px-3 py-2 bg-slate-800/90 hover:bg-slate-700/90 text-slate-100 rounded-lg text-sm font-medium transition-all duration-200 backdrop-blur-sm border border-slate-600"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};