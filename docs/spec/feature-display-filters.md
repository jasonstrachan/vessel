# Display Filters Feature Spec

Status: Proposed
Date: 2026-04-13

## Summary

Add an optional stacked display-filter system to Vessel that can reproduce photographed-screen looks such as:

- pixel enlargement
- mild bloom / softness
- LCD subpixel stripe structure
- faint scanline or moire-like banding
- subtle color grading
- light noise

This must be a display-layer effect, not a brush-authoring effect. The source artwork and layer data should remain unchanged.

## Scope

Phase 1 includes:

- a new Filters toolbar entry
- a Filters section inside Settings
- a fixed-order stack of five display filters
- live viewport rendering of enabled filters
- persistence in local settings
- persistence in Vessel project files

Phase 1 excludes:

- export parity
- drag reordering
- named presets
- filter-specific behavior outside the editor viewport

## Non-Goals

This feature must not:

- change stored artwork pixels
- modify brush engine behavior
- alter layer data as part of previewing the effect
- become a workaround for rendering bugs elsewhere in the app
- reduce active drawing responsiveness in order to maintain filtered playback

## Rationale

The reference image is not just "pixelated." It looks like low-resolution pixel art viewed or photographed through a modern display:

- hard pixel blocks
- slight optical blur
- visible vertical panel structure
- mild camera/display interference
- restrained palette and dither-friendly transitions

That means the effect should live after compositing, at the viewport/display stage.

## UX Contract

### Toolbar Entry

Add a new toolbar entry for Filters.

- Label in the current toolbar language: `Fl`
- Behavior: opens Settings and lands directly in the Filters section
- This should not become a second full editor surface unless the current modal becomes too cramped

Requirements:

- the toolbar button must be keyboard accessible
- the toolbar button must expose a clear screen-reader label
- opening Filters must not create a parallel settings state disconnected from the main Settings modal

### Settings Surface

Add a Filters section inside Settings.

- Filters are shown as stacked cards
- Each filter card has:
  - header label
  - enable/disable toggle in the header
  - controls for that filter below
- Filters can be stacked
- Order is fixed in phase 1
- Cards for disabled filters remain visible but collapsed or visually muted

Requirements:

- toggling a filter must update the viewport immediately
- changing filter controls must update the viewport immediately
- filter controls must remain usable while color-cycle playback is running
- overlays, cursors, selection UI, and handles must remain unfiltered

### Phase 1 Filter Stack

Phase 1 filters, in fixed order:

1. Pixelate
2. Bloom
3. Color Grade
4. LCD Mask
5. Noise

This order matches the intended illusion: pixelate first so bloom softens pixel edges rather than chunking pre-softened source; noise last so it sits "on top of the glass" and isn't smeared by bloom.

## Technical Design

### Core Rendering Rule

Apply filters only to the final displayed artwork buffer.

Do not:

- mutate source layers
- bake effects into stroke data
- alter brush behavior
- use filter logic as a workaround for rendering bugs

Requirement:

- disabling all display filters must produce the same visual result as today, aside from existing display-mode behavior

### Render Insertion Point

Current canvas architecture already has the right seam:

- composition happens before final display
- the viewport canvas renders the composed result
- overlay/UI canvases are separate

The filter pass should sit between:

- final artwork composite
- viewport presentation

The overlay/UI canvas must remain unfiltered so selections, cursors, and handles stay sharp and readable.

Requirement:

- the filter pass must operate only on the final artwork image, before overlay/UI drawing

### Rendering Model

Phase 1 implementation:

- render artwork as usual
- copy final artwork into a post-process buffer
- run enabled filters in sequence
- draw the result to the display canvas
- draw overlays/UI after that

Canvas2D-first for phase 1 unless measured evidence justifies WebGL.

Requirement:

- the implementation must skip the post-process path entirely when no filters are enabled

### Filter Definitions

#### Pixelate

Purpose:

- produce the blocky low-resolution base

Implementation:

- downsample to a smaller offscreen canvas
- upscale with nearest-neighbor

Controls:

- cell size (cell size of 1 effectively disables the filter)

Note: no mix/intensity slider. Blending nearest-neighbor upscale with the original source produces ghosted edges and half-sharp transitions that don't correspond to any real optical phenomenon. Intensity is controlled entirely through cell size.

Requirements:

- upscale must use nearest-neighbor behavior
- the filter must not introduce semi-soft blending artifacts

#### Bloom

Purpose:

- add slight optical softness, not heavy glow

Implementation:

- blur a downsampled copy of the filtered image (quarter or eighth resolution) and upscale — the softness hides the low resolution and keeps cost sub-1ms
- composite it back at low intensity

Controls:

- blur radius
- intensity

Guardrail:

- maximum blur radius capped at 12px in phase 1
- this cap is a spec constraint, not an implementation detail — do not leave it to discretion

Requirements:

- bloom must operate on a downsampled copy
- bloom intensity must remain low by default

#### Color Grade

Purpose:

- compress and tune the image toward the photographed-screen feel

Implementation:

- brightness, contrast, saturation
- must avoid `getImageData`/`putImageData` pixel loops — use `globalCompositeOperation` tricks (overlay, multiply, screen with solid color fills) to stay on the GPU-accelerated Canvas2D path
- the implementation approach must be decided and validated before building, not discovered during profiling

Controls:

- brightness
- contrast
- saturation

Phase 2 candidates:

- warmth slider (the photographed-screen reference has slightly warm midtones)
- shadows/highlights split (crushed shadows are a key part of the target look)

Requirements:

- phase 1 color grading must avoid `getImageData` / `putImageData` pixel loops on the main display path
- phase 1 color grading must stay on the compositing path

#### LCD Mask

Purpose:

- add the vertical RGB subpixel stripe structure that is central to the reference look

Implementation:

- overlay a repeating thin vertical R/G/B stripe pattern at low opacity, multiplicative blend
- stripe period should lock to the pixelate cell size to avoid moiré artifacts that read as bugs rather than atmosphere
- optional low-opacity horizontal banding (scanline)

Controls:

- stripe opacity
- scanline opacity

Guardrail:

- keep this subtle; the effect should read as panel texture, not a novelty overlay
- phase 1 ships the RGB subpixel version only; no "simplified vertical stripe" alternative

Requirements:

- stripe period must align with the pixelate cell size
- scanline contribution must stay optional and low-opacity

#### Noise

Purpose:

- break digital flatness
- help sell the camera/display feel

Implementation:

- low-opacity monochrome or slightly tinted grain
- tileable pattern canvas, generated once and cached — do not regenerate per frame

Controls:

- opacity
- scale

Requirements:

- the noise texture must be cached
- the noise texture must not be regenerated every frame

## Performance Constraints

### Frame Budget Policy

Filters apply live to every displayed frame, including during color-cycle playback. Do not restrict filters to static previews.

Accept dropped frames during cycling + filters. If the filter stack can only sustain 24fps with cycling active, that is acceptable — the choppy frame rate reinforces the lo-fi photographed-screen aesthetic. Do not architect around maintaining 60fps for filtered cycling playback.

The only path that must remain at full frame rate is active drawing input.

Requirements:

- active drawing responsiveness takes precedence over filtered playback smoothness
- choppy filtered playback is acceptable; input lag is not

### Active Drawing Policy

During active drawing (pointer-down → pointer-up), either:

- bypass the filter stack entirely, or
- run filters at reduced frequency (e.g. every 3rd frame, unfiltered on others)

Restore full filtered display on pointer-up.

Drawing latency is the most perceptually sensitive metric in a drawing app. Users feel an extra 5ms immediately. The filter stack must not add visible latency to stroke preview. This policy should be built into the architecture from the start — it is painful to retrofit.

Requirement:

- phase 1 must include an explicit active-drawing bypass or degrade strategy

### Caching

Cache everything that doesn't depend on the current frame's pixel data:

- noise pattern: regenerate only when noise settings change
- LCD mask pattern: regenerate only when mask settings or cell size change
- bloom blur kernel: stable unless radius changes

Only pixelate and color grade need to process fresh pixel data each frame.

Requirement:

- cached assets must regenerate only when their relevant settings change

### Implementation Cost Targets

Rough per-filter budget on a ~1000×1000 canvas at 2× DPR:

- Pixelate (downsample + nearest-neighbor upscale): < 1ms
- Bloom (blur downsampled copy + composite): < 1ms with quarter-res blur
- Color grade (compositing-op approach): < 1ms
- LCD mask (cached pattern overlay): < 1ms
- Noise (cached pattern overlay): < 1ms

Total filter overhead target: < 5ms per frame.

The critical cost trap is color grading via `getImageData` pixel loops, which would blow this budget to 3–8ms on its own. The compositing-op approach avoids this entirely.

Target:

- full phase 1 stack should aim to stay below 5ms overhead per frame on a roughly 1000×1000 viewport at 2× DPR

### Scaling

- skip the filter pass entirely when all filters are disabled
- reuse offscreen canvases from existing pooling patterns where practical
- if profiling reveals problems on large canvases / high DPR, add adaptive internal filter resolution as a fallback (render filters at reduced resolution and upscale)

## State Model

Add display filter state to canvas/display settings, not tool state.

Shape:

- array of filter configs
- each config includes:
  - stable filter id
  - enabled flag
  - per-filter settings

This allows:

- stacked filters
- future reorder support
- persistence in existing settings storage

Requirements:

- filter state belongs to canvas/display state, not tool state
- each filter config must have a stable id
- each filter config must persist its enabled flag and parameters

## Persistence

### Local Settings

Persist filter settings with existing local canvas/display preferences:

- enabled filters
- filter parameter values

Do not store transient runtime buffers or generated textures.

### File Format

Persist filter config in the Vessel file format even though exports do not apply filters in phase 1. This ensures that when export parity ships later, existing saved works already have their filter settings intact. Deferring both file persistence and rendering would lose user intent in the gap.

Requirement:

- saved projects must round-trip filter configuration exactly, even when runtime filters are disabled globally or exports ignore them

## Export Behavior

Phase 1: runtime display filters only. Exports are unaffected and remain source-accurate.

Document this explicitly so users understand that what they see in the editor is a display lens, not baked into exports.

If export parity becomes a requirement later, update both:

- standard export path
- Goblet/WebGL export path

in the same change.

Requirement:

- phase 1 exports must remain unchanged by display filter state

## UI Notes

The current aesthetic should stay compact and utilitarian.

Filters section should use:

- small stacked cards
- clear toggles
- restrained labels
- no decorative "effect marketplace" styling

Card structure:

- header row: filter name + toggle
- body: 1–3 sliders or selects
- disabled filters remain visible but collapsed or visually muted

Filter slider adjustment should work while color-cycle playback is running, so the user can dial in the look while watching the animation respond. This is the most satisfying way to tune the effect and should not be blocked by settings modals pausing playback.

## Phase 1 Decisions

The following open questions are now resolved for phase 1:

1. **Filter order**: fixed in phase 1. Reordering adds drag-interaction complexity for minimal gain with only five filters.
2. **Exports**: source-accurate in phase 1. Correct scope boundary.
3. **Named presets**: no presets in phase 1. Ship raw controls, observe what values users actually land on, then crystallise those into presets in phase 2.
4. **Filter surfaces**: editor preview only in phase 1. Applying filters in Goblet or other surfaces is export-parity work and belongs in phase 3.

## Future Work

Later phases may add:

- drag reordering
- reset-to-default per filter
- named presets
- expanded color grading controls
- export parity
- optional WebGL/fullscreen shader implementation
- adaptive filter resolution fallback

## Rollout

### Phase 1

- Filters toolbar button (`Fl`)
- Settings → Filters section
- fixed stack order
- five base filters with resolved specs (no mix slider on pixelate, RGB subpixel LCD mask locked to cell size, 12px bloom cap, compositing-op color grade)
- runtime-only display effect
- Canvas2D implementation
- filter config persisted in file format
- active-drawing bypass policy
- live filter adjustment during cycling playback

### Phase 2

- drag reorder
- reset-to-default per filter
- color grade: warmth slider, shadows/highlights split
- presets derived from observed user settings:
  - LCD Photo
  - Soft CRT
  - Clean Pixel
  - Camcorder Screen

### Phase 3

- export parity (standard + Goblet paths in same change)
- optional WebGL/fullscreen shader path if needed for performance or fidelity
- adaptive filter resolution fallback if large canvas / high DPR profiling demands it

## Validation Checklist

Before shipping:

- filters off means no visual regression
- overlays remain crisp and unfiltered
- panning/zooming remains responsive
- drawing latency does not materially worsen (verify active-drawing bypass is working)
- color-cycle playback remains usable with full filter stack (dropped frames acceptable, stalls not)
- filter sliders update the display live during cycling playback
- settings persist across reload
- filter config persists in saved files
- toolbar entry is keyboard and screen-reader accessible
- color grade does not use getImageData path
- bloom blur operates on downsampled copy
- LCD mask period aligns with pixelate cell size
- noise and LCD mask patterns are cached and not regenerated per frame
