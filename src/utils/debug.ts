// Lightweight debug logger with scope-based opt-in
// Enable by setting either:
//   window.__TB_DEBUG = { all: true } or { cc: true, 'cc-undo': true }
// Or via localStorage:
//   localStorage.setItem('TB_DEBUG', 'all') or 'cc,cc-undo'

type DebugConfig = { all?: boolean; [scope: string]: boolean | undefined };

// Cache debug config to avoid repeated localStorage/window lookups in hot paths
let __cachedDebugConfig: DebugConfig | null = null;
let __lastConfigRead = 0;
const __CONFIG_CACHE_MS = 1000; // refresh at most once per second if needed

function readConfig(): DebugConfig {
  // Serve cached config when fresh to keep pointer-move hot paths cheap
  const now = Date.now();
  if (__cachedDebugConfig && now - __lastConfigRead < __CONFIG_CACHE_MS) {
    return __cachedDebugConfig;
  }
  try {
    // @ts-ignore
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    if (w && w.__TB_DEBUG && typeof w.__TB_DEBUG === 'object') {
      __cachedDebugConfig = w.__TB_DEBUG as DebugConfig;
      __lastConfigRead = now;
      return __cachedDebugConfig;
    }
    if (w && w.localStorage) {
      const raw = w.localStorage.getItem('TB_DEBUG');
      if (raw) {
        const cfg: DebugConfig = {};
        raw.split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => !!s)
          .forEach((s: string) => {
          if (s.toLowerCase() === 'all') cfg.all = true; else cfg[s] = true;
        });
        __cachedDebugConfig = cfg;
        __lastConfigRead = now;
        return __cachedDebugConfig;
      }
    }
  } catch {}
  __cachedDebugConfig = {};
  __lastConfigRead = now;
  return __cachedDebugConfig;
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

// Lightweight persistent breadcrumbs to survive page reloads/crashes
// Stores last ~200 events in memory and mirrors to localStorage
type Breadcrumb = { t: number; scope: string; data: any };
const BC_WIN_KEY = '__TB_BREADCRUMBS';
const BC_LS_KEY = 'TB_BREADCRUMBS';
const BC_MAX = 200;

export function recordBreadcrumb(scope: string, data: any) {
  try {
    const w: any = typeof window !== 'undefined' ? window : undefined;
    const entry: Breadcrumb = { t: Date.now(), scope, data };
    if (w) {
      if (!Array.isArray(w[BC_WIN_KEY])) w[BC_WIN_KEY] = [];
      w[BC_WIN_KEY].push(entry);
      if (w[BC_WIN_KEY].length > BC_MAX) w[BC_WIN_KEY].splice(0, w[BC_WIN_KEY].length - BC_MAX);
      try {
        const existing: Breadcrumb[] = JSON.parse(w.localStorage.getItem(BC_LS_KEY) || '[]');
        existing.push(entry);
        if (existing.length > BC_MAX) existing.splice(0, existing.length - BC_MAX);
        w.localStorage.setItem(BC_LS_KEY, JSON.stringify(existing));
      } catch {}
    }
  } catch {}
}
