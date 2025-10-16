import { __keyboardTestUtils } from '@/hooks/useComprehensiveKeyboard';

describe('useComprehensiveKeyboard text target detection', () => {
  const { isTextEntryTarget } = __keyboardTestUtils;

  it('treats text input elements as text entry targets', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isTextEntryTarget(input)).toBe(true);
  });

  it('recognizes non-text form controls like range sliders as non-text entry', () => {
    const range = document.createElement('input');
    range.type = 'range';
    expect(isTextEntryTarget(range)).toBe(false);
  });

  it('includes textarea and contenteditable elements as text entry targets', () => {
    const textarea = document.createElement('textarea');
    expect(isTextEntryTarget(textarea)).toBe(true);

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    expect(isTextEntryTarget(editable)).toBe(true);
    document.body.removeChild(editable);
  });

  it('returns false for nullish targets', () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
