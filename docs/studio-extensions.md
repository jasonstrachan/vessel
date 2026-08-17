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

## Persistent local studio

The normal private studio runs as a loopback-only macOS LaunchAgent at
`http://localhost:3010`. Install or refresh it once with `npm run studio:install`.
After that it starts at login and restarts after crashes, so using the studio
does not require a terminal command.

The service starts the last successful production bundle immediately. Changes
under public `src/` or `public/`, relevant root configuration files, or the
connected private extension trigger a background production build. The service
switches bundles only after the new build succeeds; a failed build leaves the
previous studio running. Pattern-pack changes remain runtime data and do not
trigger a rebuild.

Maintenance commands are:

- `npm run studio:status`
- `npm run studio:restart`
- `npm run studio:logs` (`node scripts/studio-service.mjs logs --follow` to follow)
- `npm run studio:uninstall`

`npm run dev:studio` remains available only for active extension development
when hot reloading is useful. The persistent production service binds to
`127.0.0.1` internally, not the local network.

## Private pattern folders

Pattern packs remain data-only. A user can connect a local folder once from the
pattern dropdown; Vessel stores the browser directory handle and synchronizes
current `.vpatternpack` files on startup, window focus, or explicit sync. The
browser may require permission to be granted again after restart. IndexedDB is
a runtime cache, not the canonical backup.
