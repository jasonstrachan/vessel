# Canvas Event Handlers - Modular Architecture

## Overview
This directory contains a modular, maintainable architecture for canvas event handling that was extracted from the monolithic DrawingCanvas.tsx component.

## Structure

```
canvas/
├── handlers/              # Event handler implementations
│   ├── pointerHandlers.ts # Mouse/touch/stylus events
│   ├── keyboardHandlers.ts # Keyboard events (TODO)
│   ├── wheelHandlers.ts   # Scroll/zoom events (TODO)
│   └── clipboardHandlers.ts # Copy/paste events (TODO)
├── utils/                 
│   └── types.ts           # Shared TypeScript types
└── useCanvasEventHandlers.ts # Main orchestrator hook
```

## Benefits

1. **Modularity**: Each handler type is in its own file (~400 lines vs 2600)
2. **Testability**: Handlers are pure functions that can be tested in isolation
3. **Maintainability**: Clear separation of concerns, easy to find and fix issues
4. **Type Safety**: All dependencies explicitly typed
5. **No Breaking Changes**: Exact same behavior as before

## Usage

```typescript
import { useCanvasEventHandlers } from './hooks/canvas/useCanvasEventHandlers';

// In DrawingCanvas component:
const eventHandlers = useCanvasEventHandlers({
  // Pass all required dependencies
  canvasRef,
  interaction,
  stateMachine,
  pan,
  // ... etc
});

// Attach to canvas element
<canvas
  onPointerDown={eventHandlers.handlePointerDown}
  onPointerMove={eventHandlers.handlePointerMove}
  onPointerUp={eventHandlers.handlePointerUp}
  // ... etc
/>
```

## Migration Status

- ✅ Pointer handlers (handlePointerDown, handlePointerMove, handlePointerUp)
- ✅ Type definitions and dependencies
- ✅ Main orchestrator hook
- ⏳ Keyboard handlers (TODO)
- ⏳ Wheel handlers (TODO)
- ⏳ Clipboard handlers (TODO)
- ⏳ Full DrawingCanvas integration (TODO)

## Next Steps

1. Extract remaining event handlers (keyboard, wheel, clipboard)
2. Add comprehensive tests for each handler module
3. Complete integration with DrawingCanvas.tsx
4. Add performance optimizations if needed