UI Components and Usage

Overview
- Use these shared components for consistent styling and behavior across the app.
- Default to these components when building new UI.

Button Groups
- Component: `src/components/ui/ButtonGroup.tsx`
- Purpose: Segmented, mutually exclusive options (Exact style used in Color Cycle Shape).
- Features: wraps on small widths, compact sizes (`xs`, `sm`, `md`, `lg`), per-button backgrounds.
- Example:
  
  import ButtonGroup from '@/components/ui/ButtonGroup';
  
  <ButtonGroup
    options={[
      { label: '15 FPS', value: '15' },
      { label: '30 FPS', value: '30' },
      { label: '60 FPS', value: '60' }
    ]}
    value={fps}
    onChange={setFPS}
    size="sm"
    className="w-full"
  />

Sliders
- Components:
  - `src/components/ui/LabeledSlider.tsx` (preferred): includes label + layout, wraps `ProgressSlider`.
  - `src/components/ui/ProgressSlider.tsx`: bare slider bar only.
- Use LabeledSlider by default for consistent label width and spacing.
- Example:

  import LabeledSlider from '@/components/ui/LabeledSlider';

  <LabeledSlider
    label="Opacity"
    value={opacity}
    min={1}
    max={100}
    step={1}
    onChange={(v) => setOpacity(v)}
    ariaLabel="Opacity"
    className="mb-2"
  />

Toggles
- Component: `src/components/ui/CustomSwitch.tsx`
- Use for on/off controls (pressure, dashed, grid snap, etc.).

Inputs/Dropdowns
- Components: `src/components/ui/Input.tsx`, `src/components/ui/Dropdown.tsx`
- Use these for numeric/text inputs and simple selects.

Notes
- ButtonGroup and Tabs share styling; prefer ButtonGroup for option sets.
- Keep labels concise; prefer label-less groups where context is obvious.

Graphite UI theme
- `src/app/globals.css` owns the shared `--vessel-*` surface, text, border, amber accent, and bevel tokens. Use these tokens for UI chrome; artwork, colour swatches, and colour gradients retain their actual colours.
- The workspace uses the bundled Departure Mono font. Controls stay square, with a one-pixel raised edge for buttons and a recessed edge for editable fields.
- `ProgressSlider` keeps the native range input and its commit lifecycle, with the value alongside the track. `CustomSwitch` is the shared checkbox visual, including the legacy `retroui/Switch` entrypoint.
- `PixelToolIcon` bundles thirteen unmodified Pixelarticons 2.4.2 SVGs (MIT), rendered at their native 24 × 24 size. Keep accessible tool names and shortcuts on their buttons; icons are decorative. Preserve separate SVG paths and their default nonzero fill rule when updating the subset. The upstream licence ships in `public/assets/icons/pixelarticons-LICENSE.txt`.
- Main dialogs use `vessel-dialog`; primary actions use `Button`. Focus indicators use the amber accent and must remain visible for keyboard navigation.

- Use Departure Mono at its native 11px size (or integer multiples), without synthetic bold, on a 16px text line. Shared slider rows are 28px; module headers are 32px. Align panel labels on the same inset.
- Amber denotes selected controls, keyboard focus, or active playback. Idle actions and slider thumbs use graphite/neutral colours.
- Grid follows grid visibility and Sequence follows the active sequence layer until explicitly expanded/collapsed; explicit choices persist. Workspace Alignment starts collapsed. Layers consumes the remaining column height, with a 40% minimum even when the secondary modules are open.
- Toolbar hover labels appear after 450ms, keyboard focus shows them immediately, and Escape/window blur dismisses them. Save status stays in the canvas corner with neutral success styling and a distinct error colour.

- The primary toolbar scrolls in short windows. Its tooltips render outside the scroll container and dismiss on resize, blur, or Escape.
- Dropdown listboxes support Arrow keys, Home/End, Enter/Space selection, and Escape dismissal with focus returned to the trigger; nested editing controls retain their own keyboard input.
