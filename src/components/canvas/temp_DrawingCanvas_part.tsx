  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    isMouseDownRef.current = false;
    const mousePos = getMousePos(event);
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);

    // --- UNIFIED FINALIZATION LOGIC ---
    // If we were defining a shape, finalize it now.
    if (stateMachine.state.mode === 'SHAPE_DEFINING') {
      const shape = stateMachine.state.activeShape;
      if (shape && shape.start && shape.end) {
        // 1. Use the drawingHandlers to draw the final shape onto the canvas
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d');
        if (drawCtx && brushEngine) {
          // Draw the final shape based on its type
          if (shape.type === 'rectangle') {
            const x = Math.min(shape.start.x, shape.end.x);
            const y = Math.min(shape.start.y, shape.end.y);
            const width = Math.abs(shape.end.x - shape.start.x);
            const height = Math.abs(shape.end.y - shape.start.y);
            
            drawCtx.strokeStyle = tools.brushSettings.color;
            drawCtx.lineWidth = tools.brushSettings.size;
            drawCtx.globalAlpha = tools.brushSettings.opacity;
            drawCtx.strokeRect(x, y, width, height);
          } else if (shape.type === 'ellipse') {
            const centerX = (shape.start.x + shape.end.x) / 2;
            const centerY = (shape.start.y + shape.end.y) / 2;
            const radiusX = Math.abs(shape.end.x - shape.start.x) / 2;
            const radiusY = Math.abs(shape.end.y - shape.start.y) / 2;
            
            drawCtx.strokeStyle = tools.brushSettings.color;
            drawCtx.lineWidth = tools.brushSettings.size;
            drawCtx.globalAlpha = tools.brushSettings.opacity;
            drawCtx.beginPath();
            drawCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
            drawCtx.stroke();
          } else if (shape.type === 'line') {
            drawCtx.strokeStyle = tools.brushSettings.color;
            drawCtx.lineWidth = tools.brushSettings.size;
            drawCtx.globalAlpha = tools.brushSettings.opacity;
            drawCtx.beginPath();
            drawCtx.moveTo(shape.start.x, shape.start.y);
            drawCtx.lineTo(shape.end.x, shape.end.y);
            drawCtx.stroke();
          }
          
          drawingHandlers.drawingCanvasHasContent.current = true;
        }
        
        // 2. Commit the drawing to the active layer
        drawingHandlers.finalizeDrawing();
      }
      
      // 3. Reset the state machine to IDLE
      stateMachine.dispatch({ type: 'FINALIZE_SHAPE' });
      return;
    }
    
    // Dispatch generic mouse up for other systems (like panning)
    stateMachine.dispatch({ type: 'MOUSE_UP', position: mousePos });

    // Handle other mouseUp events (selection, floating paste, etc.)
    if (interaction.state.isDrawing) {
      interaction.dispatch({ type: 'DRAWING_END' });
      drawingHandlers.finalizeDrawing();
    }

    if (isDraggingFloatingPaste) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(true);
    }

    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
        if (tools.currentTool === 'custom') {
          setCurrentTool('brush');
          clearSelection();
          setShowBrushCursor(true);
        }
      }
      interaction.refs.selectionStart.current = null;
    }
  }, [getMousePos, canvas, pan, stateMachine, tools, drawingHandlers, brushEngine, interaction, 
      isDraggingFloatingPaste, setIsDraggingFloatingPaste, setCursorStyle, defaultCursorStyle,
      setShowBrushCursor, setSelectionBounds, setCurrentTool, clearSelection]);