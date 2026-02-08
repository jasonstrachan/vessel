# Module Size Guardrails (Canvas + Hooks)

Date: 2026-02-08  
Status: Active policy

## Why
We reduced `useDrawingHandlers.ts` and `DrawingCanvas.tsx` from multi-thousand-line hotspots to orchestration shells. This policy prevents regression into monolith files.

## Scope
- `src/hooks/useDrawingHandlers.ts`
- `src/components/canvas/DrawingCanvas.tsx`
- `src/hooks/canvas/useCanvasEventHandlers.ts`
- Any future orchestration-first canvas entrypoints

## Policy
1. Orchestration files compose; they do not implement deep workflow logic.
2. Extract non-trivial logic into:
   - `src/hooks/canvas/handlers/**` for side-effectful workflow logic
   - `src/hooks/canvas/utils/**` for pure helper logic
3. Budgets:
   - Soft budget: 400 LOC
   - Hard budget: 700 LOC
4. Any hard-budget exception must include:
   - reason,
   - exit plan to split,
   - link to a tracked refactor plan in `docs/refactor/`.

## PR Checklist (Required for Canvas/Hook Changes)
1. Is the touched orchestration file still under hard budget?
2. Did this PR add a new concern to an orchestration file?
3. If yes, was that concern extracted to `handlers/**` or `utils/**`?
4. Were targeted tests added/updated near extracted code?
5. Did `npm run type-check`, `npm run lint`, and `npm test` pass?

## Suggested CI Guardrail
Add a small check script that fails CI when scoped orchestration files exceed hard budgets. Start with warnings on soft budget and hard-fail on 700+ LOC.

Example command (manual check):

```bash
wc -l src/hooks/useDrawingHandlers.ts src/components/canvas/DrawingCanvas.tsx src/hooks/canvas/useCanvasEventHandlers.ts
```

## Refactor Trigger Rules
- Third-concern rule: if a file now owns 3+ independent concerns, extract before merge.
- Repeated helper rule: if a helper pattern appears 3 times, extract.
- Testability rule: if logic cannot be unit-tested without mounting large UI state, extract into handler/util module.
