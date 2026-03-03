import { useAppStore } from '@/stores/useAppStore';

describe('save in-flight unload guard', () => {
  const dispatchBeforeUnload = (): Event => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    useAppStore.setState((state) => ({
      autosave: {
        ...state.autosave,
        saveStatus: {
          phase: 'idle',
          source: null,
          message: null,
          updatedAt: null,
        },
      },
    }));
  });

  it('prevents unload while manual save is in progress', () => {
    useAppStore.setState((state) => ({
      autosave: {
        ...state.autosave,
        saveStatus: {
          phase: 'saving',
          source: 'manual',
          message: 'Saving project...',
          updatedAt: new Date(),
        },
      },
    }));

    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not block unload when not in manual save', () => {
    useAppStore.setState((state) => ({
      autosave: {
        ...state.autosave,
        saveStatus: {
          phase: 'saving',
          source: 'autosave',
          message: 'Autosaving...',
          updatedAt: new Date(),
        },
      },
    }));

    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
  });
});
