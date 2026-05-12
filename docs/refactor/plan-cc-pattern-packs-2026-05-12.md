# CC Pattern Packs Plan

Date: 2026-05-12
Status: Planned

## Goal

Extend the project-local CC custom tile pattern system into named pattern packs.

Users should be able to save a new tile pattern into an existing pack or a new pack, select a pack from the Pattern dropdown, and have each new CC gradient shape choose one random pattern from that selected pack.

Pattern packs and their tile membership must save into the `.vs` project file.

V1 scope is CC gradient shape authoring. The shared Pattern dropdown may show packs, but pack-random resolution must be frozen before shape preview/finalize uses the image-tile renderer. Stroke/stamp dither runtime should continue to receive a concrete `patternTileId` or a safe fallback in V1.

## Current Foundation

This plan builds on the existing custom tile pattern system.

- Existing Pattern dropdown and add-tile modal: `src/components/toolbar/CcPatternDropdown.tsx`
- Existing project tile type: `CcCustomTilePattern`
- Existing project field: `project.ccCustomTilePatterns`
- Existing store actions:
  - `addCcCustomTilePattern`
  - `removeCcCustomTilePattern`
  - `renameCcCustomTilePattern`
- Existing runtime tile resolver: `src/utils/colorCycle/ccCustomTilePattern.ts`
- Existing implementation plan: `docs/refactor/plan-cc-custom-tile-patterns-2026-05-11.md`

Do not create a second pattern system. Packs should be a thin authoring layer over the current custom image-tile assets.

## UX Contract

The Pattern dropdown remains the main entry point.

Dropdown groups:

- `+ Add New`
- built-in patterns
- saved custom tile patterns
- saved pattern packs

Selecting a single custom tile should behave as it does now.

Selecting a pack should put the brush into pack-random tile mode:

- `ditherAlgorithm: 'pattern'`
- `patternStyle: 'image-tile'`
- selected pack id stored in brush settings
- no concrete tile chosen until a new mark starts

If a non-shape path cannot freeze a pack member at mark start in V1, it must fall back to the last concrete tile or a built-in pattern rather than passing unresolved pack state into the runtime renderer.

The new pattern modal should keep the current two-pane workflow and add pack controls near the preview:

- left: paste, drop, or import tile pixels
- preview: repeated CC-colored tile preview
- pack selector: existing pack or new pack
- pack name field when creating or renaming a pack
- save action adds the new pattern to the selected pack

Packs can be renamed in the modal beside the pattern preview controls.

## Data Model

Add a project-local pack type:

```ts
export interface CcCustomTilePatternPack {
  id: string;
  name: string;
  patternIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

Add to `Project`:

```ts
ccCustomTilePatternPacks?: CcCustomTilePatternPack[];
```

Extend `BrushSettings` with pack selection fields:

```ts
patternTilePackId?: string | null;
patternTileSelectionMode?: 'single' | 'pack-random';
```

Keep `patternTileId` as the concrete selected tile id for single-tile mode and for frozen mark sessions.

## Affected Existing State Paths

Pack fields must be carried through the same shared state paths that currently carry CC dither pattern selection.

Update these paths deliberately:

- `ccBrushDitherSelection` in `src/stores/slices/toolsSlice.ts`
  - add `patternTilePackId`
  - add `patternTileSelectionMode`
  - update `setBrushSettings(...)` so pack dropdown changes survive CC brush switching
  - update CC preset activation so selected pack mode follows the user between CC brushes
- `BrushSettings` and sequential/plugin config types
  - add pack fields only where authoring settings are expected
  - avoid writing unresolved pack-random settings into committed layer data
- `src/components/toolbar/DitherControls.tsx`
  - pass pack fields through to `CcPatternDropdown`
- `src/components/toolbar/CcPatternDropdown.tsx`
  - render pack options
  - emit pack-random selection updates
  - continue emitting concrete single-tile updates for tile rows
- `src/utils/brushSettingsStorage.ts`
  - preserve or intentionally strip pack fields consistently with current dither-pattern selection policy
- `src/utils/projectIO.ts`
  - persist project-level pack definitions
  - do not add unresolved pack fields to layer brush state for V1 shape-only behavior

Do not rely on dropdown state alone. The shape runtime must receive an already-resolved concrete `patternTileId`.

## Runtime Invariant

Pack selection is an authoring mode. A finalized shape must not depend on future pack contents.

When a new CC gradient shape starts:

1. If `patternTileSelectionMode !== 'pack-random'`, keep the existing single-tile or built-in behavior.
2. If pack-random mode is active, resolve the selected pack.
3. Filter the pack to tile ids that still exist in `project.ccCustomTilePatterns`.
4. Pick one tile id from the valid pack members.
5. Freeze that concrete tile id into the shape session settings.
6. Preview and finalize must both use the same frozen tile id.

Do not choose a new random tile on every pointer move.

Do not choose a different tile on mouse-up.

Do not make committed layer content depend on later pack rename, pack membership, or tile deletion.

For V1, the freeze point should be the shape-start settings capture, before `ccShapePreviewDitherRuntime` and finalize dispatch consume pattern settings. Runtime renderers should continue to see `patternStyle: 'image-tile'` plus a concrete `patternTileId`.

## Random Selection

Use deterministic per-mark randomness where practical.

Recommended seed inputs:

- active layer id
- shape/session id or stroke counter
- mark start timestamp or sequence number
- selected pack id

The output only needs to be stable for a single in-progress mark, not reproducible across separate editing sessions.

## Store Actions

Add project store actions:

```ts
addCcCustomTilePatternPack(pack: CcCustomTilePatternPack): void;
renameCcCustomTilePatternPack(packId: string, name: string): void;
removeCcCustomTilePatternPack(packId: string): void;
addCcCustomTilePatternToPack(packId: string, patternId: string): void;
removeCcCustomTilePatternFromPack(packId: string, patternId: string): void;
```

Deletion behavior:

- Removing a pack should not remove its tile patterns.
- Removing a tile pattern should remove that tile id from all packs, unless current tile deletion is blocked because the tile is referenced by live/project content.
- Pack membership is an authoring reference, not committed content. It must not by itself block tile deletion.
- Only live brush state, active settings, persisted project/layer state, or committed layer brush state should block tile deletion.
- If the selected pack is removed, reset pack mode to a safe built-in pattern.
- If the selected pack becomes empty, keep the pack but runtime should fall back safely.

## Persistence Contract

Pattern packs are project data.

Serialize and hydrate `ccCustomTilePatternPacks` next to `ccCustomTilePatterns`.

Do not persist unresolved pack-random state into layer color-cycle brush snapshots for V1. Shape commits should already have resolved a pack member into a concrete tile id before preview/finalize writes pixels and CC metadata.

If later work extends pack-random behavior to stroke/stamp dither, then add explicit persisted brush-state fields such as:

```ts
stampDitherPatternTilePackId?: string | null;
stampDitherPatternTileSelectionMode?: 'single' | 'pack-random' | null;
```

That extension must include hydration/fallback updates in `projectIO` and `ColorCycleBrushCanvas2D`. It is not part of V1.

Load validation:

- invalid pack ids are dropped or regenerated
- blank names become `Pack`
- `patternIds` must be an array of strings
- duplicate pattern ids inside a pack are removed
- missing tile ids are ignored for runtime selection

Preferred behavior: prune missing tile references during load so the UI does not show dead pack members.

## Rendering Contract

The existing image-tile threshold renderer remains the authority for custom tile masks.

For pack-random mode:

- only the mark-start resolver changes
- preview/finalize still call the same image-tile threshold path with a concrete `patternTileId`
- active CC manual or sampled colors remain the color authority
- the custom tile owns only spatial distribution
- unresolved pack ids must never reach `createCcCustomTileThresholdResolver(...)`

Do not alter built-in pattern threshold behavior as part of this feature.

## Tests

Add focused coverage before broad verification.

- Project save/load round-trips a pack with one tile.
- Project save/load round-trips a pack with multiple tiles.
- Pack rename persists through save/load.
- Missing tile ids in pack membership are safely ignored or pruned on load.
- Store action adds a new tile to an existing pack.
- Store action creates a new pack and adds a new tile to it.
- Removing a pack does not remove tile patterns.
- Removing a tile updates pack membership or is blocked consistently with existing tile-reference rules.
- Pattern dropdown renders pack options and selects pack-random mode.
- Add Pattern modal can save into an existing pack.
- Add Pattern modal can create a new pack and save into it.
- Shape start freezes exactly one concrete tile id from the selected pack.
- Shape preview and finalize use the same frozen tile id.
- Empty pack fallback does not clear or corrupt CC layer buffers.
- CC brush switching preserves selected pack mode through `ccBrushDitherSelection`.
- Non-shape/stamp dither paths do not receive unresolved pack-random settings in V1.
- Tile deletion prunes pack membership and pack membership alone does not block deletion.

## Non-Goals For V1

- Global cross-project pattern library.
- Mixing built-in pattern styles inside custom packs.
- Weighted randomness.
- Per-pack animation.
- Per-pack color palettes.
- Changing existing custom tile mask semantics.

## Definition Of Done

- Users can create a new custom tile pattern and add it to an existing pack.
- Users can create a new custom tile pattern and create a new pack in the same modal.
- Users can rename packs in the modal.
- Users can select a pattern pack from the Pattern dropdown.
- Each new CC gradient shape uses one random valid pattern from the selected pack.
- Preview and finalize use the same frozen pattern for a shape.
- Packs and membership persist in `.vs` files.
- Existing built-in patterns and single custom tile selection keep working.
- Focused store, persistence, UI, and shape-session tests pass.
