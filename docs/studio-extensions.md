# Studio extensions

Vessel keeps practice-specific authoring tools outside the public repository.
The public codebase owns only generic, reusable contracts and the durable
document/runtime infrastructure required to preserve and display their output.

## Boundary

- Public Vessel may define generic extension hooks, serializable extension
  settings, document schemas, renderers, exporters, and privacy checks.
- Personal presets, authored behavior, names, copy, source assets, and evolving
  interactions belong in a separate private repository.
- Moving a feature across this boundary is an explicit product decision. A
  private tool is never promoted merely because it has become technically
  reusable.

## Local connection

An ignored `.vessel-studio/extension` link may point to a local extension whose
entrypoint is `index.tsx`. `npm run dev:studio`, `npm run type-check:studio`,
`npm run test:studio`, and `npm run build:studio` opt into that source.

Normal development and public static exports resolve the no-op extension. A
static export refuses studio mode, and `npm run verify:public-patterns` rejects
tracked studio content or a release attempted with `VESSEL_STUDIO=1`.

## Private pattern folders

Pattern packs remain data-only. A user can connect a local folder once from the
pattern dropdown; Vessel stores the browser directory handle and synchronizes
current `.vpatternpack` files on startup, window focus, or explicit sync. The
browser may require permission to be granted again after restart. IndexedDB is
a runtime cache, not the canonical backup.
