# WebGL Export Viewer Roadmap

## Overview
The goal is to make every TinyBrush WebGL export immediately viewable in any browser without extra tooling. The exported artifact should include both the artwork bundle and a lightweight runtime so creators can share a single HTML package that renders, animates, and documents the project.

## Objectives
- Package the existing viewer (`public/export-viewer/`) alongside the JSON bundle during export.
- Offer both a quick offline HTML viewer and an embeddable JS runtime API for custom integrations.
- Preserve animation fidelity (perfect loops, blend modes, color-cycle timing) in the exported experience.
- Provide optional enhancements such as branded overlays, playback controls, and inline documentation for collectors.

## Phased Plan
### Phase 0 — Baseline Review
- [ ] Audit current exporter output to confirm which assets (textures, metadata, optional fallback PNG) are present.
- [ ] Document runtime assumptions (Canvas 2D vs. WebGL, browser requirements, bundle size budgets).

### Phase 1 — Self-Contained Viewer Packaging
- [x] Update `exportProjectAsWebGL` to emit a zipped package containing:
  - `index.html` – copy of the viewer page with inline styles.
  - `viewer.js` – loader/runtime (minified when `minifyOutput` is enabled).
  - `<project-name>-webgl.json` – TinyBrush bundle.
- [x] Add CLI/service option to emit a single self-contained HTML file (JSON + runtime embedded) for drag-and-drop playback.
- [x] Ensure asset paths respect `basePath`/`assetPrefix` when deployed statically.

### Phase 2 — Runtime Fidelity & Controls
- [ ] Promote the viewer runtime to a shared module (`src/exportRuntime/`) so both the bundled viewer and future integrations reuse the same code.

### Phase 3 — Experience Polish
- [ ] Branded overlay template with project title, artist info, and custom copy (fed from export metadata).
- [ ] Keyboard shortcuts and accessibility pass (focus order, ARIA labels on controls).

### Phase 4 — Distribution & Automation
- [ ] Integrate packaging flow into export modal, exposing options (zip, standalone HTML, raw JSON only).
- [ ] Provide a CLI script (`npm run export:webgl-viewer`) for batch exports or CI workflows.
- [ ] Document hosting guidelines (GitHub Pages, IPFS gateway, static file hosting).

### Phase 5 — Advanced Enhancements (Optional)
- [ ] Reintroduce WebGL shader playback for color-cycle layers for GPU-accelerated animation.
- [ ] Add audio/reactive hooks for synchronized multimedia experiences.
- [ ] Support multi-scene playlists and timeline cues (jump cuts, camera pans) driven by exported metadata.

## Deliverables & Validation
- Updated exporter producing single-file HTML bundles.
- Reusable runtime module with unit tests exercising layout, scaling, and animation timing.
- Documentation update under `docs/exporting.md` (or similar) describing how to share viewer bundles.

## Open Questions
1. Should the viewer ship with full TinyBrush branding, or remain white-label with customizable themes?
2. What is the acceptable bundle size ceiling for zipped vs. single-file exports (considering large textures)?
3. Do we need analytics hooks or download tracking for shared viewers?
4. Should we support encrypted bundles for gated/collector-only releases?

## Next Steps
1. Implement Phase 1 (packaging) to deliver a drag-and-drop viewer bundle.
2. Socialize runtime API surface with the team to ensure future integrations remain stable.
3. Schedule QA pass focused on animation fidelity once playback controls are in place.
