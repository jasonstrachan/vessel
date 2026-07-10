import {
  getPersistedRuntimeIncidents,
  recordRuntimeIncident,
} from '@/utils/runtimeIncidentJournal';

describe('runtimeIncidentJournal', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__VESSEL_RUNTIME_INCIDENTS__;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists high-signal incidents independently of the breadcrumb ring', () => {
    window.localStorage.setItem('TB_BREADCRUMBS', JSON.stringify([{ t: 1, scope: 'noise', data: {} }]));

    recordRuntimeIncident({
      scope: 'cc-render',
      event: 'webgl-context-lost',
      data: { layerId: 'cc-layer' },
    });

    expect(getPersistedRuntimeIncidents()).toEqual([
      expect.objectContaining({
        scope: 'cc-render',
        event: 'webgl-context-lost',
        severity: 'error',
        data: { layerId: 'cc-layer' },
      }),
    ]);
    expect(JSON.parse(window.localStorage.getItem('TB_BREADCRUMBS') ?? '[]')).toHaveLength(1);
  });

  it('retains the latest 100 incidents without routine-log eviction', () => {
    for (let index = 0; index < 105; index += 1) {
      recordRuntimeIncident({
        scope: 'test',
        event: `incident-${index}`,
      });
    }

    const incidents = getPersistedRuntimeIncidents();
    expect(incidents).toHaveLength(100);
    expect(incidents[0]?.event).toBe('incident-5');
    expect(incidents.at(-1)?.event).toBe('incident-104');
  });

  it('retains new incidents in memory when localStorage writes fail', () => {
    window.localStorage.setItem('VESSEL_RUNTIME_INCIDENTS', JSON.stringify([{
      t: 1,
      scope: 'existing',
      event: 'persisted-before-failure',
      severity: 'warning',
      href: null,
      data: {},
    }]));
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    recordRuntimeIncident({ scope: 'cc-render', event: 'first-unsaved-incident' });
    recordRuntimeIncident({ scope: 'cc-render', event: 'second-unsaved-incident' });

    expect(getPersistedRuntimeIncidents().map((incident) => incident.event)).toEqual([
      'persisted-before-failure',
      'first-unsaved-incident',
      'second-unsaved-incident',
    ]);
    expect(setItemSpy).toHaveBeenCalledTimes(2);
  });
});
