# Dev Debug Overlay

Reusable on-screen debug overlay for development-only investigation.

## Enable

In the browser console:

```js
localStorage.setItem('devDebugOverlay', '1');
window.__DEV_DEBUG_OVERLAY__ = true;
```

Reload if needed.

## Disable

```js
localStorage.removeItem('devDebugOverlay');
window.__DEV_DEBUG_OVERLAY__ = false;
```

The overlay also has `hide`, `copy`, and `clear` buttons.

## Use It From Any Module

Import the generic store helper:

```ts
import {
  appendDevDebugOverlayEntry,
  createDevDebugOverlayLogger,
} from '@/utils/dev/debugOverlayStore';
```

Direct append:

```ts
appendDevDebugOverlayEntry({
  source: 'selection',
  level: 'log',
  message: 'selection ROI updated',
  data: { x, y, width, height },
});
```

Scoped helper:

```ts
const debugOverlay = createDevDebugOverlayLogger('export');

debugOverlay.log('export frame encoded', { frame, durationMs });
debugOverlay.warn('fallback encoder path used', { format });
```

## Source Labels

Use short, stable source ids so the overlay stays readable.

Recommended examples:

- `cc`
- `selection`
- `export`
- `undo`
- `webgl`
- `perf`

## Existing CC Compatibility

Current color-cycle debug helpers still work through the compatibility shim in:

- `src/utils/colorCycle/ccDebugOverlayStore.ts`

They now publish into the generic overlay with source `cc`.

## Guidance

- Use this for temporary interactive debugging where DevTools-only logs are too slow or inconvenient.
- Keep it off by default.
- Prefer small payloads in hot paths.
- Remove or gate noisy probes after the bug is understood.
