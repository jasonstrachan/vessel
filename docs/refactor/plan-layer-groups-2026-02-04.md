# 2026-02-04 — Plan: Visual Layer Groups (Toggleable)

## Goal
Add a visual-only grouping feature for layers in the right-side Layers panel. Grouping does **not** change rendering/compositing order, but users can toggle visibility for the whole group. The UI should be simple and clean, using the existing right-click popover menu and minimal row chrome.

## Constraints
- Visual organization only; no render/composite changes beyond visibility toggling.
- Group visibility should affect all child layers at once.
- Keep existing basePath/assetPrefix behavior intact.
- Use Zustand store conventions and selectors; avoid in-place mutation.
- Keep UI minimal; reuse existing popover in `LayersPanel`.

## Proposed Data Model
- Extend `Layer` with optional metadata for grouping:
  - `groupId?: string` on each layer.
- Add lightweight group registry in store state:
  - `layerGroups: Array<{ id: string; name: string; collapsed: boolean; visible: boolean; }>`
- Derived ordering in UI:
  - Keep `state.layers` as the canonical ordered array (flat for rendering).
  - Grouping is a UI view: contiguous and non-contiguous layers can share `groupId`.

## Store Actions
- `createLayerGroupFromSelection(layerIds: string[]): string`
  - Creates group, assigns `groupId` on selected layers, sets group visibility to true.
- `removeLayerGroup(groupId: string)`
  - Clears `groupId` from all layers in the group and deletes group entry.
- `toggleLayerGroupVisibility(groupId: string)`
  - Flips group visibility; applies to all child layers by updating their `visible` flags.
- `renameLayerGroup(groupId: string, name: string)` (optional, for later)
- `setLayerGroupCollapsed(groupId: string, collapsed: boolean)` (optional for later)

## UI Plan (LayersPanel)
1. **Right-click popover menu**
   - Add new button: **Group layers** (enabled only when 2+ layers selected).
   - If the right-clicked layer is part of a group, show **Ungroup**.
2. **Layer list display**
   - Render group headers when groupIds are present in the visible list.
   - Group header row includes:
     - Group name (e.g., “Group 1”)
     - Visibility toggle (eye icon) that applies to all layers in group
     - Minimal styling to distinguish header (subtle background, small badge)
3. **Selection behavior**
   - Right-click on a layer should preserve multi-select if the layer is already selected.
   - Right-click on unselected layer should select only that layer.

## Rendering & History
- **Rendering**: unchanged. Grouping is not a rendering construct; only visibility toggles affect `layer.visible`.
- **History**: use existing layer update paths to ensure visibility changes are captured.

## Tests
- Store tests:
  - Creating a group assigns groupId to selected layers.
  - Toggling group visibility updates all child layer `visible` flags.
  - Ungroup clears groupId and leaves visibility as-is.
- UI tests:
  - Popover shows “Group selected layers” enabled when 2+ selected.
  - Group header visibility toggle hides/shows all members.

## Rollout Steps
1. Add store state + actions in `src/stores/slices/layersSlice.ts` and selectors.
2. Update `src/types/index.ts` with `groupId` and group type.
3. Update `LayersPanel` to:
   - Render group headers
   - Add group/un-group menu actions
4. Update tests in `src/stores/__tests__` and UI tests.
5. Run `npm test`, `npm run type-check`, `npm run lint`.

## Open Questions
- Do we want group headers to be collapsible in this first pass, or only visibility toggles?
- Should group visibility state be stored explicitly, or derived from child layers?
