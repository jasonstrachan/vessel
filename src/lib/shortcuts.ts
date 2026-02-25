// Centralized keyboard shortcut registry for documentation and UI display
// This file defines the canonical set of global shortcuts and helpers

export type Shortcut = {
  id: string;
  description: string;
  // Canonical combo(s) using KeyboardEvent.key semantics, lowercase letters when applicable
  // Use multiple entries for alternatives (e.g., redo)
  combos: string[];
  scope: 'global' | 'canvas' | 'editor' | 'modal';
};

export const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export const modifierLabel = {
  cmd: () => (isMac() ? '⌘' : 'Ctrl'),
  ctrl: () => (isMac() ? 'Ctrl' : 'Ctrl'),
  alt: () => (isMac() ? '⌥' : 'Alt'),
  shift: () => 'Shift',
};

export const globalShortcuts: Shortcut[] = [
  {
    id: 'save',
    description: 'Save Project',
    combos: ['mod+s'],
    scope: 'global',
  },
  {
    id: 'open',
    description: 'Open Project',
    combos: ['mod+o'],
    scope: 'global',
  },
  {
    id: 'undo',
    description: 'Undo',
    combos: ['mod+z'],
    scope: 'global',
  },
  {
    id: 'redo',
    description: 'Redo',
    combos: ['mod+shift+z', 'mod+y'],
    scope: 'global',
  },
  {
    id: 'decrease-brush',
    description: 'Decrease Brush Size',
    combos: ['['],
    scope: 'canvas',
  },
  {
    id: 'increase-brush',
    description: 'Increase Brush Size',
    combos: [']'],
    scope: 'canvas',
  },
  {
    id: 'pan',
    description: 'Pan View',
    combos: ['Space (hold)'],
    scope: 'canvas',
  },
  {
    id: 'tool-brush',
    description: 'Brush Tool',
    combos: ['b'],
    scope: 'global',
  },
  {
    id: 'tool-eraser',
    description: 'Eraser (hold to temp)',
    combos: ['e'],
    scope: 'global',
  },
  {
    id: 'tool-fill',
    description: 'Fill Tool',
    combos: ['f'],
    scope: 'global',
  },
  {
    id: 'tool-selection',
    description: 'Selection Tool',
    combos: ['m'],
    scope: 'global',
  },
];

// Format a combo like "mod+shift+z" to a platform-friendly label
export function formatCombo(combo: string): string {
  const parts = combo.split('+');
  return parts
    .map((p) => {
      switch (p.toLowerCase()) {
        case 'mod':
          return modifierLabel.cmd();
        case 'ctrl':
          return modifierLabel.ctrl();
        case 'alt':
          return modifierLabel.alt();
        case 'shift':
          return modifierLabel.shift();
        default:
          return p.length === 1 ? p.toUpperCase() : capitalize(p);
      }
    })
    .join(' + ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

