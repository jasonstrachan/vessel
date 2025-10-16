import { useMemo, useRef, useCallback } from 'react';

export interface PanSnapshot {
  offsetX: number;
  offsetY: number;
  isPanning: boolean;
}

export type PanEvent = 'start' | 'change' | 'set' | 'end' | 'reset';

interface SimplePanOptions {
  scale?: number;
}

type PanListener = (state: PanSnapshot, event: PanEvent) => void;

export function useSimplePan(options: SimplePanOptions = {}) {
  const { scale = 1 } = options;

  const panStateRef = useRef<PanSnapshot>({
    offsetX: 0,
    offsetY: 0,
    isPanning: false
  });

  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  const listenersRef = useRef(new Set<PanListener>());

  const emit = useCallback((event: PanEvent) => {
    const snapshot = panStateRef.current;
    listenersRef.current.forEach(listener => {
      listener(snapshot, event);
    });
  }, []);

  const setPanSnapshot = useCallback(
    (next: PanSnapshot, event: PanEvent, silent = false) => {
      const prev = panStateRef.current;
      if (
        prev.offsetX === next.offsetX &&
        prev.offsetY === next.offsetY &&
        prev.isPanning === next.isPanning
      ) {
        return;
      }
      panStateRef.current = next;
      if (!silent) {
        emit(event);
      }
    },
    [emit]
  );

  const getState = useCallback(() => panStateRef.current, []);

  const startPan = useCallback((x: number, y: number) => {
    panStartRef.current = { x, y };
    panStartOffsetRef.current = {
      x: panStateRef.current.offsetX,
      y: panStateRef.current.offsetY
    };
    if (!panStateRef.current.isPanning) {
      setPanSnapshot(
        {
          offsetX: panStateRef.current.offsetX,
          offsetY: panStateRef.current.offsetY,
          isPanning: true
        },
        'start'
      );
    } else {
      emit('start');
    }
  }, [emit, setPanSnapshot]);

  const updatePan = useCallback((currentX: number, currentY: number) => {
    if (!panStateRef.current.isPanning) {
      return;
    }

    const deltaX = currentX - panStartRef.current.x;
    const deltaY = currentY - panStartRef.current.y;
    const nextOffsetX = panStartOffsetRef.current.x + deltaX;
    const nextOffsetY = panStartOffsetRef.current.y + deltaY;

    if (
      panStateRef.current.offsetX === nextOffsetX &&
      panStateRef.current.offsetY === nextOffsetY
    ) {
      return;
    }

    setPanSnapshot(
      {
        offsetX: nextOffsetX,
        offsetY: nextOffsetY,
        isPanning: true
      },
      'change'
    );
  }, [setPanSnapshot]);

  const setPan = useCallback(
    (offsetX: number, offsetY: number, options: { silent?: boolean } = {}) => {
      setPanSnapshot(
        {
          offsetX,
          offsetY,
          isPanning: panStateRef.current.isPanning
        },
        'set',
        Boolean(options.silent)
      );
    },
    [setPanSnapshot]
  );

  const endPan = useCallback(() => {
    if (!panStateRef.current.isPanning) {
      return;
    }
    setPanSnapshot(
      {
        offsetX: panStateRef.current.offsetX,
        offsetY: panStateRef.current.offsetY,
        isPanning: false
      },
      'end'
    );
  }, [setPanSnapshot]);

  const resetPan = useCallback(() => {
    panStartRef.current = { x: 0, y: 0 };
    panStartOffsetRef.current = { x: 0, y: 0 };
    setPanSnapshot({ offsetX: 0, offsetY: 0, isPanning: false }, 'reset');
  }, [setPanSnapshot]);

  const subscribe = useCallback((listener: PanListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const screenToWorld = useCallback(
    (x: number, y: number, currentScale: number = scale) => {
      const { offsetX, offsetY } = panStateRef.current;
      return {
        x: (x - offsetX) / currentScale,
        y: (y - offsetY) / currentScale
      };
    },
    [scale]
  );

  const worldToScreen = useCallback(
    (x: number, y: number, currentScale: number = scale) => {
      const { offsetX, offsetY } = panStateRef.current;
      return {
        x: x * currentScale + offsetX,
        y: y * currentScale + offsetY
      };
    },
    [scale]
  );

  const panState = useMemo(
    () => ({
      get offsetX() {
        return panStateRef.current.offsetX;
      },
      get offsetY() {
        return panStateRef.current.offsetY;
      },
      get isPanning() {
        return panStateRef.current.isPanning;
      }
    }),
    []
  );

  return {
    panState,
    panStartRef,
    panStartOffsetRef,
    startPan,
    updatePan,
    setPan,
    endPan,
    resetPan,
    subscribe,
    getState,
    screenToWorld,
    worldToScreen
  };
}

export type SimplePan = ReturnType<typeof useSimplePan>;
