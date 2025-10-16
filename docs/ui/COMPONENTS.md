UI Components and Usage

Overview
- Use these shared components for consistent styling and behavior across the app.
- Default to these components when building new UI.

Button Groups
- Component: `src/components/ui/ButtonGroup.tsx`
- Purpose: Segmented, mutually exclusive options (Exact style used in Color Cycle Shape).
- Features: wraps on small widths, compact sizes (`sm`, `md`, `lg`), per-button backgrounds.
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
