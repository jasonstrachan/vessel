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

### Tips

- Enable **Minify bundle output** to remove whitespace from both the JSON and, for zip exports, compress the archive more aggressively.
- Adjust **Include hidden layers** and **Embed Canvas2D fallback** before exporting—both options are preserved inside the metadata and reflected in the Goblet info panel.
- For automation or CLI integration, call `exportProjectAsWebGL` with the `bundleFormat` option (`'zip' | 'single-html' | 'json'`).
