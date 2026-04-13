import type { StateCreator } from 'zustand';
import type {
  Notification,
  UIState,
  KeyboardScope,
  KeyboardScopeEntry,
  SettingsSectionId,
  BrushPanelSectionId,
} from '@/types';

const DEFAULT_KEYBOARD_SCOPE: KeyboardScope = 'canvas';
const DEFAULT_GRID_ROWS = 8;
const DEFAULT_GRID_COLUMNS = 8;
const MIN_GRID_DIVISIONS = 1;
const MAX_GRID_DIVISIONS = 128;
const KEYBOARD_SCOPE_PRIORITY: readonly KeyboardScope[] = [
  'modal',
  'gradient',
  'recolor',
  'canvas',
  'global',
] as const;

const resolveActiveKeyboardScope = (stack: KeyboardScopeEntry[]): KeyboardScope => {
  if (stack.length === 0) {
    return DEFAULT_KEYBOARD_SCOPE;
  }

  for (const scope of KEYBOARD_SCOPE_PRIORITY) {
    if (stack.some((entry) => entry.scope === scope)) {
      return scope;
    }
  }

  const lastEntry = stack[stack.length - 1];
  return lastEntry?.scope ?? DEFAULT_KEYBOARD_SCOPE;
};

const createDefaultNotifications = (): Notification[] => [];

const clampGridDivisions = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_GRID_DIVISIONS;
  }
  return Math.max(MIN_GRID_DIVISIONS, Math.min(MAX_GRID_DIVISIONS, Math.round(value)));
};

export const createDefaultUIState = (): UIState => ({
  panels: {
    leftToolbar: true,
    rightToolbar: true,
    timeline: true,
    layerPanel: true,
    brushPanel: true,
  },
  modals: {
    export: false,
    settings: false,
    help: false,
    document: false,
    loadProject: false,
  },
  theme: 'dark',
  grid: {
    enabled: false,
    rows: DEFAULT_GRID_ROWS,
    columns: DEFAULT_GRID_COLUMNS,
  },
  notifications: createDefaultNotifications(),
  brushPanelSection: 'tool',
  settingsSection: 'display',
  keyboardScope: {
    active: DEFAULT_KEYBOARD_SCOPE,
    stack: [],
  },
});

type AppState = import('../useAppStore').AppState;

type PanelKey = keyof UIState['panels'];
type ModalKey = keyof UIState['modals'];

export interface UISlice {
  ui: UIState;
  togglePanel: (panel: PanelKey) => void;
  toggleModal: (modal: ModalKey) => void;
  setBrushPanelSection: (section: BrushPanelSectionId) => void;
  setSettingsSection: (section: SettingsSectionId) => void;
  toggleGrid: () => void;
  setGridEnabled: (enabled: boolean) => void;
  setGridDimensions: (dimensions: Partial<UIState['grid']>) => void;
  setTheme: (theme: UIState['theme']) => void;
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
  pushKeyboardScope: (id: string, scope: KeyboardScope) => void;
  popKeyboardScope: (id: string) => void;
}

export const createUiSlice = (): StateCreator<AppState, [], [], UISlice> => (set) => ({
  ui: createDefaultUIState(),

  togglePanel: (panel) => set((state) => ({
    ui: {
      ...state.ui,
      panels: {
        ...state.ui.panels,
        [panel]: !state.ui.panels[panel],
      },
    },
  })),

  toggleModal: (modal) => set((state) => ({
    ui: {
      ...state.ui,
      modals: {
        ...state.ui.modals,
        [modal]: !state.ui.modals[modal],
      },
    },
  })),

  setBrushPanelSection: (section) => set((state) => {
    if (state.ui.brushPanelSection === section) {
      return state;
    }
    return {
      ui: {
        ...state.ui,
        brushPanelSection: section,
      },
    };
  }),

  setSettingsSection: (section) => set((state) => {
    if (state.ui.settingsSection === section) {
      return state;
    }
    return {
      ui: {
        ...state.ui,
        settingsSection: section,
      },
    };
  }),

  toggleGrid: () => set((state) => ({
    ui: {
      ...state.ui,
      grid: {
        ...state.ui.grid,
        enabled: !state.ui.grid.enabled,
      },
    },
  })),

  setGridEnabled: (enabled) => set((state) => ({
    ui: {
      ...state.ui,
      grid: {
        ...state.ui.grid,
        enabled,
      },
    },
  })),

  setGridDimensions: (dimensions) => set((state) => ({
    ui: {
      ...state.ui,
      grid: {
        ...state.ui.grid,
        ...(typeof dimensions.enabled === 'boolean' ? { enabled: dimensions.enabled } : {}),
        ...(dimensions.rows !== undefined ? { rows: clampGridDivisions(dimensions.rows) } : {}),
        ...(dimensions.columns !== undefined
          ? { columns: clampGridDivisions(dimensions.columns) }
          : {}),
      },
    },
  })),

  setTheme: (theme) => set((state) => ({
    ui: {
      ...state.ui,
      theme,
    },
  })),

  addNotification: (notification) => {
    const notificationWithId: Notification = {
      ...notification,
      id: `notification-${Date.now()}-${Math.random()}`,
    };

    set((state) => ({
      ui: {
        ...state.ui,
        notifications: [...state.ui.notifications, notificationWithId],
      },
    }));
  },

  removeNotification: (id) => set((state) => ({
    ui: {
      ...state.ui,
      notifications: state.ui.notifications.filter((notification) => notification.id !== id),
    },
  })),

  pushKeyboardScope: (id, scope) => set((state) => {
    const existingStack = state.ui.keyboardScope.stack;
    const filtered = existingStack.filter((entry) => entry.id !== id);
    const nextStack = [...filtered, { id, scope }];
    const nextActive = resolveActiveKeyboardScope(nextStack);

    if (
      existingStack.length === nextStack.length &&
      state.ui.keyboardScope.active === nextActive &&
      existingStack.every(
        (entry, index) =>
          entry.id === nextStack[index]?.id && entry.scope === nextStack[index]?.scope,
      )
    ) {
      return state;
    }

    return {
      ui: {
        ...state.ui,
        keyboardScope: {
          stack: nextStack,
          active: nextActive,
        },
      },
    };
  }),

  popKeyboardScope: (id) => set((state) => {
    const existingStack = state.ui.keyboardScope.stack;
    const nextStack = existingStack.filter((entry) => entry.id !== id);
    if (nextStack.length === existingStack.length) {
      return state;
    }

    const nextActive = resolveActiveKeyboardScope(nextStack);

    return {
      ui: {
        ...state.ui,
        keyboardScope: {
          stack: nextStack,
          active: nextActive,
        },
      },
    };
  }),
});
