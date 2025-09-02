// Lightweight debug logger with scope-based opt-in
// Enable by setting either:
//   window.__TB_DEBUG = { all: true } or { cc: true, 'cc-undo': true }
// Or via localStorage:
//   localStorage.setItem('TB_DEBUG', 'all') or 'cc,cc-undo'

type DebugConfig = { all?: boolean; [scope: string]: boolean | undefined };

function readConfig(): DebugConfig {
  try {
    // @ts-ignore
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    if (w && w.__TB_DEBUG && typeof w.__TB_DEBUG === 'object') {
      return w.__TB_DEBUG as DebugConfig;
    }
    if (w && w.localStorage) {
      const raw = w.localStorage.getItem('TB_DEBUG');
      if (raw) {
        const cfg: DebugConfig = {};
        raw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
          if (s.toLowerCase() === 'all') cfg.all = true; else cfg[s] = true;
        });
        return cfg;
      }
    }
  } catch {}
  return {};
}

export function isDebugEnabled(scope: string): boolean {
  const cfg = readConfig();
  return !!cfg.all || !!cfg[scope];
}

export function debugLog(scope: string, ...args: any[]) {
  if (isDebugEnabled(scope)) {
    // Small, consistent prefix
    console.log(`[${scope}]`, ...args);
  }
}

export function debugWarn(scope: string, ...args: any[]) {
  if (isDebugEnabled(scope)) {
    console.warn(`[${scope}]`, ...args);
  }
}

