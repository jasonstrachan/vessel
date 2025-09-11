import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { KeyboardScope } from '../types';

// Lightweight helper to set a keyboard scope while enabled and
// restore the previous scope automatically on cleanup.
export function useKeyboardScope(scope: KeyboardScope, enabled: boolean = true) {
  const setKeyboardScope = useAppStore((s) => s.setKeyboardScope);
  const getScope = useAppStore.getState;
  const prevRef = useRef<KeyboardScope | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // save previous and set new
    prevRef.current = getScope().ui.keyboardScope;
    setKeyboardScope(scope);
    return () => {
      if (prevRef.current) {
        setKeyboardScope(prevRef.current);
      }
    };
  }, [enabled, scope, setKeyboardScope]);
}

