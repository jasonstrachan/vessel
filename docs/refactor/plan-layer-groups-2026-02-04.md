# 2026-02-04 — Plan: Layer Organization Roadmap (V1/V2)

## Goal
Ship simple, reliable layer-organization controls first, then add visual groups as a separate phase.

## Scope Decision
- **V1 ships without grouping.**
- **V2 introduces visual grouping/folders.**

This keeps V1 focused on low-risk workflow improvements while avoiding premature data-model expansion.

## V1 — Bulk Visibility Controls (No Grouping)

### Product Behavior
- Keep current flat layer stack model.
- Keep per-layer visibility toggle exactly as-is.
- Add simple bulk controls for selected layers:
  - **Show selected**
  - **Hide selected**
- **Toggle selected visibility** (flip each selected layer)

### Data Model
- No new `Layer` fields.
- No `layerGroups` registry.
- `layer.visible` remains the single visibility source of truth.

### UI Plan (`LayersPanel`)
1. Add bulk visibility actions to existing layer popover/menu, enabled when `selectedLayerIds.length >= 2`.
2. Preserve current right-click behavior:
   - Right-click on selected layer keeps selection.
   - Right-click on unselected layer selects only that layer.
3. No group headers, no folder rows, no collapse affordances.

### Store Plan
- Reuse existing `updateLayer` path.
- Add one focused helper action in `layersSlice` for ergonomics and testability:
  - `setLayersVisibility(layerIds: string[], visible: boolean)`
  - `toggleLayersVisibility(layerIds: string[])`
- Keep history integration through existing layer-structure/history paths.

### Tests
- Store:
  - Setting visibility for multiple layers updates only target layer IDs.
  - Non-target layer visibility remains unchanged.
- UI:
  - Bulk actions enabled only for multi-selection.
  - Bulk show/hide updates selected layers.
  - Bulk toggle flips selected layers.
  - Single-layer eye toggle remains unchanged.

### V1 Definition of Done
- No grouping state exists anywhere in types/store/project format.
- Multi-select bulk visibility works from Layers panel.
- Existing reorder/merge/delete/duplicate behavior remains unchanged.
- `npm test`, `npm run type-check`, `npm run lint` pass.

## V2 — Visual Layer Groups (Folder-Style Organization)

### Product Behavior
- Visual organization only (no compositing-order semantics beyond existing flat stack ordering).
- Group header row supports:
  - Group name
  - Group visibility (apply to all member layers)
- Per-layer visibility still available and independent.

### Data Model (Proposed)
- `Layer`:
  - `groupId?: string`
- Store registry:
  - `layerGroups: Array<{ id: string; name: string }>`
- Group visibility is **computed from member layers** (no separate stored `group.visible`), avoiding drift.

### Store Actions (V2)
- `createLayerGroupFromSelection(layerIds: string[]): string`
- `removeLayerGroup(groupId: string)`
- `renameLayerGroup(groupId: string, name: string)`
- `setLayerGroupVisibility(groupId: string, visible: boolean)`:
  - applies `visible` to all member layers via existing update paths.

### Architecture Requirements (V2)
- Define behavior matrix for existing operations:
  - reorder, duplicate, remove, merge, add layer.
- Add persistence/migration:
  - project serialization/deserialization for `groupId` and `layerGroups`.
  - backward compatibility for projects without group metadata.
- Add history coverage for group lifecycle:
  - create/ungroup/rename/visibility.

### Tests (V2)
- Store unit/integration:
  - create group, ungroup, rename, group visibility.
  - interaction with reorder/remove/merge/duplicate.
- Persistence:
  - save/load keeps group membership and metadata.
  - legacy project load works when group fields are absent.
- UI:
  - group headers render correctly.
  - group visibility affects all members.
  - per-layer visibility remains individually controllable.

## Rollout Order
1. Implement V1 (bulk visibility only).
2. Stabilize and observe usage.
3. Implement V2a grouping (no collapse) with persistence/history in one cohesive change.
4. Implement V2b collapse/expand behavior if still needed.

## Status (2026-02-21)
- V1 complete.
- V2a complete.
- V2b complete in `LayersPanel` with persisted group collapse state.

## Open Items
- None. V1 includes show/hide/toggle, and collapse is deferred to V2b.
