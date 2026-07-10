export type RuntimeIncidentSeverity = 'warning' | 'error';

export type RuntimeIncident = {
  t: number;
  scope: string;
  event: string;
  severity: RuntimeIncidentSeverity;
  href: string | null;
  data: Record<string, unknown>;
};

declare global {
  interface Window {
    __VESSEL_RUNTIME_INCIDENTS__?: RuntimeIncident[];
    __VESSEL_GET_RUNTIME_INCIDENTS__?: () => RuntimeIncident[];
  }
}

type RuntimeIncidentWindow = Window;

const STORAGE_KEY = 'VESSEL_RUNTIME_INCIDENTS';
const MAX_INCIDENTS = 100;

const getIncidentWindow = (): RuntimeIncidentWindow | null => (
  typeof window === 'undefined' ? null : window as RuntimeIncidentWindow
);

const normalizeIncident = (value: unknown): RuntimeIncident | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<RuntimeIncident>;
  if (
    typeof candidate.t !== 'number' ||
    !Number.isFinite(candidate.t) ||
    typeof candidate.scope !== 'string' ||
    typeof candidate.event !== 'string' ||
    (candidate.severity !== 'warning' && candidate.severity !== 'error')
  ) {
    return null;
  }
  return {
    t: candidate.t,
    scope: candidate.scope,
    event: candidate.event,
    severity: candidate.severity,
    href: typeof candidate.href === 'string' ? candidate.href : null,
    data: candidate.data && typeof candidate.data === 'object'
      ? candidate.data as Record<string, unknown>
      : {},
  };
};

const readStoredIncidents = (incidentWindow: RuntimeIncidentWindow): RuntimeIncident[] => {
  try {
    const raw = incidentWindow.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeIncident).filter((entry): entry is RuntimeIncident => entry !== null)
      : [];
  } catch {
    return [];
  }
};

const installIncidentHelper = (incidentWindow: RuntimeIncidentWindow): void => {
  incidentWindow.__VESSEL_GET_RUNTIME_INCIDENTS__ = getPersistedRuntimeIncidents;
};

const getCurrentIncidents = (incidentWindow: RuntimeIncidentWindow): RuntimeIncident[] => {
  if (Array.isArray(incidentWindow.__VESSEL_RUNTIME_INCIDENTS__)) {
    return incidentWindow.__VESSEL_RUNTIME_INCIDENTS__;
  }

  const stored = readStoredIncidents(incidentWindow).slice(-MAX_INCIDENTS);
  incidentWindow.__VESSEL_RUNTIME_INCIDENTS__ = stored;
  return stored;
};

export const getPersistedRuntimeIncidents = (): RuntimeIncident[] => {
  const incidentWindow = getIncidentWindow();
  if (!incidentWindow) {
    return [];
  }
  installIncidentHelper(incidentWindow);
  return [...getCurrentIncidents(incidentWindow)];
};

export const recordRuntimeIncident = ({
  scope,
  event,
  severity = 'error',
  data = {},
}: {
  scope: string;
  event: string;
  severity?: RuntimeIncidentSeverity;
  data?: Record<string, unknown>;
}): RuntimeIncident | null => {
  const incidentWindow = getIncidentWindow();
  if (!incidentWindow) {
    return null;
  }
  const entry: RuntimeIncident = {
    t: Date.now(),
    scope,
    event,
    severity,
    href: incidentWindow.location?.href ?? null,
    data,
  };
  const incidents = getCurrentIncidents(incidentWindow);
  incidents.push(entry);
  if (incidents.length > MAX_INCIDENTS) {
    incidents.splice(0, incidents.length - MAX_INCIDENTS);
  }
  incidentWindow.__VESSEL_RUNTIME_INCIDENTS__ = incidents;
  installIncidentHelper(incidentWindow);
  try {
    incidentWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
  } catch {}
  return entry;
};

const incidentWindow = getIncidentWindow();
if (incidentWindow) {
  installIncidentHelper(incidentWindow);
}
