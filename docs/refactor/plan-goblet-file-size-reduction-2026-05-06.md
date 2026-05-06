# Goblet File Size Reduction Plan - 2026-05-06

Status: First pass implemented.

Goal: reduce exported Goblet file size without weakening playback fidelity,
Color Cycle metadata, display-filter parity, static export behavior, or the
ability to diagnose broken artifacts from the real exported file.

This plan is intentionally split into small slices. The current exporter already
crops sparse brush payloads, packs byte-range buffers as `b64z:` deflate strings,
deduplicates gradients, and avoids per-pixel speed buffers when Goblet 2 slot
speeds are sufficient. The remaining wins are mostly packaging and payload
format work, not broad renderer rewrites.

## Current Evidence

- Goblet ZIP bundles currently include the full metadata twice:
  - once embedded into `index.html` as packaged fallback metadata via
    `createZipGobletHtml()`;
  - once as the standalone `*-goblet.json` file inside the ZIP.
- ZIP compression works per entry, so duplicated JSON in separate files does
  not get shared dictionary dedupe. Large artwork metadata can therefore bloat
  ZIPs materially.
- Single-file Goblet HTML has a fixed runtime cost plus inline metadata. That
  format is expected to be larger than ZIP for substantial artwork because it
  cannot store true binary sidecar files.
- Runtime assets are not the dominant size source. Goblet 2 runtime assets
  compress to tens of KB; large CC buffers, texture data, sequential frames, and
  duplicated metadata dominate larger exports.
- `b64z:` reduces repeated byte buffers well, but base64 still adds overhead and
  JSON still requires large strings or arrays. Truly noisy per-pixel buffers can
  remain expensive.
- 2026-05-06: Added deterministic dense/noisy size coverage. In the focused
  fixture, lean ZIP with binary sidecars is smaller than the compatibility ZIP
  by more than 1 KB, and the measured synthetic 65,536-pixel payload showed
  about 69% reduction in the standalone sizing probe.

## Non-Negotiables

- Do not drop CC buffers, gradient-slot identity, flow/phase data, masks,
  source-alpha behavior, display filters, sequential frames, or viewport/layout
  metadata just to make files smaller.
- Keep Goblet runtime and exported artifact behavior in sync with Vessel
  runtime behavior.
- Preserve a clearly supported portable path for users who need one-file export.
- Validate exported artifacts, not just metadata objects returned by the
  serializer.
- Treat any new compact format as versioned export contract work with runtime
  decode tests.

## Phase 0: Measurement Harness

- [x] Add a small artifact-size report helper for Goblet exports.
  - Input: generated metadata JSON, target format, runtime asset sizes, and ZIP
    entries when available.
  - Output: total bytes plus a breakdown for runtime, HTML shell, metadata,
    textures, sequential frames, CC brush buffers, masks, and fallback preview.
- [x] Add test fixtures for at least three export profiles:
  - sparse CC brush layer;
  - large dense CC brush layer with slot-speed mode;
  - sequential/frame-texture export.
- [x] Record baseline sizes in the test output or a doc note:
  - JSON only, pretty and minified;
  - current ZIP;
  - current single-file HTML.
- [x] Keep the harness deterministic enough for regression thresholds while
  allowing platform-neutral compression variance.

Definition of Done:

- A focused test can fail if a known fixture grows unexpectedly.
- The report identifies whether a large file is metadata duplication, texture
  payload, CC buffers, sequential frames, or runtime shell.

## Phase 1: Lean ZIP Packaging

- [x] Add a packaging mode that does not embed full metadata in `index.html`.
  - Proposed name: `zip-lean` internally, surfaced as "Goblet ZIP (smaller)" or
    made the default ZIP once compatibility is proven.
  - `index.html` should fetch the sidecar JSON and render it.
  - The fallback embedded metadata should be omitted or replaced with a tiny
    error/status payload.
- [x] Keep the current metadata-embedded ZIP behavior available if file:// or
  offline fallback compatibility is still needed.
- [x] Update `createZipGobletHtml()` / `appendZipAutoloadSnippet()` so the
  embedded metadata argument is optional.
- [x] Update `createGobletZipBlob()` to avoid writing duplicated metadata into
  `index.html` for lean ZIP mode.
- [x] Add bundle-contract tests proving:
  - lean ZIP contains one copy of full metadata;
  - current compatibility ZIP still contains fallback metadata if retained;
  - all runtime dependencies remain included.
- [x] Browser-verify the extracted lean ZIP over HTTP, because direct file:// may
  not allow JSON fetch consistently.

Expected Impact:

- High for large ZIP exports because full metadata is no longer duplicated.
- Low implementation risk compared with changing CC serialization.

Definition of Done:

- Current ZIP fixture size drops by the duplicated-metadata amount.
- Extracted ZIP renders in a browser and paints expected pixels.
- Existing single-file Goblet behavior is unchanged.

## Phase 2: Default Minified Production Preset

- [x] Confirm whether the current production preset always sets
  `minifyOutput: true`.
- [x] If not, change the Goblet production preset to use minified metadata by
  default.
- [x] Keep debug/export inspection mode easy to select when readable JSON is
  useful.
- [x] Add modal/store tests for preset output settings.

Expected Impact:

- Moderate for JSON/HTML readability overhead.
- Safe if the minified key expansion path remains covered in Goblet 1 and
  Goblet 2 runtime tests.

Definition of Done:

- Production export defaults to the smaller path.
- Debug/readable output remains intentionally selectable.

## Phase 3: Binary Payload Sidecars In ZIP

- [x] Define a versioned Goblet payload reference format for binary entries.
  - Example:
    - `brushState.indexBuffer: { ref: "buffers/layer-1/index.bin", encoding: "u8" }`
    - `brushState.gradientIdBuffer: { ref: "buffers/layer-1/gradient-id.bin", encoding: "u8" }`
    - equivalent refs for speed, flow, phase, alpha mask, soft-edge mask, and
      recolor index buffers where applicable.
- [x] Keep JSON shape small and explicit:
  - width/height stay in metadata;
  - buffer refs carry byte length and optional checksum;
  - no implicit fallback from missing buffers to empty painted output.
- [x] Update ZIP builder to write binary buffer entries with DEFLATE.
- [x] Update Goblet runtime loading:
  - resolve buffer refs from the extracted Goblet page/metadata folder;
  - fetch as `arrayBuffer`;
  - return `Uint8Array` through the existing `resolveNumericBuffer()` path.
- [x] Preserve existing `b64z:` support for JSON-only and single-file exports.
- [x] Add runtime tests for:
  - binary ref decode;
  - missing binary entry failure;
  - minified metadata expansion with binary refs;
  - Goblet 2 WebGL path receiving typed arrays.
- [x] Add artifact inspection tests proving large buffers are no longer embedded
  in JSON for ZIP exports.

Expected Impact:

- High for large dense/noisy buffers because it removes base64 overhead and keeps
  big data out of JSON.
- Also improves memory behavior during parse because the browser no longer needs
  to parse giant numeric arrays or huge base64 strings inside one metadata blob.

Risks:

- Fetching sidecar binary files means browser-loaded ZIP contents should be
  served over HTTP. Keep single-file and JSON-only paths for one-file workflows.
- Runtime loading order becomes more complex; failures must be visible instead
  of silently rendering blank layers.

Definition of Done:

- ZIP exports use binary sidecars for large eligible buffers.
- JSON-only and single-file exports still render through existing inline
  payloads.
- Browser smoke tests prove rendered pixels match the old format.

## Phase 4: UI And Documentation

- [x] Update Export Modal copy so users can distinguish:
  - smallest ZIP;
  - portable single HTML;
  - readable/debug JSON.
- [x] Do not add live in-app size hints in the first pass; keep sizing in the
  helper/tests so export does not spend extra UI time estimating ZIP output.
- [x] Update `docs/exporting.md` with the practical tradeoffs:
  - ZIP is smallest for large work;
  - single HTML is portable but larger;
  - debug/readable JSON is for inspection, not compact sharing.

Definition of Done:

- Users can choose smaller files without needing to understand internals.
- Docs match the actual exported formats and limitations.

## Validation Matrix

- Unit:
  - `npm test -- tests/export-color-cycle-html.test.ts --runInBand`
  - `npm test -- src/utils/export/__tests__/webglExporter.bundleContracts.test.ts --runInBand`
  - new Goblet size/binary payload tests.
- Runtime:
  - `npm test -- tests/goblet2-runtime-regression.test.ts --runInBand`
  - `npm test -- tests/goblet-display-filters-runtime.test.ts --runInBand`
  - `npm run test:goblet2:single-file-smoke`
- Browser/artifact:
  - generate an actual ZIP;
  - inspect its entries and sizes;
  - serve extracted files over HTTP;
  - render and check canvas pixels.
- General:
  - `npm run type-check`
  - `npm run lint`

## Suggested Implementation Order

1. Build the size report harness first.
2. Ship lean ZIP metadata de-duplication.
3. Make the production preset default to the smaller verified ZIP path.
4. Add binary payload sidecars for ZIP only.
5. Update UI copy and docs for the verified smaller export path.

## When Done

- [x] Goblet ZIP exports no longer duplicate full metadata in `index.html` and the
  sidecar JSON.
- [x] The production/default Goblet path chooses the smaller verified packaging
  mode without removing the portable single-file option.
- [x] Large eligible ZIP-only numeric payloads can be stored as binary sidecars,
  while JSON-only and single-file exports still use the existing inline payload
  contract.
- [x] Exported files have a measurable size report that identifies metadata,
  runtime, CC buffers, masks, textures, sequential frames, and preview/fallback
  costs.
- [x] The smallest ZIP fixture shows a real size reduction against the current
  baseline, and that reduction is documented in the plan or a linked note.
- [x] Extracted ZIP artifacts render over HTTP and pass canvas pixel checks for the
  same fixtures used to measure size.
- [x] Goblet 1/Goblet 2 runtime tests, export contract tests, type-check, and lint
  pass.
- [x] The parked texture/frame follow-up remains out of the first pass unless
  measurements prove those payloads are the dominant remaining source of bloat.

## Parked Follow-Up: Texture And Frame Payload Audit

Status: On ice. This is not part of the first pass. Do not start this work
unless Phase 0 measurements prove texture data or sequential frame data, rather
than duplicated metadata or CC buffers, are the dominant source of file size.

- [ ] Measure texture and sequential frame contributions separately from CC
  buffers.
- [ ] Confirm whether static layer textures are cropped to content bounds before
  export in the same way CC brush payloads are.
- [ ] For sequential exports, detect duplicate frames and write one asset plus a
  frame map instead of repeated data URLs when frames are identical.
- [ ] Consider PNG/WebP options only after validating browser/runtime support and
  visual fidelity.

Expected Impact:

- High only for projects dominated by static textures or sequential frames.
- Keep this separate from CC buffer work so file-size changes remain attributable.

Definition of Done:

- Size report can show texture/frame bloat independently.
- Duplicate-frame fixture exports fewer bytes without changing playback timing.

## Resolved Decisions

- The existing `zip` option is now the smaller ZIP path. The older
  metadata-embedded behavior remains available as `zip-compat`.
- Single HTML remains the portable one-file option.
- JSON-only remains available for inspection/debug workflows.
- No export-size warning threshold was added in the first pass; size reporting
  lives in the helper/tests until a real UI threshold is needed.
