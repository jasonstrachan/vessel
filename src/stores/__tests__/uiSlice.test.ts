import { useAppStore } from '@/stores/useAppStore';
import { createDefaultUIState } from '@/stores/slices/uiSlice';

describe('ui slice', () => {
  const resetUI = () => {
    useAppStore.setState((state) => ({
      ...state,
      ui: createDefaultUIState(),
    }));
  };

  beforeEach(() => {
    localStorage.clear();
    resetUI();
  });

  it('toggles panels and modals', () => {
    const store = useAppStore.getState();
    expect(store.ui.panels.leftToolbar).toBe(true);
    store.togglePanel('leftToolbar');
    expect(useAppStore.getState().ui.panels.leftToolbar).toBe(false);

    expect(store.ui.modals.export).toBe(false);
    store.toggleModal('export');
    expect(useAppStore.getState().ui.modals.export).toBe(true);
  });

  it('toggles and clamps visible grid settings', () => {
    const store = useAppStore.getState();

    expect(store.ui.grid.enabled).toBe(false);
    expect(store.ui.grid.rows).toBe(8);
    expect(store.ui.grid.columns).toBe(8);

    store.toggleGrid();
    expect(useAppStore.getState().ui.grid.enabled).toBe(true);

    store.setGridDimensions({ rows: 0, columns: 999 });
    expect(useAppStore.getState().ui.grid.rows).toBe(1);
    expect(useAppStore.getState().ui.grid.columns).toBe(128);
  });

  it('manages keyboard scope stack', () => {
    const store = useAppStore.getState();
    expect(store.ui.keyboardScope.active).toBe('canvas');
    store.pushKeyboardScope('modal-test', 'modal');
    expect(useAppStore.getState().ui.keyboardScope.active).toBe('modal');
    store.popKeyboardScope('modal-test');
    expect(useAppStore.getState().ui.keyboardScope.active).toBe('canvas');
  });

  it('adds and removes notifications', () => {
    const store = useAppStore.getState();
    store.addNotification({
      type: 'info',
      title: 'Test',
      message: 'Hello',
      timestamp: new Date(),
    });
    const notifications = useAppStore.getState().ui.notifications;
    expect(notifications).toHaveLength(1);
    const notificationId = notifications[0]?.id ?? '';
    store.removeNotification(notificationId);
    expect(useAppStore.getState().ui.notifications).toHaveLength(0);
  });
  it('remembers normalized guide edits without replacing unrelated settings or brush state', () => {
    const payload = { unknown: { keep: 7 }, autosave: { isEnabled: false, unknown: 9 }, history: { maxHistorySize: 50, unknown: 'history' }, canvas: { showRulers: true, guideGrid: { unknown: 'keep', enabled: false, rows: 8, columns: 8 } } };
    localStorage.setItem('vessel-settings', JSON.stringify(payload));
    localStorage.setItem('vessel:brush-settings', 'unchanged-brush');
    const before = useAppStore.getState();
    const layers = before.layers;
    const history = before.history;
    const brush = before.tools.brushSettings;
    before.setGridDimensions({ rows: 4, columns: 5 });
    before.toggleGrid();
    expect(JSON.parse(localStorage.getItem('vessel-settings')!)).toEqual({ ...payload, canvas: { ...payload.canvas, guideGrid: { unknown: 'keep', enabled: true, rows: 4, columns: 5 } } });
    before.setGridDimensions({ rows: 2.6, columns: 129 });
    before.setGridEnabled(false);
    expect(JSON.parse(localStorage.getItem('vessel-settings')!).canvas.guideGrid).toEqual({ unknown: 'keep', enabled: false, rows: 3, columns: 128 });
    expect(useAppStore.getState().ui.grid).toEqual({ enabled: false, rows: 3, columns: 128 });
    expect(useAppStore.getState().layers).toBe(layers);
    expect(useAppStore.getState().history).toBe(history);
    expect(useAppStore.getState().tools.brushSettings).toBe(brush);
    expect(localStorage.getItem('vessel:brush-settings')).toBe('unchanged-brush');
  });

  it('skips unchanged guide writes and keeps actions usable when storage fails', () => {
    const write = jest.spyOn(Storage.prototype, 'setItem');
    try {
      const before = useAppStore.getState().ui;
      useAppStore.getState().setGridDimensions({ rows: 8, columns: 8 });
      useAppStore.getState().setGridEnabled(false);
      expect(useAppStore.getState().ui).toBe(before);
      expect(write).not.toHaveBeenCalled();
      write.mockImplementation(() => { throw new Error('blocked storage'); });
      expect(() => useAppStore.getState().setGridDimensions({ enabled: true, rows: 0, columns: 16 })).not.toThrow();
      expect(useAppStore.getState().ui.grid).toEqual({ enabled: true, rows: 1, columns: 16 });
    } finally {
      write.mockRestore();
    }
  });

});
