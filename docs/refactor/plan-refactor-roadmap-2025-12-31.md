# Refactor Roadmap

Date: 2025-12-31

## Priority Order (Most Important → Least Important)
1. `plan-useDrawingHandlers-decomposition.md` — largest risk surface and highest churn hotspot.
2. `plan-colorCycleAnimator-modularization.md` — core rendering/animation complexity and bug risk.
3. `plan-colorCycleBrush-consolidation.md` — removes duplicated implementations and drift.
4. `plan-export-service-extraction.md` — improves testability and UI clarity.
5. `plan-zustand-store-slicing.md` — long-term maintainability once churn stabilizes.

## Notes
- Each plan is scoped for behavior‑preserving changes.
- Execute in order to reduce integration risk.
- Each plan calls out a dedicated interface/contract section to avoid drift.
