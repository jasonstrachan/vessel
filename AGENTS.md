# Repository Guidelines

## Project Structure & Modules
- `src/` — main code: `app/` (Next.js), `components/`, `brushes/`, `hooks/`, `lib/`, `stores/`, `utils/`, `styles/`, `workers/`, `presets/`, `pages/`.
- `tests/` and `src/**/__tests__/` — unit/UI tests.
- `public/` — static assets; `assets/` — project media/examples.
- `scripts/` — dev helpers (`dev-server.js`, `dev-monitor.js`).
- `docs/` — plans, architecture, and troubleshooting.

## Build, Test, and Development
- `npm run dev` — monitored dev server (auto-restart, cache handling).
- `npm run dev:raw` — `next dev` directly.
- `npm run build` — production build (static export with `basePath='/tinybrush'`).
- `npm start` — start production server.
- `npm test` — run Jest tests (jsdom + Testing Library).
- `npm run lint` — ESLint (Next + TypeScript rules).
- `npm run type-check` — TypeScript `tsc --noEmit`.
- `npm run clean` / `npm run cache:clear` — clear build caches.

## Coding Style & Naming
- Language: TypeScript (path alias `@/*` per `tsconfig.json`).
- Linting: ESLint extends `next/core-web-vitals` and `next/typescript`; warnings for `no-unused-vars` and `no-explicit-any`.
- Formatting: follow ESLint; prefer 2-space indent, semicolons, and consistent imports.
- Components: PascalCase files in `src/components/` (e.g., `DrawingCanvas.tsx`).
- Utilities/hooks: camelCase (e.g., `useCanvasEvents.ts`, `colorCycle.ts`).
- Prefer named exports; default export only where Next.js requires.

## Testing Guidelines
- Framework: Jest + @testing-library/react (jsdom).
- Locations: `tests/` or `src/**/__tests__/`.
- Filenames: `*.test.ts`/`*.test.tsx` (preferred). Example: `src/utils/__tests__/colorCycle.test.ts`.
- Run: `npm test` (optionally `npm test -- --coverage`). Aim for meaningful coverage of logic and UI behavior.

## Commit & PR Guidelines
- Use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `chore`, `test` (optional scope). Example: `feat(brush): improve rotation caching`.
- Commits: imperative, concise subject (≤72 chars), descriptive body when needed.
- PRs: include clear description, linked issues, and screenshots/GIFs for UI changes. Ensure `lint`, `type-check`, and `test` pass.

## Security & Configuration Tips
- `next.config.ts` sets static export `basePath`/`assetPrefix` for GitHub Pages; `BUILD_TIMESTAMP` is injected via `env`.
- Dev port defaults to `3000`; dev scripts may kill stale processes—avoid running duplicate dev servers.
