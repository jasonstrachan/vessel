# Plan: Deconstruct and Bottom-Pack Color-Cycle Shapes

Date: 2026-07-11
Status: one-destination consolidation implemented; real artwork remains geometrically unresolved
Scope: programmatic transformation of selected color-cycle layers in Vessel `.vs` projects and Goblet bundles; no frontend

---

## 0. Goal

Provide a deterministic command that opens a Vessel or Goblet artifact, separates the individual visible CC shapes in selected source layers, rotates them only in pixel-perfect quarter turns, packs them together into one destination CC layer at the bottom of the unchanged canvas, and writes a new valid artifact.

The command must preserve the complete color-cycle behavior of every moved pixel. It must never collapse touching shapes into one packed object without an explicit instruction, and it must never silently guess when an old raster is genuinely ambiguous.

Example target interface:

```bash
npm run pack:cc-shapes -- \
  input.vs \
  --layers "CC Shapes,CC Details" \
  --output output-packed.vs \
  --rotations 0,90,180,270 \
  --padding 1
```

A JSON configuration file will cover exact layer IDs, expected shape counts, split seeds/cuts, and advanced packing policy without turning the command line into an unstable API.

### Implementation progress — 2026-07-11

Implemented:

- Separate pure engine under `src/lib/colorCycle/shapePacking/` for extraction, seeded/cut separation, exact quarter-turns, selected-source global packing, support/stability checks, deterministic beam search with bounded adjacent-order refinement, and synchronized buffer rewriting.
- Project planning boundary under `src/utils/projectPacking/`; it reads and produces changes only for explicitly selected CC documents.
- Headless `.vs` archive adapter preserving unselected canonical layer payloads.
- Goblet JSON, compact/compatible ZIP sidecar, minified metadata, and self-contained HTML adapters.
- CLI: `npm run pack:cc-shapes -- <input> ...`.
- Programmatic JSON report plus source, packed/support, and per-shape contact-sheet SVG proofs.
- Focused coverage for touching-shape seed/cut separation, tiny shapes, `Uint16` definition metadata, quarter-turn mapping, exact clearance, deterministic multi-layer packing, selected-layer isolation, `.vs` archive rewriting, and all Goblet artifact families.

Verified:

- `npm run type-check`
- `npm run lint`
- `npm run verify:goblet-runtime`
- Full Jest suite: 445 passed suites, 3,142 passed tests, 1 intentionally skipped test.

Still required for final visual acceptance:

- Run a user-selected real multi-layer artwork through the CLI.
- Review its source/packed/contact-sheet proofs and real Vessel/Goblet playback.
- Add file-specific seeds/cuts if that old raster contains ambiguous touching silhouettes.
- Record the human visual signoff required by Phase F and the Definition of Done.

### Real-artwork trial — `14.vs`

Tested the explicitly selected layers `CC Layer 1` and `CC Layer 2` from the user-supplied 2000×2000 archive. The original file was not modified.

- The archive uses the older inline brush-state format. The adapter now supports that format and rewrites its stroke, animator, and legacy top-level buffer copies together.
- `CC Layer 2` resolves to one connected visible silhouette at `(61, 1365)`, size `1853×635`, containing `788,163` pixels.
- `CC Layer 1` resolves to one connected visible silhouette at `(174, 0)`, size `1584×1616`, containing `1,711,241` pixels.
- Both layers contain internal gradient-definition discontinuities, but those IDs are evidence rather than guaranteed shape-instance IDs. In accordance with the locked no-guessing rule, the trial stops with `ambiguous-touching-silhouette` until file-specific expected counts plus seeds/cuts are supplied.
- No packed output was written, so Playwright playback review remains correctly blocked rather than validating a guessed decomposition.

After explicit user approval, a best-guess retry used gradient-definition markers as provisional boundaries:

- The heuristic resolved 166 visible pieces across the two selected layers.
- Their combined occupied area is `2,499,404` pixels.
- The deterministic global pile could not place all 166 pieces inside the unchanged 2000×2000 canvas with 1 px clearance and quarter-turn rotations.
- The command failed with `insufficient-space`; it did not write a partial archive.
- The heuristic is opt-in through `--split-by-gradient-def` and is never enabled silently.

After the output contract was corrected to one destination layer:

- The shared transform now remaps colliding gradient slots and `Uint16` definition IDs before packing.
- `.vs` and Goblet adapters write one selected destination CC layer, merge palettes/speeds/definition metadata, and remove the other selected sources only after a successful rewrite.
- Best-guess separation now combines definition discontinuities with connected components; disconnected marks that reuse one definition are no longer fused into giant sparse objects.
- `14.vs` resolves to 416 provisional connected pieces with `2,499,404` occupied pixels.
- With the canvas held at 2000×2000, zero inter-shape padding, all quarter turns, hybrid foundation orderings, and adaptive foundation beam search, the best stable gravity pile places 413 of 416 pieces. The run fails atomically with `insufficient-space`; no partial artifact is written.

---

## 1. Locked requirements and plan defaults

Locked from the request:

- There is no frontend for this feature.
- Only explicitly selected CC layers are rewritten.
- All objects recovered from the selected layers are consolidated into one explicitly selected destination CC layer.
- The destination defaults to the first selected layer unless a stable target layer ID is supplied. Other selected source layers are removed only after a successful atomic rewrite.
- Unselected layers remain byte-for-byte unchanged and do not participate in shape extraction, packing collision, clearance, or support calculations.
- Packing is anchored to the bottom edge of the existing project canvas and grows upward.
- Allowed rotations are exactly `0`, `90`, `180`, and `270` degrees.
- Touching shapes must be separated before packing.
- Low-confidence separation is an error with a diagnostic artifact, not permission to merge shapes.
- Every original visible pixel and every small isolated shape must be preserved. The tool may report ambiguity, but it may not discard fragments.

Safe defaults recorded by this plan, and changeable through configuration:

- Shapes are packed globally and collision-free, then all placements are written to the single destination CC layer.
- Source gradient definition IDs and palette slots must be deterministically remapped into the destination namespace so combining layers cannot change playback colors or animation behavior.
- Every packed shape receives configurable pixel-mask clearance; default `1px`, with `0px` available for direct contact.
- The input file is never overwritten. A separate output path is required for the first version.
- No palette, gradient, dither, speed, flow, phase, opacity, blend-mode, canvas-size, or layer-order changes are allowed.

---

## 2. Honest data-model constraint

Existing `.vs` and Goblet files preserve CC artwork primarily as synchronized per-pixel buffers, not as a durable list of original rectangle, ellipse, triangle, line, or freehand objects.

The canonical channels that must move together are:

- paint/index
- gradient slot ID
- gradient definition ID (`Uint16`)
- speed
- flow
- phase
- erase/alpha mask, when present
- soft-edge mask, when present
- the layer's static image/preview representation, where the format stores one

`gradientDefIdBuffer` is useful evidence but is not a shape-instance ID: multiple marks can reuse the same definition. It must not be treated as proof that all pixels sharing an ID are one shape.

Consequences:

- Disconnected shapes can be recovered exactly.
- Touching but non-overlapping shapes can be separated automatically or with explicit seeds/cuts.
- If two old shapes form a silhouette indistinguishable from one larger shape, the file alone cannot reveal the intended split. Configuration must supply the expected count, seeds, or a cut.
- Overlapped/occluded geometry cannot be exactly recovered because covered pixels no longer exist. The first version must report this instead of inventing hidden pixels.

---

## 3. Supported artifacts

### 3.1 Input

Support adapters for:

1. Vessel `.vs` archive.
2. Goblet JSON.
3. Goblet ZIP smaller, including binary sidecars.
4. Goblet ZIP compatible.
5. Self-contained Goblet HTML.

All adapters normalize selected CC layers into the same internal document shape before segmentation. Do not implement packing separately per file format.

### 3.2 Output

- Preserve the input artifact family by default.
- Rebuild archives/bundles through the existing Vessel/Goblet serialization contracts rather than editing byte offsets in place.
- Recompute manifests, checksums, content bounds, previews, and packaged metadata that depend on transformed buffers.
- Run the existing `.vs` or Goblet payload validator before writing the final output.

### 3.3 Delivery order

Land `.vs` input/output first because it is the authoring source of truth and can produce fresh Goblet exports. Then add Goblet JSON/ZIP, followed by self-contained HTML. The shared transform core must be complete before the second adapter lands.

---

## 4. Proposed architecture

```text
CLI/config
  -> artifact adapter (.vs | Goblet)
  -> normalized selected-layer CC documents
  -> occupancy + evidence maps
  -> exact components
  -> touching-shape separator
  -> quarter-turn variants
  -> gravity-aware pixel-mask packer
  -> atomic multi-buffer rewrite
  -> artifact adapter/validator
  -> new output + diagnostic report
```

Suggested boundaries:

```text
src/lib/colorCycle/shapePacking/
  types.ts
  occupancy.ts
  connectedComponents.ts
  touchingShapeSeparator.ts
  seededPartition.ts
  quarterTurn.ts
  bottomPacker.ts
  rewriteColorCycleBuffers.ts
  validatePackedResult.ts

src/utils/projectPacking/
  packProjectColorCycleShapes.ts
  resolvePackingLayers.ts

scripts/cc-shape-pack/
  cli.mjs (or a TypeScript runner selected during the headless round-trip spike)
  config schema and artifact adapters
```

Rules:

- Algorithms under `src/lib/colorCycle/shapePacking/**` are pure and have no store, canvas, DOM, or filesystem access.
- File-format adapters own decoding/encoding only.
- The project transform owns layer selection and atomic application.
- Reuse the canonical CC document and Goblet payload contracts. Do not create a parallel interpretation of valid CC state.
- Do not route the operation through the drawing orchestration files.

---

## 5. Command and configuration contract

### 5.1 Layer selection

Allow either stable IDs or exact names:

```json
{
  "layers": [
    { "id": "layer_cc_123" },
    { "name": "CC Details" }
  ]
}
```

Rules:

- Missing selector: error.
- Duplicate layer name: error asking for an ID.
- Non-CC selected layer: error.
- Empty selected CC layer: report and skip without mutation.
- A layer not resolved by these selectors is outside the operation completely: it is neither rewritten nor treated as a packing obstacle.

### 5.2 Separation overrides

The automatic separator is the default. Old-file ambiguity can be resolved without a UI:

```json
{
  "separation": {
    "layer_cc_123": {
      "expectedShapeCount": 12,
      "seedGroups": [
        [[120, 84]],
        [[148, 84]]
      ],
      "cuts": [
        { "from": [134, 70], "to": [134, 101] }
      ]
    }
  }
}
```

- A seed identifies a known shape interior.
- Multiple seeds may belong to one shape via a seed group.
- Cuts are barriers for component traversal; they do not delete pixels.
- `expectedShapeCount` is an assertion. A mismatch fails the operation.
- Diagnostics use canvas coordinates so the config remains readable and file-specific.

### 5.3 Packing options

```json
{
  "packing": {
    "padding": 1,
    "rotations": [0, 90, 180, 270],
    "anchor": "bottom",
    "destinationLayerId": "layer_cc_123"
  }
}
```

Do not add scaling. Do not resize the project canvas automatically. Vessel CC buffers are canvas-sized and are coerced to project dimensions on load, so an independently oversized CC raster is not a valid escape hatch; only the destination layer's occupied content bounds may change. If the shapes do not fit, fail with the minimum required height/area in the report. `padding` means clearance around the real occupied-pixel mask, not padding around its rectangular bounding box.

---

## 6. Shape separation algorithm

### 6.1 Occupancy

Build a visible-pixel occupancy map from canonical paint plus applicable erase/alpha state. Soft-edge-only pixels must remain attached to their painted object but must not create bridges between otherwise separate shapes unless they are visibly nonzero above the documented threshold.

Pin the threshold in tests; do not derive it from the current playback frame or rendered color.

### 6.2 Exact first pass

1. Find 8-connected occupied components so diagonal edges are not accidentally split.
2. Within each component, record evidence discontinuities from gradient definition, slot, speed, flow, and phase.
3. Treat discontinuities as split evidence, not unconditional boundaries; a single shape can contain changing per-pixel values.

### 6.3 Touching-shape pass

For every fused component:

1. Apply configured cuts and seeded partitions first because they are explicit.
2. Otherwise find necks/concavities using distance-transform and watershed candidates.
3. Score candidate partitions using recognizable shape continuity: rectangle, ellipse, triangle, line, and compact freeform silhouette.
4. Preserve every candidate fragment. Size may reduce confidence or trigger an ambiguity report, but it must never cause pixel deletion or silent merging.
5. Require a strong confidence margin between the chosen partition and competing partitions.
6. Apply an automatic split only when stored evidence, an asserted expected count, or a clearly dominant silhouette partition supports it. A merely concave or freeform outline is not sufficient evidence by itself.

The output of separation is a set of disjoint pixel masks covering every original occupied pixel exactly once. Touching pixels are assigned to one shape; they are not dropped or duplicated.

Shape preservation outranks automatic completion. If the separator cannot prove that a proposed split preserves recognizable source silhouettes, it must stop and request explicit seeds/cuts rather than risk slicing one legitimate concave shape into several objects.

### 6.4 Ambiguity contract

Fail the selected layer when any of these are true:

- The expected shape count is not met.
- Two materially different partitions have similar confidence.
- A component is equally consistent with one shape and multiple touching shapes.
- The separator would need to synthesize occluded pixels.

Write a machine-readable JSON report and a simple SVG diagnostic showing component bounds, proposed cuts, seeds, and unresolved regions. This remains programmatic and avoids introducing a frontend.

---

## 7. Pixel-perfect transformation

For each separated object:

1. Compute its tight integer bounding box and local binary mask.
2. Copy every canonical CC channel and mask under that local mask.
3. Generate the four allowed rotations using integer coordinate transforms only.
4. Rotate every channel with the exact same mapping.
5. Never use Canvas2D interpolation for CC scalar data.

Quarter-turn mapping must be shared by `Uint8Array`, `Uint16Array`, RGBA preview data, and masks. A single source index must always map to the same destination index in every channel.

---

## 8. Gravity-aware bottom packing

Use a deterministic, gravity-aware integer-grid packer operating on real occupied-pixel masks:

- Canvas width is fixed.
- The available region begins at the bottom row and grows upward.
- Evaluate all allowed quarter-turn variants for each shape.
- Generate several deterministic shape orderings, including maximum side, area, contour compactness, layer order, and original top-left coordinate, always ending ties with the stable shape ID.
- Explore those orderings with a bounded deterministic beam search so an early greedy placement cannot lock the entire pile into an avoidably tall or hollow result.
- Use rectangular bounds only as a broad-phase rejection test. Final collision and clearance checks must use the rotated pixel mask or contour.
- For each candidate rotation and x-coordinate, drop the shape vertically until the next downward step would violate the canvas floor or the configured mask clearance from an already supported shape.
- A placed shape must be supported by the canvas floor or by one or more shapes that already have a support path to the floor. Unsupported/floating placements are invalid.
- Support contacts are derived only from the shape's downward-facing contour against the upward-facing contour beneath it, within the configured clearance. Side-by-side proximity does not count as support.
- A non-floor shape must also be visually stable: its occupied-pixel centre-of-mass projection must fall inside the horizontal span of its effective support contacts. A single remote corner contact cannot support a large shape.
- If a candidate is supported but unstable, deterministically slide and re-drop it left and right within the current packing state. Reject it if no stable position exists.
- Prefer the placement minimizing resulting packed height, then enclosed void area, then unused horizontal space, then x-coordinate.
- After the initial beam result, run bounded deterministic local improvement passes that try adjacent-order swaps, quarter-turn changes, remove/re-drop operations, and horizontal compaction. Keep a change only when it improves the same score without breaking support or stability.
- Define clearance as minimum Chebyshev grid distance between occupied pixels from different shapes: `padding: 0` permits direct horizontal, vertical, or diagonal adjacency but never overlap; `padding: 1` requires at least one empty pixel between occupied masks. Implement this by dilating only the candidate mask by the configured radius when testing against already placed, undilated masks so clearance is not counted twice.
- Never inflate the entire rectangular bounds as the final collision shape.
- Never place two selected shapes on the same destination pixel, even when they belong to different layers.
- Preserve originating layer and global layer order.

After placement, build a support graph. Every shape node must reach the floor node through clearance-aware contact edges and pass the centre-of-mass stability test. With `padding: 1`, a one-pixel visual separation counts as support when another downward step would violate that clearance; with `padding: 0`, support requires direct pixel adjacency.

The same input and configuration must produce byte-identical transformed buffers across runs. The result should read visually as a settled pile rather than a rectangular shelf layout: no floating islands, no avoidable bounding-box gutters, and no large cavity chosen when a tested quarter-turn placement produces a denser supported result.

---

## 9. Atomic rewrite

The rewrite must be planned completely before any layer is changed.

1. Pin the selected layers' canonical snapshots.
2. Segment and pack against those pinned snapshots.
3. Validate complete placement and capacity.
4. Clone destination buffers.
5. Clear only source pixels owned by extracted shapes, using the correct neutral value for each channel/mask.
6. Write all placed channel tuples and masks.
7. Publish one document transaction per affected layer.
8. Rebuild dependent previews/content bounds.
9. Serialize and validate the new artifact.

Any failure before final file write leaves the source file and in-memory source snapshots unchanged.

Do not prune or remap gradient definitions in the first version. Keeping the existing definition store avoids unnecessary payload churn and makes behavior preservation easier to prove.

---

## 10. Implementation phases

### Phase A — Format and round-trip spike

- Prove a headless `.vs` load/serialize round trip using the current `projectIO` contract.
- If browser-only image APIs prevent Node use, extract a pure archive codec boundary; do not duplicate the `.vs` schema in an ad hoc script.
- Inventory neutral/default values for every moved buffer and mask.
- Prove Goblet JSON/sidecar decoding can normalize to the same canonical channel set.
- Record representative fixture hashes before implementing transformation.

Exit gate: unchanged input round-trips through the chosen adapter and validates without semantic buffer drift.

### Phase B — Pure extraction and separation core

- Add occupancy and connected-component extraction.
- Add explicit cuts and seeded watershed partitioning.
- Add automatic touching-shape candidates and confidence reporting.
- Add exact-cover assertions: no missing or duplicated source pixels.
- Add JSON/SVG diagnostics.

Exit gate: separated fixture masks exactly cover their original occupancy, including touching-shape fixtures.

### Phase C — Rotation and gravity-aware packing

- Add shared quarter-turn index mapping.
- Add deterministic pixel-mask packing with configurable clearance.
- Add multiple deterministic shape orderings and bounded beam search.
- Add vertical drop placement, centre-of-mass stability, slide/re-drop relaxation, and the floor-anchored support graph.
- Add bounded local improvement through adjacent-order swaps, quarter-turn changes, remove/re-drop, and horizontal compaction.
- Score stable supported candidates by packed height, enclosed voids, and horizontal waste.
- Pin exact `0px` and `1px` Chebyshev-clearance semantics without double dilation.
- Add capacity failure and minimum-required-space diagnostics.

Exit gate: fixtures settle into a compact floor-supported pile, never collide or float, remain within bounds, preserve every silhouette, and are deterministic.

### Phase D — `.vs` rewrite and CLI

- Transform every synchronized CC buffer and mask.
- Recompute dependent `.vs` metadata/previews.
- Add layer selectors and configuration parsing.
- Add dry-run mode that emits the placement plan, metrics, and visual diagnostics without writing an artifact.
- Write and validate a new `.vs` archive.

Exit gate: Vessel opens the result and selected layers animate correctly with unchanged per-object CC behavior.

### Phase E — Goblet adapters

- Add Goblet JSON input/output.
- Add compact and compatible ZIP sidecars.
- Add self-contained HTML extraction and rebuilding through existing builders.
- Run existing Goblet payload validators and runtime playback gates.

Exit gate: each supported Goblet family loads and plays in the real Goblet runtime after transformation.

### Phase F — Hardening and documentation

- Add malformed archive, missing sidecar, duplicate layer name, unsupported layer, ambiguity, overlap, and insufficient-space tests.
- Document command examples and the override schema.
- Add a dry-run report example.
- Run a representative real, multi-layer Vessel artwork through `.vs` dry-run, output generation, Vessel reload, and Goblet playback. Save the generated proof report and record explicit human visual signoff; the artwork itself may remain local if it cannot be committed.
- Record remaining limitation: exact reconstruction of occluded old geometry requires future persistent shape-instance data.

---

## 11. Verification matrix

### Visual proof artifacts

Every non-dry run and dry run must be able to emit a deterministic proof folder containing:

- A full-canvas source composite.
- A full-canvas proposed packed composite.
- Fixed playback-phase renders for source and packed output at normalized cycle offsets `0`, `0.25`, `0.5`, and `0.75`.
- One contact sheet showing each extracted source silhouette beside its selected rotated result.
- An SVG overlay showing object IDs, occupied contours, clearance contours, support contacts, floor paths, and unresolved split candidates.
- A JSON metrics report containing object count, packed height, occupied area, enclosed void area, packing density, rotation, destination, support parent(s), support span, centre-of-mass stability margin, source/destination layer ID for every shape, and deterministic search/local-improvement statistics.

These are generated files for inspection, not a frontend. They must be produced from the same normalized buffers used by the rewrite so the visual proof cannot drift from the actual output.

The fixed-phase renders are acceptance evidence, not the source of truth for transformation. Per-object mask and channel comparisons remain the exact correctness check.

### Unit fixtures

- One isolated rectangle.
- One legitimate one-pixel/small isolated shape that must survive packing.
- One concave freeform shape that must not be auto-split merely because watershed candidates exist.
- Multiple disconnected shapes using the same gradient definition.
- Two diagonally touching shapes.
- Two edge-touching rectangles with explicit seeds.
- Fused silhouette requiring a cut.
- One shape containing multiple gradient/speed/phase values.
- Soft-edge pixels near another shape without a real visible bridge.
- `Uint16` gradient-definition IDs above 255.
- Every quarter-turn on non-square shapes.
- Mask clearance and exact bottom anchoring.
- Exact `0px` direct adjacency and exact `1px` empty-pixel clearance, including diagonal cases and proof that clearance is not doubled.
- A large shape with only a remote corner contact that must slide/re-drop or be rejected as unstable.
- A fixture where the first greedy shape order is visibly taller than another deterministic order.
- A fixture where a local swap or remove/re-drop pass closes a large avoidable cavity.
- Impossible fit.
- Ambiguous one-large-rectangle versus two-flush-rectangles case must fail without an override.

### Invariants

- Occupied source pixel count equals the sum of extracted object-mask pixels.
- Extracted masks do not overlap.
- Packed destination masks do not overlap.
- Every source CC channel tuple appears exactly once after packing, modulo deterministic coordinate rotation.
- Every destination silhouette equals exactly one allowed quarter-turn of its source silhouette.
- Gradient definition store and palettes are unchanged.
- Canvas dimensions, layer IDs/order, opacity, visibility, and blend modes are unchanged.
- Non-selected layers are byte-equivalent.
- At least one shape is supported by the canvas floor.
- Every other shape has a support-graph path to the floor; no destination shape floats.
- Every non-floor shape passes the centre-of-mass support-span stability test.
- Final clearance is measured between occupied-pixel masks/contours, not rectangular bounds.
- `padding: 0` permits adjacency without overlap; `padding: 1` produces one or more empty pixels, never an accidental doubled clearance.
- The selected placement is the best score found across all required deterministic orderings, beam states, and local-improvement candidates—not merely the best placement within one greedy order.
- No small source component or separator fragment is dropped because of its area.
- A second dry run on the same input/config returns the same plan.

### Repository gates

Run the smallest focused tests first, then:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run verify:goblet-runtime
```

Add real integration coverage for:

- `.vs` load -> pack -> save -> reload -> canonical buffer comparison.
- Goblet JSON/ZIP/HTML load -> pack -> rebuild -> runtime playback.
- A selected multi-layer composite proving global collision-free packing into one destination CC layer, with the other selected source layers absent from the successful output.
- A mixed selected/unselected project proving unselected layers remain byte-for-byte unchanged and do not act as packing obstacles.
- Fixed-phase source/packed proof renders showing unchanged shape-local animation and the final settled bottom pile.
- A representative real multi-layer `.vs` artwork with recorded human signoff that the pile is dense, stable, individually readable, and visually anchored to the canvas bottom.

---

## 12. Definition of done

This work is complete only when:

1. A command can target selected CC layers by ID or exact name with no UI.
2. The command accepts `.vs` and the supported Goblet artifact families.
3. Disconnected and touching shapes become distinct packed objects.
4. Ambiguous touching shapes fail with usable coordinates/diagnostics unless seeds or cuts resolve them.
5. Rotations are limited to exact `0/90/180/270` transforms.
6. Shapes are collision-free and contour-packed into a compact gravity-supported pile against the bottom of the unchanged canvas, with no floating objects or avoidable bounding-box gutters.
7. Every non-floor placement is visually stable under the centre-of-mass support rule, and bounded deterministic search/local improvement has been applied rather than one fixed greedy order.
8. Only selected layers participate; unselected layers are byte-for-byte unchanged and do not affect placement.
9. All canonical CC buffers and masks remain synchronized.
10. The input is untouched and the output validates.
11. Vessel and real Goblet playback show the same palettes and animation behavior on every moved shape.
12. Fixed-phase visual proofs, silhouette contact sheets, support overlays, and packing metrics are emitted from the real transformed buffers.
13. A representative real multi-layer `.vs` artwork receives explicit human visual signoff.
14. Focused, full TypeScript/lint/test, and Goblet runtime gates pass.

---

## 13. Explicit non-goals

- No packing UI or interactive split editor.
- No arbitrary-angle rotation.
- No scaling.
- No automatic canvas resize.
- No modification of unselected layers.
- No invention of occluded pixels from overlapping old shapes.
- No new `.vs` schema solely for this transformation.
- No persistent shape-instance authoring model in this task. That is the correct future solution for exact deconstruction of newly authored files, but it is a separate format/authoring change.
