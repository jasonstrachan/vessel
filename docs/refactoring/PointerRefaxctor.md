pointerHandlers.ts refactor


Refactoring pointerHandlers.tsx   │ │
│ │                                   │ │
│ │ Problem Analysis:                 │ │
│ │ - The file is 3,369 lines long    │ │
│ │ (massive!)                        │ │
│ │ - handlePointerDown alone is      │ │
│ │ ~2,000 lines (561-2521)           │ │
│ │ - Handles multiple tools and      │ │
│ │ brush shapes in deeply nested     │ │
│ │ conditionals                      │ │
│ │ - Difficult to maintain, test,    │ │
│ │ and extend                        │ │
│ │                                   │ │
│ │ Solution: Strategy Pattern with   │ │
│ │ Tool Handlers                     │ │
│ │                                   │ │
│ │ Phase 1: Create Tool-Specific     │ │
│ │ Handlers                          │ │
│ │                                   │ │
│ │ Split logic into separate handler │ │
│ │  classes by tool type:            │ │
│ │ - BrushToolHandler - brush/eraser │ │
│ │  drawing logic                    │ │
│ │ - FillToolHandler - flood fill    │ │
│ │ logic                             │ │
│ │ - ShapeToolHandler - shape        │ │
│ │ drawing modes                     │ │
│ │ - ContourToolHandler - contour    │ │
│ │ lines/polygon logic               │ │
│ │ - PanToolHandler - canvas panning │ │
│ │                                   │ │
│ │ Phase 2: Create Brush Shape       │ │
│ │ Handlers                          │ │
│ │                                   │ │
│ │ Split complex brush shape logic:  │ │
│ │ - ContourPolygonHandler - contour │ │
│ │  fill modes                       │ │
│ │ - GradientShapeHandler -          │ │
│ │ rectangle/polygon gradients       │ │
│ │ - ColorCycleHandler - color cycle │ │
│ │  shapes                           │ │
│ │ - Lines2Handler - lines2 contour  │ │
│ │ mode                              │ │
│ │                                   │ │
│ │ Phase 3: Implement Handler        │ │
│ │ Registry                          │ │
│ │                                   │ │
│ │ - Create PointerHandlerRegistry   │ │
│ │ to manage tool/shape handlers     │ │
│ │ - Route events to appropriate     │ │
│ │ handlers based on active          │ │
│ │ tool/shape                        │ │
│ │ - Keep common logic (pressure     │ │
│ │ detection, position calc) in base │ │
│ │  class                            │ │
│ │                                   │ │
│ │ Phase 4: Simplify Main File       │ │
│ │                                   │ │
│ │ - Reduce pointerHandlers.ts to    │ │
│ │ ~300 lines                        │ │
│ │ - Keep only event routing and     │ │
│ │ common utilities                  │ │
│ │ - Each handler owns its specific  │ │
│ │ logic                             │ │
│ │                                   │ │
│ │ This makes the code modular,      │ │
│ │ testable, and much easier to      │ │
│ │ maintain!                         │ │
│ ╰───────────────────────────────────╯ │
│                                       │
│ Would you like to proceed?            │
│                                       │
│ ❯ 1. Yes, and bypass permissions      │
│   2. Yes, and manually approve edits  │
│   3. No, keep planning                │
│                                       │
╰───────────────────────────────────────╯





Implement crosshatch and
      polygon gradient handling inside
      ShapeToolHandler, ensuring state
      updates and previews mirror current
      behavior.
    □ Prune migrated logic from
      pointerHandlers, wire up handler
      delegation, and validate via code
      review (consider targeted checks).