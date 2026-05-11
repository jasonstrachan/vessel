# CC Custom Tile Pattern Plan

Date: 2026-05-11
Status: Implemented

## Goal

Add project-local custom tile patterns to the CC gradient Pattern dropdown.

Users should be able to paste or import a small tile image, preview how it repeats with the current sampled/manual CC colors, save it into the current project file, select it from the existing Pattern dropdown, and remove it directly from the dropdown.

## UX Contract

The Pattern dropdown remains the main entry point.

- The first row is `+ Add New`.
- Built-in patterns remain available below it.
- Saved custom tile patterns appear in the same dropdown.
- Each saved custom tile pattern row has an `x` action on the right for removal.
- Choosing `+ Add New` opens a modal.

The modal has two panes:

- Left pane: paste/drop/import tile pixels.
- Right pane: live repeated preview using the current CC source colors.

The modal actions are:

- `Save`
- `Cancel`

No separate pattern manager screen is required for the first version.

## Pixel And Ink Semantics

Custom tile images are masks, not color sources.

The active CC source owns color:

- manual selected CC gradient
- sampled CC gradient
- current CC playback/ink resolution

The custom tile owns spatial distribution only.

For the first implementation:

- pasted/imported RGB is converted to luminance
- alpha is respected
- dark/opaque pixels bias toward ink 1
- light/transparent pixels bias toward ink 2
- gray or semi-transparent pixels become intermediate thresholds

For a simple two-ink tile:

- one solid color on transparent background works as a stencil
- the solid shape maps toward ink 1
- transparent area maps toward ink 2

If the user pastes a full-color image:

- the source colors are not preserved
- the image is converted into a grayscale/alpha threshold mask
- the right preview shows the actual recolored CC result before save

### Mask Formula

Use one explicit formula for modal preview, shape preview, finalize, and export/runtime paths.

For each source tile pixel:

```ts
const alpha = a / 255;
const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const threshold = alpha * luminance + (1 - alpha);
```

Interpretation:

- opaque black returns `0`, strongly biasing toward ink 1
- opaque white returns `1`, strongly biasing toward ink 2
- transparent pixels return `1`, matching the "transparent area is ink 2" stencil behavior
- semi-transparent pixels blend between their luminance and ink-2 behavior

`Invert` should flip the resolved threshold with `1 - threshold` after alpha/luminance conversion.

`Threshold`, if included in version one, should be a post-process control over the resolved threshold. If it is deferred, the first version should use the continuous threshold directly.

## Persistence Contract

Custom tile patterns are saved in the project file.

They are not global library items in the first version. A later "Save to Library" flow can be added if needed, but the initial behavior should be per-file and portable with the `.vs` project.

Suggested project data shape:

```ts
type CcCustomTilePattern = {
  id: string;
  name: string;
  width: number;
  height: number;
  rgbaBase64: string;
  createdAt: number;
  updatedAt: number;
};
```

First-version limits:

- maximum tile dimensions: `128x128`
- imported images larger than the cap are downscaled into the cap
- valid dimensions are clamped to at least `1x1`
- payload length must equal `width * height * 4`
- malformed payloads are skipped on load

The tile asset is project data. It is required to reproduce a saved project state, but committed CC layer pixels/buffers must not be destroyed if the authoring tile is removed after a stroke or shape is finalized.

Deletion semantics:

- Removing a tile removes it from the project pattern library.
- If the current brush selection references the removed tile, the brush falls back to a built-in pattern.
- Existing committed layer content remains intact.
- Any saved uncommitted/live preview state referencing a missing tile must fall back safely instead of clearing CC content.

Suggested brush/settings fields:

```ts
patternStyle: 'image-tile';
patternTileId: string | null;
patternTileScale: number;
patternTileInvert: boolean;
patternTileThreshold: number;
patternTileOffsetX: number;
patternTileOffsetY: number;
```

## Architecture

Do not route this through custom brush captured CC data.

Custom brushes are stamp/tip oriented. Custom tile patterns are dither-threshold textures used by CC gradient/pattern rendering. They should be stored and rendered through a dedicated CC pattern tile seam.

The intended rendering split:

- Built-in pattern: use `resolveCcPatternThreshold(...)`.
- Custom image tile: sample wrapped tile coordinates and convert luminance/alpha into a `0..1` threshold.
- Existing CC gradient/sampled pipeline maps the threshold to the current inks.

The custom image tile should integrate with the same CC pattern paths that currently cover gradient, flat, shape preview/finalize, and stamp-dither behavior. It must not create a one-off renderer branch that bypasses CC metadata or animation.

Authoring/runtime dependency rule:

- During authoring and preview, `patternTileId` resolves to a project tile asset.
- During finalization, the selected tile controls the written CC ink distribution.
- After finalization, existing layer pixels and CC metadata are authoritative.
- Removing the tile later must not mutate or erase committed layer content.
- Export/Goblet should include tile-pattern logic only if an exported live/preview/runtime path still needs to evaluate tile masks. Otherwise finalized CC buffers are the export source of truth.

## Implementation Steps

### Step 1: Define Project Data And Store Actions

Status: done.

- [x] Add `CcCustomTilePattern` type to project/types.
- [x] Add `project.ccCustomTilePatterns` or equivalent project-local collection.
- [x] Add store actions:
  - `addCcCustomTilePattern`
  - `removeCcCustomTilePattern`
  - `renameCcCustomTilePattern` if naming is editable in the first version
- [x] Ensure removing the selected custom tile falls back to a built-in pattern.

### Step 2: Add Project File Persistence

Status: done.

- [x] Serialize custom tile patterns into `.vs` project files.
- [x] Hydrate them on project load.
- [x] Validate dimensions and payload length on load.
- [x] Drop malformed tile payloads safely without corrupting the rest of the project.
- [x] Cap imported/saved tiles at `128x128` for version one.
- [x] Ensure committed CC layer data survives tile deletion and project reload.

### Step 3: Build The Modal

Status: done.

- [x] Add a CC custom tile pattern modal component.
- [x] Support paste from clipboard.
- [x] Support file import/drop for PNG-like image sources.
- [x] Normalize imported images into an RGBA tile:
  - preserve source dimensions when they fit the cap
  - downscale larger images into `128x128`
  - preserve alpha
  - use pixel-art-friendly rendering where possible
  - do not trim transparent bounds in version one
- [x] Show raw tile pixels in the left pane.
- [x] Show repeated CC-colored preview in the right pane.
- [x] Use the same mask formula as renderer/finalize.
- [x] Disable `Save` until a valid tile exists.
- [x] Save creates a project-local tile pattern and selects it.
- [x] Cancel leaves project/store state unchanged.

### Step 4: Update The Pattern Dropdown UX

Status: done.

- [x] Put `+ Add New` at the top of the Pattern dropdown.
- [x] List built-in patterns and saved custom tile patterns.
- [x] Add a right-side `x` action for removable custom patterns only.
- [x] Prevent the remove click from also selecting the row.
- [x] Confirm or protect removal when the tile is currently selected.
- [x] Implement or extend a custom pattern dropdown component instead of relying on a native select.
- [x] Preserve keyboard navigation and focus behavior.
- [x] Keep remove actions unavailable on built-in pattern rows.

### Step 5: Add Tile Threshold Rendering

Status: done.

- [x] Add a helper that samples a tile by wrapped `x/y`.
- [x] Convert RGBA to a normalized threshold:
  - luminance from RGB
  - alpha as participation/opacity
  - optional invert/threshold controls
- [x] Use the exact shared mask formula from this plan.
- [x] Wire `patternStyle: 'image-tile'` plus `patternTileId` through CC pattern rendering.
- [x] Handle missing tile IDs with a deliberate fallback, not a silent clear.
- [x] Keep the active CC gradient/sample as the color authority.
- [x] Preserve CC metadata and playback behavior.

### Step 6: Keep Preview And Finalize In Sync

Status: done.

- [x] Verify shape preview uses the same tile threshold as finalize.
- [x] Verify freehand/stamp dither preview uses the same selected tile as mouse-up finalization.
- [x] Verify sampled CC and manual CC both recolor the same tile correctly.
- [x] Verify Goblet/export path if the rendered CC pattern affects exported playback.

### Step 7: Tests

Status: done.

- [x] Project save/load round-trips custom tile patterns.
- [x] Removing a selected tile falls back without leaving a dangling `patternTileId`.
- [x] Removing a tile does not alter previously committed CC layer content.
- [x] Tile threshold helper wraps coordinates and handles alpha/luminance.
- [x] Transparent pixels resolve to ink-2 behavior under the shared mask formula.
- [x] Pattern dropdown renders `+ Add New`, built-ins, custom tiles, and remove controls.
- [x] Remove click does not select the removed pattern row.
- [x] CC gradient dither uses the custom tile as mask while preserving current CC ink colors.
- [x] Preview/finalize parity test for at least one shape path.

## Non-Goals For First Version

- Global pattern library.
- Multi-color source-image palette preservation.
- Per-pattern animation.
- Full image editor tools.
- Custom brush captured-data reuse.

## Open Decisions

- Default tile name: probably `Tile 1`, `Tile 2`, etc.
- Whether `Invert`, `Threshold`, and `Scale` ship in version one or after the minimal paste/save/select flow.
- Whether removal needs a confirmation, undo integration, or silent fallback.

## Definition Of Done

- Users can add a tile from the Pattern dropdown.
- Users can paste/import pixels and see a repeated CC-colored preview before saving.
- Saved tile patterns persist in the current project file.
- Saved tile patterns can be selected and removed from the Pattern dropdown.
- The pasted image acts as a mask; active sampled/manual CC colors remain authoritative.
- Existing built-in patterns keep working.
- Type-check, lint, and focused tests pass.

Status: done.
