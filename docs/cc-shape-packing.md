# Programmatic CC Shape Packing

`pack:cc-shapes` separates the visible color-cycle shapes on explicitly selected source layers, rotates them in exact quarter turns, and packs them together into one destination CC layer at the bottom of the unchanged canvas.

It accepts Vessel `.vs` files and Goblet JSON, ZIP, or self-contained HTML artifacts. The input is never overwritten.

## Basic use

```bash
npm run pack:cc-shapes -- input.vs \
  --output output-packed.vs \
  --layers "CC Shapes,CC Details" \
  --padding 1 \
  --rotations 0,90,180,270
```

Select duplicate layer names by stable ID:

```bash
npm run pack:cc-shapes -- input.vs \
  --output output-packed.vs \
  --layer-ids "layer-123,layer-456"
```

Consolidate multiple selected sources into a specific selected destination:

```bash
npm run pack:cc-shapes -- input.vs \
  --output output-packed.vs \
  --layer-ids "layer-123,layer-456" \
  --destination-layer-id "layer-123"
```

For an explicitly approved best guess on an old raster, `--split-by-gradient-def` treats gradient-definition discontinuities as boundaries while still keeping disconnected regions separate. It is never enabled by default.

Use `--dry-run` to generate reports without writing an output artifact. Reports include `packing-report.json`, `source-preview.svg`, `packing-preview.svg`, and `shape-contact-sheet.svg`.

## Touching shapes

Old Vessel/Goblet files contain rasterized CC buffers rather than original shape objects. Disconnected shapes are exact. Touching shapes that are ambiguous require programmatic seed groups or cut barriers:

```json
{
  "layers": [{ "id": "layer-123" }],
  "separation": {
    "layer-123": {
      "expectedShapeCount": 2,
      "seedGroups": [
        [{ "x": 120, "y": 84 }],
        [{ "x": 148, "y": 84 }]
      ],
      "cuts": [
        {
          "from": { "x": 134, "y": 70 },
          "to": { "x": 134, "y": 101 }
        }
      ]
    }
  },
  "packing": {
    "padding": 1,
    "rotations": [0, 90, 180, 270],
    "beamWidth": 8,
    "minimumSupportSpanRatio": 0.1
  }
}
```

Run it with:

```bash
npm run pack:cc-shapes -- input.vs \
  --output output-packed.vs \
  --config packing-config.json
```

The command fails rather than silently merging an asserted touching-shape count or inventing pixels hidden by an overlap.

A selected layer containing one multi-pixel connected silhouette is ambiguous in a raster-only artifact: it may be one shape or several touching shapes. Confirm a known single shape with `expectedShapeCount: 1`; otherwise provide the expected count with seeds/cuts. Fully erased paint is excluded from visible occupancy and cannot connect shapes.

## Scope and guarantees

- Only selected CC layers participate in extraction, collision, support, or rewriting.
- Unselected layers do not act as packing obstacles and their layer payloads are left unchanged.
- All selected-source shapes are consolidated into one destination CC layer. Cross-layer gradient definitions, palette slots, and slot speeds are remapped into one collision-free namespace.
- CC paint, gradient IDs, `Uint16` gradient-definition IDs, speed, flow, phase, and available masks rotate together.
- Rotations are limited to `0`, `90`, `180`, and `270` degrees.
- The project canvas dimensions do not change. Vessel CC buffers remain project-canvas-sized; only the destination layer's occupied content bounds may change.
- Goblet layers with scaled or fractional placement are rejected; use the source `.vs` file for a pixel-perfect transformation.
- Goblet brush layers that depend on source-image alpha are rejected because removing or relocating the source texture would change partially transparent pixels. Pack the source `.vs` file or use an artifact with opaque index alpha.
