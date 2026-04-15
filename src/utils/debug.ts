// Lightweight debug logger with scope-based opt-in
// Dev-only: all debug helpers become no-ops in production.
// Usage (dev):
//   - Enable specific scopes: localStorage.setItem('TB_DEBUG', 'layers,undo')
//   - Enable everything (except excluded defaults): localStorage.setItem('TB_DEBUG', 'all')
//   - Force include even excluded defaults: localStorage.setItem('TB_DEBUG_FORCE', 'composite,cc-render') or 'all'
//   - Exclude noisy scopes: localStorage.setItem('TB_DEBUG_EXCLUDE', 'scope1,scope2')
//   - Kill switch: localStorage.setItem('TB_DEBUG', 'off')
// You can also set window.__TB_DEBUG / __TB_DEBUG_EXCLUDE / __TB_DEBUG_FORCE directly.

export const __DEV__ = process.env.NODE_ENV !== 'production';

type DebugConfig = { all?: boolean; [scope: string]: boolean | undefined };

type Breadcrumb = { t: number; scope: string; data: unknown };
export type CrashReport = {
  t: number;
  type: 'error' | 'unhandledrejection';
  href: string;
  message: string;
  stack?: string | null;
  userAgent?: string;
  breadcrumbs: Breadcrumb[];
};

export type HangReport = {
  t: number;
  type: 'hang';
  href: string;
  message: string;
  userAgent?: string;
  visibilityState?: string | null;
  sessionId?: string | null;
  lastBeatAt?: number | null;
  gapMs?: number | null;
  breadcrumbs: Breadcrumb[];
};

type DebugWindow = Window & {
  __TB_DEBUG?: DebugConfig;
  __TB_DEBUG_FORCE?: string | string[];
  __TB_DEBUG_EXCLUDE?: string | string[];
  __TB_BREADCRUMBS?: Breadcrumb[];
  __TB_LAST_CRASH__?: CrashReport;
  __TB_LAST_HANG__?: HangReport;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeBreadcrumb = (value: unknown): Breadcrumb | null => {
  if (!isRecord(value)) {
    return null;
  }

  const t = typeof value.t === 'number' && Number.isFinite(value.t) ? value.t : null;
  const scope = typeof value.scope === 'string' ? value.scope : null;
  if (t == null || !scope) {
    return null;
  }

  return {
    t,
    scope,
    data: 'data' in value ? value.data : null,
  };
};

const normalizeCrashReport = (value: unknown): CrashReport | null => {
  if (!isRecord(value)) {
    return null;
  }

  const t = typeof value.t === 'number' && Number.isFinite(value.t) ? value.t : null;
  const type = value.type === 'error' || value.type === 'unhandledrejection' ? value.type : null;
  const href = typeof value.href === 'string' ? value.href : null;
  const message = typeof value.message === 'string' && value.message.trim().length > 0
    ? value.message
    : null;
  if (t == null || type == null || href == null || message == null) {
    return null;
  }

  const breadcrumbs = Array.isArray(value.breadcrumbs)
    ? value.breadcrumbs
        .map(normalizeBreadcrumb)
        .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
    : [];

  return {
    t,
    type,
    href,
    message,
    stack: typeof value.stack === 'string' ? value.stack : null,
    userAgent: typeof value.userAgent === 'string' ? value.userAgent : undefined,
    breadcrumbs,
  };
};

const normalizeHangReport = (value: unknown): HangReport | null => {
  if (!isRecord(value)) {
    return null;
  }

  const t = typeof value.t === 'number' && Number.isFinite(value.t) ? value.t : null;
  const type = value.type === 'hang' ? value.type : null;
  const href = typeof value.href === 'string' ? value.href : null;
  const message = typeof value.message === 'string' && value.message.trim().length > 0
    ? value.message
    : null;
  if (t == null || type == null || href == null || message == null) {
    return null;
  }

  const breadcrumbs = Array.isArray(value.breadcrumbs)
    ? value.breadcrumbs
        .map(normalizeBreadcrumb)
        .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
    : [];

  return {
    t,
    type,
    href,
    message,
    userAgent: typeof value.userAgent === 'string' ? value.userAgent : undefined,
    visibilityState: typeof value.visibilityState === 'string' ? value.visibilityState : null,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    lastBeatAt: typeof value.lastBeatAt === 'number' && Number.isFinite(value.lastBeatAt)
      ? value.lastBeatAt
      : null,
    gapMs: typeof value.gapMs === 'number' && Number.isFinite(value.gapMs) ? value.gapMs : null,
    breadcrumbs,
  };
};

const getDebugWindow = (): DebugWindow | undefined => {
  return typeof window === 'undefined' ? undefined : (window as DebugWindow);
};

// Optional exclusion list to suppress noisy scopes even when `all` is enabled
let __cachedExclude: Set<string> | null = null;
let __lastExcludeRead = 0;
const __EXCLUDE_CACHE_MS = 1000;

// Default noisy scopes we want permanently quiet unless explicitly forced.
// These are high-frequency hot-path logs that tend to flood the console.
const DEFAULT_EXCLUDED_SCOPES = new Set<string>([
  'composite',
  'cc-render',
]);

function readExcludeSet(): Set<string> {
  if (!__DEV__) return new Set();
  const now = Date.now();
  if (__cachedExclude && now - __lastExcludeRead < __EXCLUDE_CACHE_MS) return __cachedExclude;
  const out = new Set<string>(DEFAULT_EXCLUDED_SCOPES);
  try {
    const w = getDebugWindow();
    // If forced scopes are defined, we temporarily ignore default excludes for those
    // (but keep other excludes). Accepts 'all' or comma-separated list.
    let forceSet: Set<string> | null = null;
    try {
      const forceRaw = w?.localStorage?.getItem('TB_DEBUG_FORCE') ?? w?.__TB_DEBUG_FORCE;
      if (typeof forceRaw === 'string') {
        const val = forceRaw.trim();
        if (val.toLowerCase() === 'all') {
          // Clear all default excludes
          forceSet = new Set<string>(['*ALL*']);
        } else if (val) {
          forceSet = new Set<string>(val.split(',').map((s) => s.trim()).filter(Boolean));
        }
      } else if (Array.isArray(w?.__TB_DEBUG_FORCE)) {
        forceSet = new Set<string>(w.__TB_DEBUG_FORCE.map((s) => s.toString()));
      }
    } catch {}

    // window.__TB_DEBUG_EXCLUDE can be array or comma string
    if (w && w.__TB_DEBUG_EXCLUDE) {
      const val = w.__TB_DEBUG_EXCLUDE;
      if (Array.isArray(val)) val.forEach((s) => s && out.add(String(s)));
      else if (typeof val === 'string') val.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s));
    }
    // localStorage TB_DEBUG_EXCLUDE: comma separated scopes
    if (w && w.localStorage) {
      const raw = w.localStorage.getItem('TB_DEBUG_EXCLUDE');
      if (raw) raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s));
    }

    // If forcing, remove matching entries from the exclusion set
    if (forceSet) {
      if (forceSet.has('*ALL*')) {
        out.clear();
      } else {
        forceSet.forEach((s: string) => out.delete(s));
      }
    }
  } catch {}
  __cachedExclude = out;
  __lastExcludeRead = Date.now();
  return out;
}

// Cache debug config to avoid repeated localStorage/window lookups in hot paths
let __cachedDebugConfig: DebugConfig | null = null;
let __lastConfigRead = 0;
const __CONFIG_CACHE_MS = 1000; // refresh at most once per second if needed

function readConfig(): DebugConfig {
  if (!__DEV__) return {};
  // Serve cached config when fresh to keep pointer-move hot paths cheap
  const now = Date.now();
  if (__cachedDebugConfig && now - __lastConfigRead < __CONFIG_CACHE_MS) {
    return __cachedDebugConfig;
  }
  try {
    const w = getDebugWindow();
    if (w && w.__TB_DEBUG && typeof w.__TB_DEBUG === 'object') {
      __cachedDebugConfig = { ...w.__TB_DEBUG };
      __lastConfigRead = now;
      return __cachedDebugConfig;
    }
    if (w && w.localStorage) {
      const raw = w.localStorage.getItem('TB_DEBUG');
      if (raw) {
        const lowered = raw.trim().toLowerCase();
        // Explicit disable in dev
        if (lowered === 'off' || lowered === 'none' || lowered === '0' || lowered === 'false') {
          __cachedDebugConfig = {};
        } else {
          const cfg: DebugConfig = {};
          raw.split(',')
            .map((s) => s.trim())
            .filter((s) => !!s)
            .forEach((s) => {
              if (s.toLowerCase() === 'all') cfg.all = true; else cfg[s] = true;
            });
          __cachedDebugConfig = cfg;
        }
        __lastConfigRead = now;
        return __cachedDebugConfig;
      }
    }
  } catch {}
  // Default in dev: no scopes enabled unless explicitly opted-in via TB_DEBUG or window.__TB_DEBUG
  __cachedDebugConfig = {};
  __lastConfigRead = now;
  return __cachedDebugConfig;
}

export function isDebugEnabled(scope: string): boolean {
  if (!__DEV__) return false;
  const cfg = readConfig();
  const exclude = readExcludeSet();
  if (exclude.has(scope)) return false;
  return !!cfg.all || !!cfg[scope];
}

export function debugLog(scope: string, ...args: unknown[]) {
  if (!__DEV__) return; // Stripped in production builds
  if (isDebugEnabled(scope)) {
    console.log(`[${scope}]`, ...args);
  }
}

export function debugWarn(scope: string, ...args: unknown[]) {
  if (!__DEV__) return; // Stripped in production builds
  if (isDebugEnabled(scope)) {
    console.warn(`[${scope}]`, ...args);
  }
}

// Always-on error log for unexpected failures (kept in production)
export function logError(...args: unknown[]) {
  console.error(...args);
}

// Lightweight persistent breadcrumbs to survive page reloads/crashes
// Stores last ~200 events in memory and mirrors to localStorage
const BC_WIN_KEY = '__TB_BREADCRUMBS';
const BC_LS_KEY = 'TB_BREADCRUMBS';
const BC_MAX = 200;
const CRASH_LS_KEY = 'TB_LAST_CRASH';
const CRASH_REPORTED_LS_KEY = 'TB_LAST_CRASH_REPORTED';
const HANG_LS_KEY = 'TB_LAST_HANG';
const HANG_REPORTED_LS_KEY = 'TB_LAST_HANG_REPORTED';

export function recordBreadcrumb(scope: string, data: unknown) {
  if (!__DEV__) return; // Dev-only breadcrumbs
  try {
    const w = getDebugWindow();
    const entry: Breadcrumb = { t: Date.now(), scope, data };
    if (w) {
      if (!Array.isArray(w[BC_WIN_KEY])) w[BC_WIN_KEY] = [];
      w[BC_WIN_KEY]!.push(entry);
      if (w[BC_WIN_KEY]!.length > BC_MAX) w[BC_WIN_KEY]!.splice(0, w[BC_WIN_KEY]!.length - BC_MAX);
      try {
        const existing: Breadcrumb[] = JSON.parse(w.localStorage.getItem(BC_LS_KEY) || '[]');
        existing.push(entry);
        if (existing.length > BC_MAX) existing.splice(0, existing.length - BC_MAX);
        w.localStorage.setItem(BC_LS_KEY, JSON.stringify(existing));
      } catch {}
    }
  } catch {}
}

export function getPersistedBreadcrumbs(): Breadcrumb[] {
  try {
    const w = getDebugWindow();
    if (w && Array.isArray(w[BC_WIN_KEY]) && w[BC_WIN_KEY]!.length > 0) {
      return [...w[BC_WIN_KEY]!];
    }
    if (w?.localStorage) {
      const raw = w.localStorage.getItem(BC_LS_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

export function persistCrashReport(
  report: Omit<CrashReport, 't' | 'href' | 'userAgent' | 'breadcrumbs'> & Partial<Pick<CrashReport, 't' | 'href' | 'userAgent' | 'breadcrumbs'>>
): CrashReport | null {
  try {
    const w = getDebugWindow();
    if (!w?.localStorage) {
      return null;
    }
    const next: CrashReport = {
      t: report.t ?? Date.now(),
      type: report.type,
      href: report.href ?? w.location.href,
      message: report.message,
      stack: report.stack ?? null,
      userAgent: report.userAgent ?? w.navigator.userAgent,
      breadcrumbs: report.breadcrumbs ?? getPersistedBreadcrumbs(),
    };
    w.__TB_LAST_CRASH__ = next;
    w.localStorage.setItem(CRASH_LS_KEY, JSON.stringify(next));
    return next;
  } catch {}
  return null;
}

export function getLastCrashReport(): CrashReport | null {
  try {
    const w = getDebugWindow();
    if (!w?.localStorage) {
      return null;
    }
    if (w.__TB_LAST_CRASH__) {
      return normalizeCrashReport(w.__TB_LAST_CRASH__) ?? null;
    }
    const raw = w.localStorage.getItem(CRASH_LS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = normalizeCrashReport(JSON.parse(raw));
    if (!parsed) {
      w.localStorage.removeItem(CRASH_LS_KEY);
      return null;
    }
    w.__TB_LAST_CRASH__ = parsed;
    return parsed;
  } catch {
    try {
      getDebugWindow()?.localStorage?.removeItem(CRASH_LS_KEY);
    } catch {}
  }
  return null;
}

export function markCrashReportSeen(report: CrashReport): void {
  try {
    const w = getDebugWindow();
    w?.localStorage?.setItem(CRASH_REPORTED_LS_KEY, String(report.t));
  } catch {}
}

export function hasSeenCrashReport(report: CrashReport): boolean {
  try {
    const w = getDebugWindow();
    return w?.localStorage?.getItem(CRASH_REPORTED_LS_KEY) === String(report.t);
  } catch {}
  return false;
}

export function persistHangReport(
  report: Omit<HangReport, 't' | 'href' | 'userAgent' | 'breadcrumbs' | 'type'> &
    Partial<Pick<HangReport, 't' | 'href' | 'userAgent' | 'breadcrumbs' | 'visibilityState' | 'sessionId' | 'lastBeatAt' | 'gapMs'>>
): HangReport | null {
  try {
    const w = getDebugWindow();
    if (!w?.localStorage) {
      return null;
    }
    const next: HangReport = {
      t: report.t ?? Date.now(),
      type: 'hang',
      href: report.href ?? w.location.href,
      message: report.message,
      userAgent: report.userAgent ?? w.navigator.userAgent,
      visibilityState: report.visibilityState ?? null,
      sessionId: report.sessionId ?? null,
      lastBeatAt: report.lastBeatAt ?? null,
      gapMs: report.gapMs ?? null,
      breadcrumbs: report.breadcrumbs ?? getPersistedBreadcrumbs(),
    };
    w.__TB_LAST_HANG__ = next;
    w.localStorage.setItem(HANG_LS_KEY, JSON.stringify(next));
    return next;
  } catch {}
  return null;
}

export function getLastHangReport(): HangReport | null {
  try {
    const w = getDebugWindow();
    if (!w?.localStorage) {
      return null;
    }
    if (w.__TB_LAST_HANG__) {
      return normalizeHangReport(w.__TB_LAST_HANG__) ?? null;
    }
    const raw = w.localStorage.getItem(HANG_LS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = normalizeHangReport(JSON.parse(raw));
    if (!parsed) {
      w.localStorage.removeItem(HANG_LS_KEY);
      return null;
    }
    w.__TB_LAST_HANG__ = parsed;
    return parsed;
  } catch {
    try {
      getDebugWindow()?.localStorage?.removeItem(HANG_LS_KEY);
    } catch {}
  }
  return null;
}

export function markHangReportSeen(report: HangReport): void {
  try {
    const w = getDebugWindow();
    w?.localStorage?.setItem(HANG_REPORTED_LS_KEY, String(report.t));
  } catch {}
}

export function hasSeenHangReport(report: HangReport): boolean {
  try {
    const w = getDebugWindow();
    return w?.localStorage?.getItem(HANG_REPORTED_LS_KEY) === String(report.t);
  } catch {}
  return false;
}

// Helper to update debug config at runtime (e.g., from a dev UI toggle)
export function setDebugScopes(scopes: string | string[] | DebugConfig) {
  if (!__DEV__) return;
  try {
    const w = getDebugWindow();
    let cfg: DebugConfig = {};
    if (typeof scopes === 'string') {
      scopes.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => { if (s === 'all') cfg.all = true; else cfg[s] = true; });
    } else if (Array.isArray(scopes)) {
      scopes.forEach((s) => { if (s === 'all') cfg.all = true; else cfg[s] = true; });
    } else {
      cfg = { ...scopes };
    }
    if (w && w.localStorage) {
      const keys = Object.keys(cfg).filter(k => k !== 'all' || cfg.all);
      const value = cfg.all ? 'all' : keys.join(',');
      w.localStorage.setItem('TB_DEBUG', value);
    }
    if (w) {
      w.__TB_DEBUG = cfg;
    }
  } catch {}
  // Reset caches
  __cachedDebugConfig = null;
  __cachedExclude = null;
}
