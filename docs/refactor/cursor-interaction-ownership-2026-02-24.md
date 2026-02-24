# Cursor Interaction Ownership (2026-02-24)

## Scope
- `src/hooks/canvas/handlers/keyboardHandlers.ts`
- `src/hooks/canvas/handlers/pointerHandlers.ts`
- `src/hooks/canvas/handlers/utils/spacePanCursor.ts`
- `src/hooks/canvas/handlers/utils/toolCursor.ts`

## Ownership Rules
1. Space/pan cursor intent is resolved only by `resolveSpacePanCursor`.
2. Non-pan tool cursor intent (crosshair/default/move) is resolved only by `resolveToolCursorState`.
3. Pointer and keyboard handlers apply cursor updates via local helper wrappers (`applySpacePanCursor`, `applyToolCursor`) and should not introduce new ad-hoc cursor string rules.

## Fallback Policy
- Shared fallback constants live in:
  - `src/hooks/canvas/handlers/utils/cursorFallbacks.ts`
- Current defaults:
  - `CURSOR_FALLBACK_NONE = 'none'`
  - `CURSOR_FALLBACK_CROSSHAIR = 'crosshair'`

## Regression Coverage
- `src/hooks/canvas/handlers/utils/__tests__/cursorResolvers.test.ts`
- `src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts` includes the stale-ref-vs-state-machine space-pan guard.
