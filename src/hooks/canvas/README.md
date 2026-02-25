# Canvas Event Handlers - Modular Architecture

## Overview
This directory contains a modular, maintainable architecture for canvas event handling that was extracted from the monolithic DrawingCanvas.tsx component.

## Structure

```
canvas/
├── handlers/              # Event handler implementations
│   ├── pointerHandlers.ts # Mouse/touch/stylus events
│   ├── keyboardHandlers.ts # Keyboard events
│   ├── wheelHandlers.ts   # Scroll/zoom events
│   └── clipboardHandlers.ts # Copy/paste events
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
- ✅ Keyboard handlers
- ✅ Wheel handlers
- ✅ Clipboard handlers
- ✅ Type definitions and dependencies
- ✅ Main orchestrator hook
- ✅ DrawingCanvas integration for pointer/keyboard/wheel/paste/blur handlers

## Guardrails (Preventing Re-Bloat)

1. Keep orchestration hooks/components thin:
   - `useDrawingHandlers.ts`, `DrawingCanvas.tsx`, `useCanvasEventHandlers.ts` should only wire dependencies and compose handlers.
   - Heavy logic belongs in `handlers/**` or `utils/**`.
2. Enforce soft/hard line budgets in PR review:
   - Soft warning at 400 LOC for orchestration files.
   - Hard stop at 700 LOC unless there is a documented exception in `docs/refactor/module-size-guardrails.md`.
3. Require extraction trigger at review time:
   - If a file adds a third independent concern (input orchestration, render wiring, history, tool workflow, etc.), extract before merge.
4. Keep tests close to extracted modules:
   - Add/update targeted tests under `src/hooks/canvas/handlers/**/__tests__/` for each extraction slice.

See `docs/refactor/module-size-guardrails.md` for the full policy and CI suggestions.
