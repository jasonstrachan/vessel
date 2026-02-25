import { useEffect, useId, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { KeyboardScope } from '../types';

// Lightweight helper to register a scoped keyboard context while enabled and
// automatically release it on cleanup.
export function useKeyboardScope(scope: KeyboardScope, enabled: boolean = true) {
  const pushKeyboardScope = useAppStore((s) => s.pushKeyboardScope);
  const popKeyboardScope = useAppStore((s) => s.popKeyboardScope);
  const reactId = useId();
  const scopeIdRef = useRef<string | null>(null);

  if (scopeIdRef.current === null) {
    scopeIdRef.current = `keyboard-scope-${reactId}`;
  }

  useEffect(() => {
    const scopeId = scopeIdRef.current!;

    if (!enabled) {
      popKeyboardScope(scopeId);
      return;
    }

    pushKeyboardScope(scopeId, scope);
    return () => {
      popKeyboardScope(scopeId);
    };
  }, [enabled, scope, pushKeyboardScope, popKeyboardScope]);
}
