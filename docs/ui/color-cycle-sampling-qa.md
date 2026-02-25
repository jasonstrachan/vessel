# Color Cycle Sampling QA

- **Brush sampling (toolbar Sample)**
  - Select a color-cycle brush layer, open Brush settings, and choose the `Sample` dropdown action.
  - Confirm the toast instructs you to draw a short stroke, then drag a brief line on the canvas.
  - Verify the brush gradient updates with at least two stops and the toggle disables itself afterward.

- **Recolor sampling (+ Sample)**
  - Switch to a layer in recolor mode (or convert one) and trigger `+ Sample` from the gradient dropdown.
  - Drag a short sampling line; the preview overlay should follow the pointer.
  - Ensure the recolor gradient receives multiple stops oriented along the drag direction.
