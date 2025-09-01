import React from 'react';
import type { EventHandlerDependencies, PointerHandlers } from '../utils/types';
import { BrushShape } from '../../../types';
import { floodFill } from '../../../utils/floodFill';
import { detectWacomIssues, testWacomPressure } from '../../../utils/detectWacom';

export const createPointerHandlers = (deps: EventHandlerDependencies): PointerHandlers => {
  const {
    canvasRef,
    overlayCanvasRef,
    compositeCanvasRef,
    isBusyRef,
    isMouseDownRef,
    isSpacePressedRef,
    drawAnimationFrameRef,
    pointerMoveThrottled,
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    setSelectionBounds,
    clearSelection,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    saveCanvasState,
    updateLayer,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    setCursorStyle,
    setShowBrushCursor,
    setMousePosition,
    updateFloatingPastePosition,
    interaction,
    stateMachine,
    pan,
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    sampleColorsAlongLine,
    getMousePos,
    compositeCanvasDirtyRef,
    setNeedsRedraw
  } = deps;

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Track that pointer is down
    isMouseDownRef.current = true;
    
    // If the app is busy, ignore this pointer event completely
    if (isBusyRef.current) {
      isMouseDownRef.current = false; // Clear ref in case pointerup is missed
      return;
    }
    
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    // Capture pointer for consistent events even when pointer moves outside canvas
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }
    
    // Test Wacom functionality
    const wacomTest = testWacomPressure(event);
    if (!wacomTest.isWorking && tools.brushSettings.pressureEnabled) {
      console.warn('[WACOM ISSUE]', wacomTest.details);
      const issues = detectWacomIssues();
      if (issues.solutions.length > 0) {
        console.log('[WACOM SOLUTIONS]:', issues.solutions.join('\n'));
      }
    }
    
    // SIMPLIFIED PANNING: Just check if space is pressed
    if (isSpacePressedRef.current) {
      pan.startPan(pointerPos.x, pointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      return; // Skip everything else - we're panning
    }
    
    // Middle or right click - skip
    if (event.button === 1 || event.button === 2) {
      return;
    }
    
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(pointerPos.x, pointerPos.y, scale);
    
    // Check the state BEFORE dispatching - this is critical!
    const currentMode = stateMachine.state.mode;
    
    // Dispatch to state machine with SCREEN position for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: pointerPos,  // Use screen coordinates, not world
      tool: tools.currentTool,
      pressure
    });
    
    // --- PROPER FIX: Block clicks outside canvas bounds ---
    if (project) {
      if (worldPos.x < 0 || worldPos.x > project.width || 
          worldPos.y < 0 || worldPos.y > project.height) {
        return; // Don't start any action if click is out of bounds
      }
    }
    
    // For simple drawing mode, use the existing drawing handlers
    // Use the currentMode captured BEFORE dispatch!
    if (currentMode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON) {
      
      // Use the existing drawing system with brush engine
      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startDrawing(worldPos, pressure);
      return;
    }
    
    // Handle left click
    if (event.button === 0) {
      // Check if clicking on floating paste to drag it
      if (floatingPaste) {
        const pasteX = floatingPaste.position.x;
        const pasteY = floatingPaste.position.y;
        const pasteWidth = floatingPaste.width;
        const pasteHeight = floatingPaste.height;
        
        // Check if click is within floating paste bounds
        if (worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
            worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight) {
          setIsDraggingFloatingPaste(true);
          floatingPasteDragStart.current = worldPos;
          floatingPasteOriginalPos.current = { ...floatingPaste.position };
          setCursorStyle('move');
          return;
        }
      }
      
      // Handle fill tool
      if (tools.currentTool === 'fill') {
        // Get the active layer
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer || !activeLayer.imageData) return;
        
        // Parse fill color - handle both hex and rgb formats
        const fillColor = tools.brushSettings.color;
        let r = 0, g = 0, b = 0;
        
        if (fillColor.startsWith('#')) {
          // Handle hex color
          const hex = fillColor.slice(1);
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        } else if (fillColor.startsWith('rgb')) {
          // Handle rgb/rgba color
          const matches = fillColor.match(/\d+/g);
          if (matches) {
            [r, g, b] = matches.map(Number);
          }
        }
        
        // Perform flood fill on the active layer's image data
        const filledImageData = floodFill(
          activeLayer.imageData,
          Math.floor(worldPos.x),
          Math.floor(worldPos.y),
          { r, g, b, a: 255 },
          {
            threshold: tools.fillSettings.threshold,
            contiguous: tools.fillSettings.contiguous
          }
        );
        
        // Update the layer with the filled image data
        if (activeLayerId) {
          updateLayer(activeLayerId, { imageData: filledImageData });
        }
        
        // Save state for undo
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project?.width || 1920;
        tempCanvas.height = project?.height || 1080;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.putImageData(filledImageData, 0, 0);
          saveCanvasState(tempCanvas, 'fill', 'Flood fill');
        }
        
        return;
      }
      
      // Handle selection tool
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
        interaction.dispatch({ type: 'SELECTION_START' });
        interaction.refs.selectionStart.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        if (tools.currentTool === 'custom') {
          setShowBrushCursor(false); // Hide brush cursor when making custom brush selection
        }
        return;
      }
      
      // Clear selection when clicking outside of selected area (for any other tool)
      if (selectionStart && selectionEnd) {
        const minX = Math.min(selectionStart.x, selectionEnd.x);
        const maxX = Math.max(selectionStart.x, selectionEnd.x);
        const minY = Math.min(selectionStart.y, selectionEnd.y);
        const maxY = Math.max(selectionStart.y, selectionEnd.y);
        
        // Check if click is outside selection bounds
        if (worldPos.x < minX || worldPos.x > maxX || worldPos.y < minY || worldPos.y > maxY) {
          clearSelection();
        }
      }
      
      // Handle rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        const result = toolStateMachine.handleRectangleGradientMouseDown(worldPos);
        if (result === 'finalize') {
          // This click finalizes the width - draw the rectangle
          const currentRectState = toolStateMachine.rectangleBrushState;
          
          drawingHandlers.initDrawingCanvas();
          const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
          
          if (drawCtx && brushEngine) {
            const dx = currentRectState.endPos.x - currentRectState.startPos.x;
            const dy = currentRectState.endPos.y - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - currentRectState.startPos.x;
              const toMouseY = worldPos.y - currentRectState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2;
              
              // Sample colors along the rectangle length
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                numColors
              );
              
              // Draw the rectangle gradient (this is final, not preview)
              brushEngine.drawRectangleGradient(
                drawCtx,
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                width,  // Use the calculated width, not currentRectState.width
                sampledColors.length > 0 ? sampledColors : [tools.brushSettings.color],
                false  // false = not preview, this is the final draw
              );
              
              drawingHandlers.drawingCanvasHasContent.current = true;
              
              // Mark composite as dirty BEFORE finalization
              compositeCanvasDirtyRef.current = true;
              
              // Finalize the drawing
              drawingHandlers.finalizeDrawing().then(() => {
                // Signal that finalization is complete
                stateMachine.finalizationComplete();
                
                // Force immediate composite regeneration after layer update
                if (compositeCanvasRef.current && project) {
                  compositeLayersToCanvas(compositeCanvasRef.current);
                  setCurrentOffscreenCanvas(compositeCanvasRef.current);
                  compositeCanvasDirtyRef.current = false;
                }
                
                // Trigger redraw after finalization
                setNeedsRedraw(prev => prev + 1);
              });
            }
          }
          
          // Clear the overlay canvas
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        } else if (result === true) {
          interaction.dispatch({ type: 'DRAWING_START', mode: 'definingLength' });
        }
        return;
      }
      
      // Handle polygon gradient or contour polygon
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon) {
        if (toolStateMachine.handlePolygonGradientMouseDown(worldPos)) {
          interaction.dispatch({ type: 'DRAWING_START' });
        }
        return;
      }
      
      // Normal brush or shape mode
      // BUT ONLY if we're not in pan mode and NOT using gradient/contour tools!
      if (currentMode === 'IDLE' && !toolStateMachine.isRectangleGradient && !toolStateMachine.isPolygonGradient && !toolStateMachine.isContourPolygon) {
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        if (tools.shapeMode) {
          drawingHandlers.startShapeDrawing(worldPos, pressure);
        } else {
          drawingHandlers.startDrawing(worldPos, pressure);
        }
      }
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Throttle to 120fps max
    const now = performance.now();
    if (now - pointerMoveThrottled.current < 8) return;
    pointerMoveThrottled.current = now;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const currentPointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(currentPointerPos.x, currentPointerPos.y, scale);
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }
    
    // Process coalesced events for smoother drawing (if available)
    // This gives us all the intermediate pointer positions between events
    // Skip for gradient/contour tools as they don't need continuous drawing
    if (interaction.state.isDrawing && event.nativeEvent.getCoalescedEvents && 
        !toolStateMachine.isRectangleGradient && !toolStateMachine.isPolygonGradient && !toolStateMachine.isContourPolygon) {
      const coalescedEvents = event.nativeEvent.getCoalescedEvents();
      if (coalescedEvents.length > 1) {
        // Process intermediate events (skip the last one as it's the current event)
        for (let i = 0; i < coalescedEvents.length - 1; i++) {
          const coalescedEvent = coalescedEvents[i];
          const coalescedPos = rect ? {
            x: coalescedEvent.clientX - rect.left,
            y: coalescedEvent.clientY - rect.top,
          } : { x: 0, y: 0 };
          const coalescedWorldPos = pan.screenToWorld(coalescedPos.x, coalescedPos.y, scale);
          const coalescedPressure = coalescedEvent.pressure || 0.5;
          
          // Draw with the intermediate position and pressure
          if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
            drawingHandlers.continueShapeDrawing(coalescedWorldPos);
          } else {
            drawingHandlers.continueDrawing(coalescedWorldPos, coalescedPressure);
          }
        }
      }
    }
    
    // Always update cursor position immediately for responsive feel
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    // Only dispatch to state machine if not panning (to avoid unnecessary updates)
    if (!pan.panState.isPanning) {
      stateMachine.dispatch({ 
        type: 'MOUSE_MOVE',
        position: currentPointerPos,
        pressure
      });
    }
    
    // SIMPLIFIED PANNING: Check if we're actively panning
    if (pan.panState.isPanning) {
      // Update pan position
      pan.updatePan(currentPointerPos.x, currentPointerPos.y);
      
      // Update view transform for immediate feedback
      deps.viewTransformRef.current.offsetX = pan.panState.offsetX;
      deps.viewTransformRef.current.offsetY = pan.panState.offsetY;
      
      // Throttle redraws with RAF
      if (!drawAnimationFrameRef.current) {
        drawAnimationFrameRef.current = requestAnimationFrame(() => {
          const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
          drawAnimationFrameRef.current = null;
        });
      }
      
      return; // Skip other mouse move logic while panning
    }
    
    // Show brush cursor logic:
    // Hide cursor when: panning, custom tool, dragging paste, or actively erasing
    const shouldHideCursor = stateMachine.isAwaitingPan || 
                            stateMachine.isPanning || 
                            tools.currentTool === 'custom' || 
                            deps.isDraggingFloatingPaste ||
                            (tools.currentTool === 'eraser' && interaction.state.isDrawing);
    
    setShowBrushCursor(!shouldHideCursor);
    
    // Handle dragging floating paste
    if (deps.isDraggingFloatingPaste && floatingPasteDragStart.current && floatingPasteOriginalPos.current) {
      const deltaX = worldPos.x - floatingPasteDragStart.current.x;
      const deltaY = worldPos.y - floatingPasteDragStart.current.y;
      
      const newX = floatingPasteOriginalPos.current.x + deltaX;
      const newY = floatingPasteOriginalPos.current.y + deltaY;
      
      updateFloatingPastePosition(newX, newY);
      
      // Redraw
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Check for rectangle gradient width preview mode (special case - works without mouse down)
    if (toolStateMachine.isRectangleGradient && 
        toolStateMachine.rectangleBrushState.drawingState === 'definingWidth' &&
        !interaction.state.isDrawing && deps.previewAnimationFrameRef) {
      
      // Throttle rectangle gradient width preview with RAF
      if (!deps.previewAnimationFrameRef.current) {
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          const overlayCanvas = overlayCanvasRef.current;
          const overlayCtx = overlayCanvas?.getContext('2d');
          if (overlayCtx && overlayCanvas) {
            // Clear only the overlay canvas
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            
            // Width definition preview - show full rectangle with gradient
            const currentRectState = toolStateMachine.rectangleBrushState;
            const startPos = currentRectState.startPos;
            const endPos = currentRectState.endPos;
            const dx = endPos.x - startPos.x;
            const dy = endPos.y - startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - startPos.x;
              const toMouseY = worldPos.y - startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const previewWidth = perpDist * 2;
              
              const perpX = -dy / length * (previewWidth / 2);
              const perpY = dx / length * (previewWidth / 2);
              
              const corners = [
                { x: startPos.x + perpX, y: startPos.y + perpY },
                { x: startPos.x - perpX, y: startPos.y - perpY },
                { x: endPos.x - perpX, y: endPos.y - perpY },
                { x: endPos.x + perpX, y: endPos.y + perpY }
              ];
              
              overlayCtx.save();
              overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
              overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
              
              overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                ? (tools.eraserSettings?.opacity || 1)
                : (tools.brushSettings.opacity || 1);
              overlayCtx.globalCompositeOperation = tools.currentTool === 'eraser' ? 'destination-out' : (tools.brushSettings.blendMode || 'source-over');
              
              // Sample colors for preview
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                startPos.x,
                startPos.y,
                endPos.x,
                endPos.y,
                numColors
              );
              
              // Create gradient for preview
              const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
              
              if (sampledColors.length > 0) {
                sampledColors.forEach((color, index) => {
                  const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                  gradient.addColorStop(position, color);
                });
              } else {
                gradient.addColorStop(0, tools.brushSettings.color);
                gradient.addColorStop(1, tools.brushSettings.color);
              }
              
              overlayCtx.fillStyle = gradient;
              overlayCtx.beginPath();
              overlayCtx.moveTo(corners[0].x, corners[0].y);
              overlayCtx.lineTo(corners[1].x, corners[1].y);
              overlayCtx.lineTo(corners[2].x, corners[2].y);
              overlayCtx.lineTo(corners[3].x, corners[3].y);
              overlayCtx.closePath();
              overlayCtx.fill();
              
              overlayCtx.restore();
            }
          }
          if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
        });
      }
      return;
    }
    
    if (interaction.state.isDrawing) {
      // Rectangle gradient preview
      if (toolStateMachine.isRectangleGradient) {
        const previewType = toolStateMachine.handleRectangleGradientMouseMove(worldPos);
        if (previewType && deps.previewAnimationFrameRef) {
          // Throttle rectangle gradient preview with RAF
          if (!deps.previewAnimationFrameRef.current) {
            deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
              const overlayCanvas = overlayCanvasRef.current;
              const overlayCtx = overlayCanvas?.getContext('2d');
              if (overlayCtx && overlayCanvas) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                // Get current rectangle state
                const currentRectState = toolStateMachine.rectangleBrushState;
                
                if (previewType === 'length') {
                  // Length definition preview - show line with sampled colors
                  overlayCtx.save();
                  overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                  overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                  
                  // Sample colors along the line
                  const numColors = tools.brushSettings.colors || 2;
                  const sampledColors = sampleColorsAlongLine(
                    currentRectState.startPos.x,
                    currentRectState.startPos.y,
                    worldPos.x,
                    worldPos.y,
                    numColors
                  );
                  
                  // Create gradient with sampled colors
                  const gradient = overlayCtx.createLinearGradient(
                    currentRectState.startPos.x,
                    currentRectState.startPos.y,
                    worldPos.x,
                    worldPos.y
                  );
                  
                  if (sampledColors.length === 1) {
                    gradient.addColorStop(0, sampledColors[0]);
                    gradient.addColorStop(1, sampledColors[0]);
                  } else {
                    sampledColors.forEach((color, i) => {
                      gradient.addColorStop(i / (sampledColors.length - 1), color);
                    });
                  }
                  
                  overlayCtx.strokeStyle = gradient;
                  overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(currentRectState.startPos.x, currentRectState.startPos.y);
                  overlayCtx.lineTo(worldPos.x, worldPos.y);
                  overlayCtx.stroke();
                  
                  overlayCtx.restore();
                } else if (previewType === 'width') {
                  // Width definition preview - show full rectangle with gradient
                  const startPos = currentRectState.startPos;
                  const endPos = currentRectState.endPos;
                  const dx = endPos.x - startPos.x;
                  const dy = endPos.y - startPos.y;
                  const length = Math.hypot(dx, dy);
                  
                  if (length > 0) {
                    const lineVecX = dx / length;
                    const lineVecY = dy / length;
                    const toMouseX = worldPos.x - startPos.x;
                    const toMouseY = worldPos.y - startPos.y;
                    const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
                    const previewWidth = perpDist * 2;
                    
                    const perpX = -dy / length * (previewWidth / 2);
                    const perpY = dx / length * (previewWidth / 2);
                    
                    const corners = [
                      { x: startPos.x + perpX, y: startPos.y + perpY },
                      { x: startPos.x - perpX, y: startPos.y - perpY },
                      { x: endPos.x - perpX, y: endPos.y - perpY },
                      { x: endPos.x + perpX, y: endPos.y + perpY }
                    ];
                    
                    overlayCtx.save();
                    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                    
                    overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                      ? (tools.eraserSettings?.opacity || 1)
                      : (tools.brushSettings.opacity || 1);
                    overlayCtx.globalCompositeOperation = tools.currentTool === 'eraser' ? 
                      'destination-out' : (tools.brushSettings.blendMode || 'source-over');
                    
                    // Sample colors for preview
                    const numColors = tools.brushSettings.colors || 2;
                    const sampledColors = sampleColorsAlongLine(
                      startPos.x,
                      startPos.y,
                      endPos.x,
                      endPos.y,
                      numColors
                    );
                    
                    // Create gradient for preview
                    const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
                    
                    if (sampledColors.length > 0) {
                      sampledColors.forEach((color, index) => {
                        const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                        gradient.addColorStop(position, color);
                      });
                    } else {
                      gradient.addColorStop(0, tools.brushSettings.color);
                      gradient.addColorStop(1, tools.brushSettings.color);
                    }
                    
                    overlayCtx.fillStyle = gradient;
                    overlayCtx.beginPath();
                    overlayCtx.moveTo(corners[0].x, corners[0].y);
                    overlayCtx.lineTo(corners[1].x, corners[1].y);
                    overlayCtx.lineTo(corners[2].x, corners[2].y);
                    overlayCtx.lineTo(corners[3].x, corners[3].y);
                    overlayCtx.closePath();
                    overlayCtx.fill();
                    
                    overlayCtx.restore();
                  }
                }
              }
              if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
            });
          }
        }
        return;
      }
      
      // Polygon gradient or contour polygon preview
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon) {
        if (toolStateMachine.handlePolygonGradientMouseMove(worldPos) && deps.previewAnimationFrameRef) {
          // Throttle polygon gradient preview with RAF
          if (!deps.previewAnimationFrameRef.current) {
            deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
              const overlayCanvas = overlayCanvasRef.current;
              const overlayCtx = overlayCanvas?.getContext('2d');
              const currentPolygonState = toolStateMachine.polygonGradientState;
              
              if (overlayCtx && overlayCanvas && currentPolygonState.points.length > 0) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                overlayCtx.save();
                overlayCtx.imageSmoothingEnabled = false;
                overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                
                // Build preview vertices including current mouse position
                const previewVertices = [
                  ...currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y })),
                  { x: worldPos.x, y: worldPos.y }
                ];
                
                if (previewVertices.length >= 3) {
                  // For contour polygon, use solid color; for gradient polygon, use gradient
                  if (toolStateMachine.isContourPolygon) {
                    // Use solid color for contour polygon preview
                    overlayCtx.fillStyle = tools.brushSettings.color;
                    overlayCtx.globalAlpha = 0.5; // Semi-transparent preview
                  } else {
                    // Calculate bounds for gradient
                    const minX = Math.min(...previewVertices.map((v: any) => v.x));
                    const minY = Math.min(...previewVertices.map((v: any) => v.y));
                    const maxX = Math.max(...previewVertices.map((v: any) => v.x));
                    const maxY = Math.max(...previewVertices.map((v: any) => v.y));
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    // Choose gradient direction based on polygon shape
                    let gradient;
                    if (width > height) {
                      gradient = overlayCtx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
                    } else {
                      gradient = overlayCtx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
                    }
                    
                    // Build preview colors
                    const previewColors = [
                      ...currentPolygonState.points.map((p: any) => p.color),
                      deps.sampleColorAtPosition(worldPos.x, worldPos.y)
                    ];
                    
                    // Create gradient stops
                    if (previewColors.length >= 3) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(0.5, previewColors[Math.floor(previewColors.length / 2)]);
                      gradient.addColorStop(1, previewColors[previewColors.length - 1]);
                    } else if (previewColors.length === 2) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(1, previewColors[1]);
                    } else if (previewColors.length === 1) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(1, previewColors[0]);
                    }
                    
                    overlayCtx.fillStyle = gradient;
                  }
                  
                  // Draw filled polygon preview
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(previewVertices[0].x, previewVertices[0].y);
                  for (let i = 1; i < previewVertices.length; i++) {
                    overlayCtx.lineTo(previewVertices[i].x, previewVertices[i].y);
                  }
                  overlayCtx.closePath();
                  overlayCtx.fill();
                }
                
                overlayCtx.restore();
              }
              if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
            });
          }
        }
        return;
      }
      
      // Normal brush or shape mode
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        drawingHandlers.continueShapeDrawing(worldPos);
      } else {
        // Continue drawing immediately for responsive feel
        drawingHandlers.continueDrawing(worldPos, pressure);
        
        // Throttle the expensive redraw with RAF
        if (!deps.drawingAnimationFrameRef.current) {
          deps.drawingAnimationFrameRef.current = requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            if (canvas) {
              // Use the same context options as the main canvas for consistency
              const ctx = canvas.getContext('2d', { 
                willReadFrequently: true,
                alpha: true,
                desynchronized: true 
              });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
            deps.drawingAnimationFrameRef.current = null;
          });
        }
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Clear pointer down state
    isMouseDownRef.current = false;
    
    // Release pointer capture
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
    
    // Cancel any pending drawing animation frame
    if (deps.drawingAnimationFrameRef.current) {
      cancelAnimationFrame(deps.drawingAnimationFrameRef.current);
      deps.drawingAnimationFrameRef.current = null;
    }
    
    // Cancel any pending preview animation frame
    if (deps.previewAnimationFrameRef && deps.previewAnimationFrameRef.current) {
      cancelAnimationFrame(deps.previewAnimationFrameRef.current);
      deps.previewAnimationFrameRef.current = null;
    }
    
    // Clear overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const overlayCtx = overlayCanvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
    
    const mousePos = getMousePos(event);
    
    // SIMPLIFIED PANNING: End pan if we were panning
    if (pan.panState.isPanning) {
      pan.endPan();
      // Restore cursor based on space state
      if (isSpacePressedRef.current) {
        setCursorStyle('grab');
      } else {
        setCursorStyle(deps.defaultCursorStyle || 'none');
        setShowBrushCursor(true);
      }
      return;
    }
    
    // Dispatch to state machine (only once) for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // Handle floating paste drag end
    if (deps.isDraggingFloatingPaste) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(deps.defaultCursorStyle || 'none');
      setShowBrushCursor(true);
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      const scale = canvas?.zoom || 1;
      let worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
      
      // Clamp world position to canvas bounds
      if (project) {
        worldPos = {
          x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(project.height - 1, worldPos.y))
        };
      }
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
        if (tools.currentTool === 'custom') {
          deps.setCurrentTool('brush');
          clearSelection();
          setShowBrushCursor(true); // Show brush cursor again after custom brush selection
        }
      }
      interaction.refs.selectionStart.current = null;
      return;
    }
    
    // Handle drawing
    if (interaction.state.isDrawing) {
      // Rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Handle the state transition
        const shouldFinalize = toolStateMachine.handleRectangleGradientMouseUp();
        
        if (shouldFinalize) {
          // Clear the overlay canvas since we're finalizing
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          // Reset the tool state and end drawing
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        }
        // Don't end drawing state if we're still defining width
        return;
      }
      
      // Polygon gradient or contour polygon
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon) {
        if (toolStateMachine.handlePolygonGradientMouseUp()) {
          // Finalize polygon - we have at least 3 points
          const currentPolygonState = toolStateMachine.polygonGradientState;
          
          if (currentPolygonState.points.length >= 3) {
            drawingHandlers.initDrawingCanvas();
            const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
            
            if (drawCtx && brushEngine) {
              // Draw the polygon gradient or contour polygon
              if (toolStateMachine.isContourPolygon) {
                brushEngine.drawContourPolygon(
                  drawCtx,
                  {
                    vertices: currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y }))
                  },
                  false // not preview
                );
              } else {
                brushEngine.drawPolygonGradient(
                  drawCtx,
                  {
                    vertices: currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y })),
                    colors: currentPolygonState.points.map((p: any) => p.color)
                  },
                  false // not preview
                );
              }
              
              drawingHandlers.drawingCanvasHasContent.current = true;
            }
          }
          
          // Mark composite as dirty BEFORE finalization
          compositeCanvasDirtyRef.current = true;
          // Finalize the drawing
          drawingHandlers.finalizeDrawing().then(() => {
            // Signal that finalization is complete
            stateMachine.finalizationComplete();
            
            // Force immediate composite regeneration after layer update
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
            }
            
            // Trigger redraw after finalization
            setNeedsRedraw(prev => prev + 1);
            
            // Restart color cycle animation if needed
            if (deps.restartColorCycleAnimation) {
              deps.restartColorCycleAnimation();
            }
          });
          toolStateMachine.resetPolygonGradient();
        }
        interaction.dispatch({ type: 'DRAWING_END' });
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_END' });
      
      // Mark composite as dirty BEFORE finalization to ensure it updates
      compositeCanvasDirtyRef.current = true;
      
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        drawingHandlers.finalizeShapeDrawing();
        // Signal that finalization is complete
        stateMachine.finalizationComplete();
        
        // Force immediate composite regeneration after layer update
        if (compositeCanvasRef.current && project) {
          compositeLayersToCanvas(compositeCanvasRef.current);
          setCurrentOffscreenCanvas(compositeCanvasRef.current);
          compositeCanvasDirtyRef.current = false;
        }
        
        setNeedsRedraw(prev => prev + 1);
        
        // Restart color cycle animation if needed
        if (deps.restartColorCycleAnimation) {
          deps.restartColorCycleAnimation();
        }
      } else {
        drawingHandlers.finalizeDrawing().then(() => {
          // Signal that finalization is complete
          stateMachine.finalizationComplete();
          
          // Use requestAnimationFrame to ensure the layer update has propagated
          requestAnimationFrame(() => {
            // Force immediate composite regeneration after layer update
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
              
              // Force immediate redraw
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
          });
          
          // Restart color cycle animation if needed
          if (deps.restartColorCycleAnimation) {
            deps.restartColorCycleAnimation();
          }
        });
      }
    }
  };

  const handlePointerEnter = () => {
    // Show brush cursor when entering canvas
    if (tools.currentTool === 'brush' || tools.currentTool === 'eraser') {
      setShowBrushCursor(true);
    }
  };

  const handlePointerLeave = () => {
    setShowBrushCursor(false);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle pointer cancel (e.g., stylus moving out of range)
    isMouseDownRef.current = false;
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel
  };
};