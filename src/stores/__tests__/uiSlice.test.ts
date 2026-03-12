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
});
