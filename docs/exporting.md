# Exporting Vessel Projects

Vessel now ships multiple packaging modes so finished canvases can be shared without additional tooling. The export modal lets you choose the bundle format, and the exporter will assemble the appropriate Goblet artifacts automatically.

## Goblet Bundles

The **Packaging** selector inside the Goblet export tab controls how the runtime and bundle are delivered:

- **Goblet bundle (HTML + runtime + JSON)** — produces a zip containing `index.html`, `goblet.js`, and `<project>-goblet.json`. The HTML auto-renders using an embedded copy of the bundle and falls back to the standalone JSON if available, so the archive opens instantly offline while still shipping the raw data file for integrations.
- **Single Goblet HTML (self-contained)** — writes a single `*.html` file with the runtime and bundle inlined. Ideal for drag-and-drop demos or quick email shares. The Goblet UI still accepts dropped JSON bundles for comparison.
- **Goblet JSON only** — matches the legacy behaviour and saves `<project>-goblet.json` without any Goblet assets.

### Zip Contents

When using the Goblet bundle format the archive contains:

| File | Purpose |
| ---- | ------- |
| `index.html` | Standalone Goblet page with inline CSS and automatic bundle playback. |
| `goblet.js` | Runtime renderer reused by the Goblet page. |
| `<project>-goblet.json` | The Vessel Goblet metadata and texture payload. |

Open `index.html` directly in a browser to preview the artwork. Goblet attempts to load the JSON file first and will fall back to the embedded copy if the browser blocks local fetches (common with `file://` URLs), ensuring the bundle still renders offline.

### Single-File HTML

The single-file mode bundles the runtime, metadata, and textures into one HTML document. This is the lightest shareable artifact—just drop the file into a browser window or send it as an email attachment. Because the JSON is inlined, minifying the export is recommended to keep the file size manageable.

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

- Enable **Minify bundle output** to remove whitespace from both the JSON and, for zip exports, compress the archive more aggressively.
- Adjust **Include hidden layers** and **Embed Canvas2D fallback** before exporting—both options are preserved inside the metadata and reflected in the Goblet info panel.
- For automation or CLI integration, call `exportProjectAsWebGL` with the `bundleFormat` option (`'zip' | 'single-html' | 'json'`).


6) Consistent semantics recap (use this as a mental model)

document (first arg to computeLayerTransform) = project doc size.

paintedBounds = the content/pixels actually painted (crop inside the layer).

`fit` tokens map directly to viewer behavior: `contain` uses the document size to preserve aspect, `cover` overfills to remove letterboxing, `fill` stretches each axis independently, `tile` repeats the sampled pixels without scaling, and `none` skips scaling entirely.

offsetPercent applies to leftover space (viewport - renderedSize), not to absolute pixels.

positioning='auto' stores an explicit offsetPercent in exported metadata (never recompute in viewer).

When the three places above align, fill/fit/contain/cover/none, %/anchor/auto, and pixel-snapping all line up.
