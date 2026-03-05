type ModifierRequirement = 'required' | 'forbidden' | 'any';

export type ShortcutActionId =
  | 'undo'
  | 'redo'
  | 'save'
  | 'open'
  | 'copy'
  | 'cut'
  | 'palette-swap'
  | 'palette-copy'
  | 'select-all'
  | 'tool-custom'
  | 'tool-fill'
  | 'tool-magic-wand'
  | 'tool-brush'
  | 'tool-eraser-hold'
  | 'tool-selection'
  | 'tool-color-adjust'
  | 'tool-color-picker-hold'
  | 'brush-size-decrease'
  | 'brush-size-increase'
  | 'context-delete'
  | 'context-enter'
  | 'context-escape';

interface ShortcutSpec {
  action: ShortcutActionId;
  key?: string;
  code?: string;
  ctrlOrMeta?: ModifierRequirement;
  shift?: ModifierRequirement;
  alt?: ModifierRequirement;
  repeat?: ModifierRequirement;
}

const ALWAYS_SHORTCUTS: ShortcutSpec[] = [
  { action: 'undo', key: 'z', ctrlOrMeta: 'required', shift: 'forbidden' },
  { action: 'redo', key: 'z', ctrlOrMeta: 'required', shift: 'required' },
  { action: 'redo', key: 'y', ctrlOrMeta: 'required', shift: 'forbidden' },
  { action: 'save', key: 's', ctrlOrMeta: 'required' },
  { action: 'open', key: 'o', ctrlOrMeta: 'required' },
  { action: 'copy', key: 'c', ctrlOrMeta: 'required', shift: 'forbidden', alt: 'forbidden' },
  { action: 'cut', key: 'x', ctrlOrMeta: 'required', shift: 'forbidden', alt: 'forbidden' },
];

const SCOPED_SHORTCUTS: ShortcutSpec[] = [
  {
    action: 'palette-copy',
    code: 'KeyX',
    ctrlOrMeta: 'forbidden',
    shift: 'required',
    alt: 'forbidden',
    repeat: 'forbidden',
  },
  {
    action: 'palette-swap',
    code: 'KeyX',
    ctrlOrMeta: 'forbidden',
    shift: 'forbidden',
    alt: 'forbidden',
    repeat: 'forbidden',
  },
  { action: 'select-all', key: 'a', ctrlOrMeta: 'required' },
  { action: 'tool-custom', key: 'c', ctrlOrMeta: 'forbidden' },
  { action: 'tool-fill', key: 'f', ctrlOrMeta: 'forbidden' },
  { action: 'tool-magic-wand', key: 'w', ctrlOrMeta: 'forbidden' },
  { action: 'tool-brush', key: 'b', ctrlOrMeta: 'forbidden' },
  { action: 'tool-eraser-hold', key: 'e', ctrlOrMeta: 'forbidden' },
  { action: 'tool-selection', key: 'm', ctrlOrMeta: 'forbidden' },
  { action: 'tool-color-adjust', key: 'u', ctrlOrMeta: 'forbidden' },
  { action: 'tool-color-picker-hold', key: 'p', ctrlOrMeta: 'forbidden' },
  { action: 'brush-size-decrease', key: '[' },
  { action: 'brush-size-increase', key: ']' },
  { action: 'context-delete', key: 'delete' },
  { action: 'context-delete', key: 'backspace' },
  { action: 'context-enter', key: 'enter' },
  { action: 'context-enter', code: 'NumpadEnter' },
  { action: 'context-escape', key: 'escape' },
];

const matchesRequirement = (value: boolean, requirement: ModifierRequirement = 'any'): boolean => {
  if (requirement === 'any') {
    return true;
  }
  return requirement === 'required' ? value : !value;
};

const matchesShortcut = (event: KeyboardEvent, spec: ShortcutSpec): boolean => {
  if (spec.key !== undefined && event.key.toLowerCase() !== spec.key) {
    return false;
  }
  if (spec.code !== undefined && event.code !== spec.code) {
    return false;
  }

  const hasCtrlOrMeta = event.ctrlKey || event.metaKey;
  if (!matchesRequirement(hasCtrlOrMeta, spec.ctrlOrMeta)) {
    return false;
  }
  if (!matchesRequirement(event.shiftKey, spec.shift)) {
    return false;
  }
  if (!matchesRequirement(event.altKey, spec.alt)) {
    return false;
  }
  if (!matchesRequirement(event.repeat, spec.repeat)) {
    return false;
  }

  return true;
};

const resolveShortcut = (
  event: KeyboardEvent,
  shortcuts: ShortcutSpec[]
): ShortcutActionId | null => {
  const match = shortcuts.find((shortcut) => matchesShortcut(event, shortcut));
  return match?.action ?? null;
};

export const resolveAlwaysShortcutAction = (event: KeyboardEvent): ShortcutActionId | null =>
  resolveShortcut(event, ALWAYS_SHORTCUTS);

export const resolveScopedShortcutAction = (event: KeyboardEvent): ShortcutActionId | null =>
  resolveShortcut(event, SCOPED_SHORTCUTS);
