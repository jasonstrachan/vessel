# Sampled Color-Cycle Pointer-Up Commit

Status: unresolved

Summary:
- When a color-cycle brush stroke uses the sampled gradient path, the stroke does not visually update to its final committed fill on mouse-up.
- The correct-looking fill appears only after the next stroke begins.

Expected behavior:
- On pointer up, a sampled color-cycle stroke should immediately show its final committed fill.
- No extra stroke should be required to reveal the final state.

Scope:
- This is specifically a sampled color-cycle commit/render parity issue on stroke end.
- It is narrower than the separate dither finalize issue.

Keep intact:
- The existing dither finalize fix is real and should remain:
- Stroke dither finalize honors the selected algorithm on mouse-up across all dither modes.

Important note:
- Two attempted fixes for this sampled pointer-up issue were tried and fully reverted because they did not solve the bug and would have made the code worse.
