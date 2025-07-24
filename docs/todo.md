# TinyBrush Development Tasks

## Current Task
- [ ] Create a reusable PlusButton component that matches the existing styling

## Completed  
- [x] Fixed cursor alignment issue after panning
- [x] Resolved port 3001 ERR_CONNECTION_REFUSED
- [x] Consolidated documentation structure
- [x] Updated CLAUDE.md to point to /docs/todo.md for planning
- [x] **PIXEL-PERFECT DRAWING IMPLEMENTATION** - Implemented Tom Cantwell's pixel-perfect drawing algorithm
  - [x] Added pixel queue state management with lastDrawn/waiting/current pixel tracking
  - [x] Implemented hybrid speed detection: fast movement uses Bresenham's line algorithm, slow uses pixel queue
  - [x] Fixed antialiasing issues by replacing ctx.stroke() with individual ctx.fillRect() pixel drawing
  - [x] Added stroke start detection to reset pixel queue on mousedown/touchstart
  - [x] Tested at all cursor speeds - works perfectly with no gaps or antialiasing
  - [x] Algorithm follows Tom Cantwell's exact logic: `if (Math.abs(mouseX-lastX) > 1 || Math.abs(mouseY-lastY) > 1)`
- [x] **PRESSURE SENSITIVITY MIN SIZE FIX** - Fixed min pressure values not working
  - [x] Replaced hardcoded `minSizePx = 1` with `activeSettings.minPressure` in executeComponents function
  - [x] Replaced hardcoded `minSizePx = 1` with `tools.brushSettings.minPressure` in renderBrushStroke function
  - [x] Min size values now work correctly for pressure-sensitive brushes
- [x] **PRESSURE SENSITIVITY DEADZONE** - Added pressure threshold for better low-pressure control
  - [x] Added 0.2 pressure threshold in both executeComponents and renderBrushStroke functions
  - [x] Pressure 0.0-0.2 now maps to minimum size for consistent thin lines
  - [x] Pressure 0.2-1.0 maps linearly to full size range

## Next Steps
- [ ] Await next development task

---

## Task Management Notes

This file (`/docs/todo.md`) is the primary planning document for TinyBrush development. 

**When planning any feature or task:**
1. Update the "Current Task" section with specific actionable items
2. Break down complex tasks into smaller steps
3. Move completed items to "Completed" section with checkmarks
4. Add follow-up tasks to "Next Steps" as they're identified

**Task Format:**
- Use clear, actionable descriptions
- Include specific file names or components when relevant
- Mark completion status accurately
- Reference related issues in `/docs/issues.md` when applicable