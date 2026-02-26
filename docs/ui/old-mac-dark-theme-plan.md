# Old Mac Dark Theme UI Plan

Date: February 26, 2026
Owner: UI track (`vessel-ui`)
Status: Planning complete, implementation pending

## Goal

Restyle the full Vessel interface so it feels like a classic late-80s/90s Macintosh app (System 7 / Mac OS 8 Platinum language), adapted to a dark theme for modern long-session use.

Definition of done:
- Entire shell (toolbar, side columns, panels, modals, shared controls) uses one consistent "Old Mac Dark" visual system.
- Hardcoded one-off grays are removed from core UI flows and replaced with semantic theme tokens.
- Interaction states (default/hover/active/focus/disabled) reflect classic Mac-style depth (raised/inset) and remain keyboard-visible.
- `npm run type-check`, `npm run lint`, and `npm test` pass.

## Historical research summary (what to emulate)

### 1) Consistency and predictable control behavior
Classic Apple HIG emphasizes that consistency lowers cognitive load and user errors, and that controls should behave consistently across apps.

Implication for Vessel:
- Reuse shared primitives (`Button`, `Input`, `Dropdown`, `Tabs`, sliders, switches) as the single styling authority.
- Do not create panel-specific control variants unless behavior truly differs.

Source:
- Inside Macintosh: Human Interface Guidelines (1992), Ch. 1: https://dev.os9.ca/techpubs/mac/HIGuidelines/HIGuidelines-17.html#HEADING17-0

### 2) Build on existing interaction expectations
Classic HIG advises not to redefine common user actions unexpectedly.

Implication for Vessel:
- Keep current keyboard/mouse workflows unchanged; this is a visual and affordance upgrade, not interaction remapping.
- Preserve existing tool layout and panel order in `HomeClient`.

Source:
- Inside Macintosh: Human Interface Guidelines (1992), Ch. 1: https://dev.os9.ca/techpubs/mac/HIGuidelines/HIGuidelines-17.html#HEADING17-0

### 3) Appearance Manager / Platinum language
Mac OS 8 Appearance docs describe a themed UI model where controls should be drawn with system/theme APIs to stay coherent under appearance changes.

Implication for Vessel:
- Use semantic CSS variables as a "theme API" layer.
- Replace direct `#1A1A1A`, `#D9D9D9`, etc., with names like `--mac-panel`, `--mac-bevel-hi`, `--mac-bevel-lo`, `--mac-text-primary`.

Sources:
- Mac OS 8 Appearance Manager docs (legacy): https://dev.os9.ca/techpubs/mac/Appearance_Manager/Appearance_Manager-11.html
- Mac OS 8 Appearance Manager docs (legacy): https://dev.os9.ca/techpubs/mac/Appearance_Manager/Appearance_Manager-77.html

### 4) Typography + restrained color hierarchy
Classic Mac UIs relied on simple typography, clear hierarchy, and restrained ornamentation.

Implication for Vessel:
- Use compact bitmap-adjacent/system-like font stack and tighter spacing rhythm.
- Use color sparingly for state/alerts; keep primary UI mostly neutral grayscale with limited accent usage.

Reference material:
- Apple Human Interface Guidelines (historical archive landing): https://developer.apple.com/design/human-interface-guidelines/
- Historical scan copy (1987 HIG context): https://vintageapple.org/macbooks/pdf/Apple_Human_Interface_Guidelines_1987.pdf

## Important design interpretation

Classic Mac OS was mostly light UI. This project requirement is dark mode. Therefore, this plan applies a **dark Platinum reinterpretation**:
- Keep classic structural cues (bevel, borders, compact controls, simple type hierarchy, clear active states).
- Shift luminance values into dark range while preserving relative contrast logic (raised edge highlight + shadow edge).

This is an intentional inference from the historical sources, adapted to current product requirements.

## Current state audit (repo)

Major shell file:
- `src/app/HomeClient.tsx` has hardcoded colors for page shell and side columns.

Global styles:
- `src/app/globals.css` already defines dark/ascii variables but not a full semantic old-Mac token set.

High-impact hardcoded UI color hotspots:
- `src/components/LeftToolbar.tsx`
- `src/components/panels/LayersPanel.tsx`
- `src/components/panels/ColorPickerPanel.tsx`
- `src/components/panels/BrushLibraryPanel.tsx`
- `src/components/panels/BrushSettingsPanel.tsx`
- `src/components/panels/AlignmentPanel.tsx`
- `src/components/panels/AnimationControlsPanel.tsx`
- `src/components/modals/DocumentModal.tsx`
- `src/components/modals/SettingsModal.tsx`
- `src/components/modals/ExportModal.tsx`
- `src/components/modals/LoadProjectModal.tsx`
- `src/components/modals/LoadProjectModalBody.tsx`

Shared primitive layer (must be themed first):
- `src/components/ui/Button.tsx`
- `src/components/ui/Input.tsx`
- `src/components/ui/Dropdown.tsx`
- `src/components/ui/CustomSwitch.tsx`
- `src/components/ui/ProgressSlider.tsx`
- `src/components/ui/LabeledSlider.tsx`
- `src/components/ui/ButtonGroup.tsx`
- `src/components/ui/Tabs.tsx`

## Implementation plan (detailed)

## Phase 0: Theme contract and migration rules

Deliverables:
- Add "Old Mac Dark" semantic token block to `src/app/globals.css`.
- Add reusable utility classes for raised/inset surfaces and panel chrome.

Token groups:
- App surfaces:
  - `--mac-app-bg`
  - `--mac-canvas-bg`
  - `--mac-panel-bg`
  - `--mac-panel-bg-alt`
- Borders + depth:
  - `--mac-border-strong`
  - `--mac-border-soft`
  - `--mac-bevel-hi`
  - `--mac-bevel-mid`
  - `--mac-bevel-lo`
  - `--mac-inset-hi`
  - `--mac-inset-lo`
- Text:
  - `--mac-text-primary`
  - `--mac-text-secondary`
  - `--mac-text-muted`
  - `--mac-text-disabled`
- State:
  - `--mac-accent`
  - `--mac-focus`
  - `--mac-danger`
  - `--mac-success`
- Modal:
  - `--mac-overlay`
  - `--mac-window-bg`
  - `--mac-titlebar-bg`

Reusable classes:
- `.mac-window` (outer frame + bevel)
- `.mac-titlebar` (compact title strip)
- `.mac-panel` (panel body)
- `.mac-control-raised`
- `.mac-control-inset`
- `.mac-control-pressed`

Migration rules:
- No new raw hex values in app/panel/modal/control classes, except dynamic content previews and domain colors (e.g., palette data).
- Replace inline style borders/backgrounds with semantic classes whenever static.

## Phase 1: Shell and layout chrome

Files:
- `src/app/HomeClient.tsx`
- `src/components/LeftToolbar.tsx`

Changes:
- Replace shell hex classes with semantic classes.
- Apply unified frame and separator treatment for left toolbar and right columns.
- Keep layout geometry unchanged (`260px` columns remain).

Acceptance criteria:
- Main shell appears as one coherent desktop frame.
- No visual mismatch between toolbar, side columns, and panel containers.

## Phase 2: Shared primitive reskin (highest leverage)

Files:
- `src/components/ui/Button.tsx`
- `src/components/ui/Input.tsx`
- `src/components/ui/Dropdown.tsx`
- `src/components/ui/CustomSwitch.tsx`
- `src/components/ui/ProgressSlider.tsx`
- `src/components/ui/LabeledSlider.tsx`
- `src/components/ui/ButtonGroup.tsx`
- `src/components/ui/Tabs.tsx`

Changes:
- Implement raised default controls, inset fields, pressed active states, and clear focus ring.
- Normalize control heights, padding rhythm, and border logic.
- Ensure disabled state uses muted contrast but remains legible.

Acceptance criteria:
- Control states are visually consistent across all panels and modals.
- Keyboard focus is visible for all keyboard-focusable primitives.

## Phase 3: Panel family harmonization

Files:
- `src/components/panels/LayersPanel.tsx`
- `src/components/panels/AlignmentPanel.tsx`
- `src/components/panels/AnimationControlsPanel.tsx`
- `src/components/panels/ColorPickerPanel.tsx`
- `src/components/panels/BrushLibraryPanel.tsx`
- `src/components/panels/BrushSettingsPanel.tsx`
- Supporting sub-panels (selection/crop/color-adjust modules)

Changes:
- Standardize panel headers, section separators, and dense info text styles.
- Remove per-panel color drift and align with semantic tokens.
- Keep domain-specific status badges but map them to theme variables.

Acceptance criteria:
- Any two panels feel like the same app and era.
- No panel introduces isolated styling system.

## Phase 4: Modal window system

Files:
- `src/components/modals/DocumentModal.tsx`
- `src/components/modals/SettingsModal.tsx`
- `src/components/modals/ExportModal.tsx`
- `src/components/modals/LoadProjectModal.tsx`
- `src/components/modals/LoadProjectModalBody.tsx`

Changes:
- Apply `mac-window` frame and titlebar language.
- Unify close buttons, section titles, input rows, footer actions.
- Keep drag behaviors and sizing behavior intact.

Acceptance criteria:
- All modals read as the same window manager style.
- Contrast is sufficient in content-heavy modal (`ExportModal`).

## Phase 5: Cleanup, tests, and docs

Changes:
- Remove dead/duplicate style constants after migration.
- Update or add tests where class expectations or shared component semantics changed.
- Add short theme notes in `docs/ui/COMPONENTS.md` so future controls use theme tokens.

Verification commands:
- `npm run type-check`
- `npm run lint`
- `npm test`

Manual QA checklist:
- Open all primary panels + all modals.
- Verify hover/active/focus/disabled on button/input/dropdown/switch/slider/tabs.
- Validate readability of dense small text labels.
- Validate no low-contrast text in error/success states.

## Risks and mitigations

Risk: Regressions from broad class changes across many components.
- Mitigation: land in phased PRs (shell -> primitives -> panels -> modals), run full checks each phase.

Risk: Over-retro styling hurts readability.
- Mitigation: treat AA-level readability as hard requirement; keep decorative effects subtle.

Risk: Inconsistent ad-hoc accents remain.
- Mitigation: enforce semantic token use and complete a final `rg` scan for raw UI hex values.

## Proposed execution order (commit sequence)

1. `feat(ui): add old-mac-dark semantic theme tokens and utility classes`
2. `refactor(ui): migrate app shell and toolbar to semantic mac chrome`
3. `refactor(ui): reskin shared ui primitives with raised/inset states`
4. `refactor(ui): harmonize panel family styling`
5. `refactor(ui): unify modal windows under mac dark chrome`
6. `docs(ui): document old-mac-dark usage and token rules`

## Source links

- Inside Macintosh: Human Interface Guidelines (1992) - consistency principles:
  - https://dev.os9.ca/techpubs/mac/HIGuidelines/HIGuidelines-17.html#HEADING17-0
- Mac OS 8 Appearance Manager (legacy docs):
  - https://dev.os9.ca/techpubs/mac/Appearance_Manager/Appearance_Manager-11.html
  - https://dev.os9.ca/techpubs/mac/Appearance_Manager/Appearance_Manager-77.html
- Apple HIG portal (historical context / current continuity):
  - https://developer.apple.com/design/human-interface-guidelines/
- Historical scan copy (1987 Apple HIG):
  - https://vintageapple.org/macbooks/pdf/Apple_Human_Interface_Guidelines_1987.pdf
