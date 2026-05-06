# Exporting Vessel Projects

Vessel now ships multiple packaging modes so finished canvases can be shared without additional tooling. The export modal lets you choose the bundle format, and the exporter will assemble the appropriate Goblet artifacts automatically.

## Goblet Bundles

The **Packaging** selector inside the Goblet export tab controls how the runtime and bundle are delivered:

- **Goblet ZIP smaller** — produces a zip containing `index.html`, the Goblet runtime, `<project>-goblet.json`, and binary sidecars for large Color Cycle buffers. This is the smallest production-oriented packaging for substantial work. Serve the extracted folder over HTTP so the page can fetch its JSON and sidecar buffers.
- **Goblet ZIP compatible** — keeps the older zip shape with a full metadata fallback embedded in `index.html` as well as the standalone JSON. Use this only when local `file://` fallback behavior matters more than file size.
- **Single Goblet HTML (self-contained)** — writes a single `*.html` file with the runtime and bundle inlined. Ideal for drag-and-drop demos or quick email shares. It is portable, but larger for substantial artwork because metadata and payloads must stay inline.
- **Goblet JSON only** — matches the legacy behaviour and saves `<project>-goblet.json` without any Goblet assets. This is useful for inspection and debugging, not compact sharing.

### Color Cycle Export Contract

Goblet color-cycle export builds animated CC metadata through a single payload builder. The builder resolves an export-local source snapshot, validates the brush/recolor payload, and only then lets the exporter package the layer. Export does not hydrate archived CC data by mutating the live layer object.

When diagnostics are enabled, the export progress modal reports the selected CC source, payload pixel counts, non-zero paint counts, slot/palette counts, and validation diagnostics per layer. Failed animated CC payloads are surfaced as failed layer rows instead of silently falling back to blank static output.

### Viewport Presets

Goblet exports expose four viewport intents:

- **Default export** — maps to Goblet `fit` mode. The full composition stays visible and centered, which is the safest standalone presentation.
- **Embed fill** — preserves the authored composition and uses cover-style viewer scaling so the host container fills without side gutters. Cropping happens at the composition level rather than by re-laying out individual layers.
- **Embed fit** — preserves the authored composition and uses contain-style viewer scaling so the whole composition remains visible inside the host container.
- **Fixed canvas** — preserves an explicit design canvas size for pixel-perfect or manually scaled embeds.

### Zip Contents

When using the smaller Goblet ZIP format the archive contains:

| File | Purpose |
| ---- | ------- |
| `index.html` | Standalone Goblet page with inline CSS and automatic bundle playback. |
| `goblet.js` | Runtime renderer reused by the Goblet page. |
| `<project>-goblet.json` | The Vessel Goblet metadata and texture payload. |
| `buffers/**.bin` | Binary sidecars for large eligible Color Cycle buffers. |

Serve the extracted folder over HTTP and open `index.html` to preview the artwork. The smaller ZIP does not duplicate full metadata inside the HTML shell. If direct offline `file://` opening is required, use **Goblet ZIP compatible** or **Single Goblet HTML** instead.

### Single-File HTML

The single-file mode bundles the runtime, metadata, and textures into one HTML document. It is the most portable shareable artifact: just drop the file into a browser window or send it as an email attachment. It is not the smallest format for large work because the JSON is inlined, so minifying the export is recommended.

### Respecting Base Paths

Goblet assets are fetched using the current Next.js `assetPrefix`/`basePath`, so packaging behaves correctly in local dev (`/`) and on GitHub Pages (`/vessel`). No manual path tweaks are required when exporting from different environments.

### Alignment Runtime Source

- `src/utils/alignment/alignFitResolver.ts` is the canonical implementation for layer positioning, scaling, and percent offset math.
- The Goblet viewer embeds the same logic; run `node scripts/build-align-fit.mjs` after modifying the resolver to regenerate `public/goblet/alignFitResolver.js`.
- Avoid hand-editing the inlined viewer copy—treat it as generated output so exporter and runtime stay in perfect sync.

### Alignment Metadata Glossary

| Field | Purpose |
| ----- | ------- |
| `documentBoundsPx` | Pixel-space rectangle the exporter resolved for the layer inside the project document; renderer uses it for destination placement. |
| `documentBoundsPercent` | Same rectangle expressed as percentages of the project document; keeps layout stable when the viewer resizes. |
| `alignment.offsetPercent` | Final percent offsets applied for anchor positioning and auto-fit modes; derived from bounds during export when `positioning === 'auto'`. |
| `layoutPlacement` | Optional resolved frame + transform from the container layout engine; viewer recomputes only when this block is missing. |
| `contentBounds` | Crop inside the layer surface that contains painted pixels; used to trim the sample region when drawing. |

### Tips

- Enable **Minify bundle output** to remove whitespace from JSON and use stronger archive compression.
- Adjust **Include hidden layers** and **Embed Canvas2D fallback** before exporting—both options are preserved inside the metadata and reflected in the Goblet info panel.
- Use **Goblet ZIP compatible** when the export may be opened directly from disk. **Goblet ZIP smaller** stores JSON and binary buffers as sidecar files and must be served over HTTP so Goblet can fetch those files.
- For automation or CLI integration, call `exportProjectAsWebGL` with the `bundleFormat` option (`'zip' | 'zip-compat' | 'single-html' | 'json'`).


6) Consistent semantics recap (use this as a mental model)

document (first arg to computeLayerTransform) = project doc size.

paintedBounds = the content/pixels actually painted (crop inside the layer).

`fit` tokens map directly to viewer behavior: `contain` uses the document size to preserve aspect, `cover` overfills to remove letterboxing, `fill` stretches each axis independently, `tile` repeats the sampled pixels without scaling, and `none` skips scaling entirely.

offsetPercent applies to leftover space (viewport - renderedSize), not to absolute pixels.

positioning='auto' stores an explicit offsetPercent in exported metadata (never recompute in viewer).

When the three places above align, fill/fit/contain/cover/none, %/anchor/auto, and pixel-snapping all line up.
