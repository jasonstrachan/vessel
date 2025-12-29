# Color Cycle Play/Pause – Focused Code Slices

This file collects the exact sections involved in global play/pause, per-layer `isAnimating`, and RAF start/stop.

---

## 1) Global Play/Pause UI handlers

### AnimationControlsPanel

`src/components/panels/AnimationControlsPanel.tsx:30-97,159-165`

```ts
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore(state => state.forceResumeColorCycle);
  const colorCycleRuntimeHandlers = useAppStore(state => state.colorCycleRuntimeHandlers);
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const suspendDepth = useAppStore(selectColorCycleSuspendDepth);
  ...
  const handleTogglePlayback = React.useCallback(() => {
    if (effectivePlaying) {
      pauseColorCycle('toolbar');
      return;
    }
    playColorCycle('toolbar');
    if (suspendDepth > 0) {
      forceResumeColorCycle('toolbar');
    }
  }, [effectivePlaying, pauseColorCycle, playColorCycle, forceResumeColorCycle, suspendDepth]);
  ...
  <button
    onClick={handleTogglePlayback}
    className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
  >
    <span className="text-[10px]" aria-hidden="true">{effectivePlaying ? '⏸' : '▶'}</span>
    <span className="ml-1 text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
  </button>
```

### MinimalLayerList

`src/components/MinimalLayerList.tsx:296-305,747-764`

```ts
  const desiredPlaying = useAppStore((state) => state.colorCyclePlayback.desiredPlaying);
  const suspendDepth = useAppStore((state) => state.colorCyclePlayback.suspendDepth);
  const playColorCycle = useAppStore((state) => state.playColorCycle);
  const pauseColorCycle = useAppStore((state) => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore((state) => state.forceResumeColorCycle);
  const effectivePlaying = desiredPlaying && suspendDepth === 0;
  const isSuspended = desiredPlaying && suspendDepth > 0;
  ...
  <button
    onClick={() => {
      if (effectivePlaying) {
        pauseColorCycle('toolbar');
        return;
      }
      playColorCycle('toolbar');
      if (suspendDepth > 0) {
        forceResumeColorCycle('toolbar');
      }
    }}
    className="w-full h-10 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
  >
    <span className="text-[10px] mr-1">{effectivePlaying ? '⏸' : '▶'}</span>
    <span className="text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
  </button>
```

---

## 2) Store slice that global Play/Pause updates

`src/stores/useAppStore.ts:698-771` (actions)

```ts
      const playColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            desiredPlaying: true,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };

      const pauseColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            desiredPlaying: false,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };

      const suspendColorCycle = (reason: CCReason) => {
        set((state) => {
          const playback = state.colorCyclePlayback;
          const nextDepth = Math.max(0, playback.suspendDepth) + 1;
          return {
            colorCyclePlayback: {
              ...playback,
              suspendDepth: nextDepth,
              lastReason: reason,
              recentReasons: appendColorCycleReason(playback, reason),
            },
          };
        });
      };

      const resumeColorCycle = (reason: CCReason) => {
        set((state) => {
          const playback = state.colorCyclePlayback;
          const nextDepth = Math.max(0, playback.suspendDepth - 1);
          return {
            colorCyclePlayback: {
              ...playback,
              suspendDepth: nextDepth,
              lastReason: reason,
              recentReasons: appendColorCycleReason(playback, reason),
            },
          };
        });
      };

      const forceResumeColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            suspendDepth: 0,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };
```

`src/stores/useAppStore.ts:1006-1012` (selectors)

```ts
export const selectColorCyclePlayback = (state: AppState): ColorCycleUIState => state.colorCyclePlayback;
export const selectColorCycleDesiredPlaying = (state: AppState): boolean =>
  state.colorCyclePlayback.desiredPlaying;
export const selectColorCycleSuspendDepth = (state: AppState): number =>
  state.colorCyclePlayback.suspendDepth;
export const selectEffectiveColorCyclePlaying = (state: AppState): boolean =>
  state.colorCyclePlayback.desiredPlaying && state.colorCyclePlayback.suspendDepth === 0;
```

---

## 3) RAF start/stop + animation loop

### Stop path

`src/hooks/useDrawingHandlers.ts:2337-2524`

```ts
  const stopContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    ...
    continuousColorCycleAnimationActiveRef.current = false;
    if (continuousColorCycleAnimationRef.current) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
      ccLog('cancel global RAF', { reason });
    }
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }
    if (colorCycleAnimationRef.current) {
      cancelAnimationFrame(colorCycleAnimationRef.current);
      colorCycleAnimationRef.current = null;
      ccLog('cancel per-stroke RAF', { reason });
    }

    // Ensure store flags reflect paused state
    try {
      const st = storeRef.current;
      st.layers.forEach(layer => {
        const shouldPause =
          layer.layerType === 'color-cycle' &&
          layer.colorCycleData?.mode !== 'recolor' &&
          layer.colorCycleData?.isAnimating;

        if (!shouldPause || !layer.colorCycleData) return;

        const updatedData: Layer['colorCycleData'] = {
          ...layer.colorCycleData,
          isAnimating: false,
        };

        st.updateLayer(layer.id, { colorCycleData: updatedData });
        ccLog('mark isAnimating=false', { id: layer.id.slice(-6), reason });
      });
    } catch {}
    ...

    if (reason === 'store-sync' || reason === 'toolbar') {
      try {
        const st = storeRef.current;
        const depth = selectColorCycleSuspendDepth(st);
        if (depth > 0) {
          st.forceResumeColorCycle('toolbar');
        }
        st.pauseColorCycle?.('toolbar');
      } catch {}
    }
  }, [pauseAllBrushCCAnimationsNow, storeRef, cancelDeferredOverlayRender]);
```

### Start path + RAF loop

`src/hooks/useDrawingHandlers.ts:6330-6555`

```ts
  const startContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    ...
    // Mark ALL brush-based CC layers as animating so render loop advances them
    try {
      const st = storeRef.current;
      ccLayers.forEach(layer => {
        const updatedData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: true,
        };
        st.updateLayer(layer.id, { colorCycleData: updatedData });
        ccLog('mark isAnimating=true', { id: layer.id.slice(-6), reason });
      });
    } catch {}

    let lastRenderTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;

    continuousColorCycleAnimationActiveRef.current = true;

    const animateContinuousColorCycle = (timestamp: number) => {
      if (continuousColorCycleAnimationActiveRef.current) {
        continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
        if (typeof window !== 'undefined') {
          window.__ccRafAlive = true;
        }
      } else {
        continuousColorCycleAnimationRef.current = null;
        if (typeof window !== 'undefined') {
          window.__ccRafAlive = false;
        }
        return;
      }

      if (timestamp - lastRenderTime >= frameInterval) {
        const renderedAny = renderAllColorCycleLayers(undefined, false);
        ...
        try {
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        } catch {}
        lastRenderTime = timestamp;
      }
    };

    continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = true;
    }
  }, [ ... ]);
```

### Store subscription deciding play/stop

`src/hooks/useDrawingHandlers.ts:6650-6733`

```ts
  useEffect(() => {
    let previous = getEffectiveColorCyclePlaying();

    const syncPlayback = (playing: boolean, reason: CCReason) => {
      if (playing) {
        const rafAlive = typeof window !== 'undefined' && window.__ccRafAlive === true;
        ...
        if (!rafAlive && !continuousColorCycleAnimationActiveRef.current && !startingColorCycleAnimationRef.current) {
          try {
            const st = storeRef.current;
            const depth = selectColorCycleSuspendDepth(st);
            if (depth > 0) {
              st.forceResumeColorCycle('toolbar');
              ccLog('forceResumeColorCycle(toolbar) due to suspend depth', { depth });
            }
          } catch {}
          startContinuousColorCycleAnimation(reason);
        }
      } else {
        const rafAlive = typeof window !== 'undefined' && window.__ccRafAlive === true;
        let anyAnimating = false;
        try {
          const st = storeRef.current;
          anyAnimating = st.layers.some(
            (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
          );
        } catch {}

        if (
          rafAlive ||
          anyAnimating ||
          continuousColorCycleAnimationActiveRef.current ||
          startingColorCycleAnimationRef.current
        ) {
          stopContinuousColorCycleAnimation(reason);
        }
      }
    };

    syncPlayback(previous, 'startup');

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) return;
      previous = next;
      syncPlayback(next, 'store-sync');
    });

    return () => {
      unsubscribe();
    };
  }, [startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation, getEffectiveColorCyclePlaying, storeRef]);
```

---

## 4) “Stop” call sites that can cancel global play

- End-of-stroke finalize: `src/hooks/useDrawingHandlers.ts:4042-4047`

```ts
              if (getDesiredColorCyclePlaying()) {
                Promise.resolve().then(() => startPlaybackRef.current?.('stroke-end'));
              } else {
                stopContinuousColorCycleAnimation('brush-stroke');
              }
```

- Switch to non-CC layer: `src/components/canvas/DrawingCanvas.tsx:2152-2187`

```ts
  useEffect(() => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    if (isColorCycleLayer) {
      hasStoppedAnimationRef.current = false;
      return;
    }
    if (hasStoppedAnimationRef.current) return;

    try {
      const rm = RecolorManager.getInstance();
      if (rm.isAnimating()) rm.pause();
    } catch {}

    try {
      wrappedStopAnimation();
    } catch {}

    try {
      const st = useAppStore.getState();
      st.layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && l.colorCycleData?.isAnimating)
        .forEach(l => {
          const colorCycleData: Layer['colorCycleData'] = {
            ...(l.colorCycleData ?? {}),
            isAnimating: false
          };
          st.updateLayer(l.id, { colorCycleData });
        });
    } catch {}
    hasStoppedAnimationRef.current = true;
  }, [activeLayerId, layers, wrappedStopAnimation]);
```

- Pan: `src/components/canvas/DrawingCanvas.tsx:2118-2122`

```ts
  const pauseAnimationForPan = useCallback(() => {
    if (pausedAnimationForPanRef.current) return;
    if (!stopAnimationRef.current) return;
    stopAnimationRef.current('pan-start');
    pausedAnimationForPanRef.current = true;
  }, []);
```

- History undo/redo suspends playback: `src/stores/helpers/historyLifecycle.ts:541-606` and `596-644`

```ts
  const undo = async (): Promise<CanvasSnapshot | null> => {
    return runWithColorCycleSuspended('history-apply', async () => {
      ...
      await historyManager.undo();
      ...
      rehydrateColorCycleLayersFromStore();
      return previousSnapshot;
    });
  };

  const redo = async (): Promise<CanvasSnapshot | null> => {
    return runWithColorCycleSuspended('history-apply', async () => {
      ...
      await historyManager.redo();
      ...
      rehydrateColorCycleLayersFromStore();
      return stateToRestore;
    });
  };
```

---

## 5) Global “play state” derivation

- `selectEffectiveColorCyclePlaying`: `src/stores/useAppStore.ts:1006-1012`
- MinimalLayerList derivation: `src/components/MinimalLayerList.tsx:299-305`
- Canvas anyAnimating check (composite refresh): `src/components/canvas/DrawingCanvas.tsx:1138-1149`

```ts
  const anyAnimatingColorCycle = layers.some(
    (layer) =>
      layer.visible &&
      layer.layerType === 'color-cycle' &&
      Boolean(layer.colorCycleData?.isAnimating)
  );
```

---

## 6) Global runtime toggle helper (if used)

`src/utils/colorCyclePlayback.ts:90-131`

```ts
export const toggleGlobalColorCyclePlayback = async (
  shouldPlay: boolean,
  reason: CCReason
): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  const { playColorCycle, pauseColorCycle } = useAppStore.getState();
  if (shouldPlay) {
    playColorCycle(reason);
  } else {
    pauseColorCycle(reason);
  }

  const snapshot = useAppStore.getState();
  const desiredPlaying = selectColorCycleDesiredPlaying(snapshot);
  const effectivePlaying = selectEffectiveColorCyclePlaying(snapshot);
  const suspendDepth = selectColorCycleSuspendDepth(snapshot);

  try {
    if (shouldPlay) {
      if (typeof window !== 'undefined' && window.__ccRafAlive !== true) {
        useAppStore.getState().colorCycleRuntimeHandlers?.start?.('store-sync');
      }
    } else {
      useAppStore.getState().colorCycleRuntimeHandlers?.stop?.('store-sync');
    }
  } catch {}

  await reconcileRecolorPlayback(snapshot.layers, desiredPlaying, reason);
};
```

