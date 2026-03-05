import {
  resolveAlwaysShortcutAction,
  resolveScopedShortcutAction,
} from '@/hooks/keyboard/shortcutRegistry';

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', init);

describe('shortcutRegistry', () => {
  it('resolves global command shortcuts', () => {
    expect(resolveAlwaysShortcutAction(keydown({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(resolveAlwaysShortcutAction(keydown({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
    expect(resolveAlwaysShortcutAction(keydown({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(resolveAlwaysShortcutAction(keydown({ key: 's', metaKey: true }))).toBe('save');
    expect(resolveAlwaysShortcutAction(keydown({ key: 'o', ctrlKey: true }))).toBe('open');
  });

  it('resolves copy/cut with required modifiers only', () => {
    expect(resolveAlwaysShortcutAction(keydown({ key: 'c', ctrlKey: true }))).toBe('copy');
    expect(resolveAlwaysShortcutAction(keydown({ key: 'x', metaKey: true }))).toBe('cut');
    expect(resolveAlwaysShortcutAction(keydown({ key: 'x', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(resolveAlwaysShortcutAction(keydown({ key: 'c', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('resolves scoped shortcuts including U for color adjust', () => {
    expect(resolveScopedShortcutAction(keydown({ key: 'u' }))).toBe('tool-color-adjust');
    expect(resolveScopedShortcutAction(keydown({ key: 'u', ctrlKey: true }))).toBeNull();
    expect(resolveScopedShortcutAction(keydown({ key: 'a', metaKey: true }))).toBe('select-all');
    expect(resolveScopedShortcutAction(keydown({ key: '[' }))).toBe('brush-size-decrease');
    expect(resolveScopedShortcutAction(keydown({ key: ']' }))).toBe('brush-size-increase');
    expect(resolveScopedShortcutAction(keydown({ key: 'Delete' }))).toBe('context-delete');
    expect(resolveScopedShortcutAction(keydown({ key: 'Backspace' }))).toBe('context-delete');
    expect(resolveScopedShortcutAction(keydown({ key: 'Enter' }))).toBe('context-enter');
    expect(resolveScopedShortcutAction(keydown({ code: 'NumpadEnter' }))).toBe('context-enter');
    expect(resolveScopedShortcutAction(keydown({ key: 'Escape' }))).toBe('context-escape');
  });

  it('distinguishes palette swap/copy and blocks repeats', () => {
    expect(resolveScopedShortcutAction(keydown({ key: 'x', code: 'KeyX' }))).toBe('palette-swap');
    expect(resolveScopedShortcutAction(keydown({ key: 'x', code: 'KeyX', shiftKey: true }))).toBe('palette-copy');
    expect(resolveScopedShortcutAction(keydown({ key: 'x', code: 'KeyX', repeat: true }))).toBeNull();
  });
});
