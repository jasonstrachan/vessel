import { SpamTextSequence } from '@/hooks/brushEngine/spamTextSequence';

const take = (sequence: SpamTextSequence, count: number): string[] =>
  Array.from({ length: count }, () => sequence.getNextChar());

describe('SpamTextSequence', () => {
  it('returns the uninitialized fallback without advancing the cursor', () => {
    const sequence = new SpamTextSequence();

    expect(take(sequence, 2)).toEqual(['S', 'S']);
    expect(sequence.getState()).toEqual({ currentText: '', charIndex: 0, initialized: false });
  });

  it('preserves ASCII whitespace, wrapping and the emitted-character counter', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'AB ');

    expect(take(sequence, 7)).toEqual(['A', 'B', ' ', 'A', 'B', ' ', 'A']);
    expect(sequence.getState()).toEqual({ currentText: 'AB ', charIndex: 7, initialized: true });
  });

  it('emits an intact astral code point between ASCII characters across wrap', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'A😀B');

    expect(take(sequence, 7)).toEqual(['A', '😀', 'B', 'A', '😀', 'B', 'A']);
    expect(sequence.getState()).toEqual({ currentText: 'A😀B', charIndex: 7, initialized: true });
  });

  it('keeps adjacent astral code points intact on repeated cycles', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', '😀🚀');

    expect(take(sequence, 5)).toEqual(['😀', '🚀', '😀', '🚀', '😀']);
    expect(sequence.getState().charIndex).toBe(5);
  });

  it('emits combining marks as separate code points without normalizing the source', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'e\u0301X');

    expect(take(sequence, 4)).toEqual(['e', '\u0301', 'X', 'e']);
    expect(sequence.getState().currentText).toBe('e\u0301X');
  });

  it('preserves leading, trailing, newline and tab characters in nonblank custom text', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', ' \nA\t');

    expect(take(sequence, 4)).toEqual([' ', '\n', 'A', '\t']);
    expect(sequence.getState().currentText).toBe(' \nA\t');
  });

  it('retains the code-point cursor when initialized again with the same text', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'A😀B');
    take(sequence, 2);
    sequence.initialize('mixed', 'A😀B');

    expect(take(sequence, 3)).toEqual(['B', 'A', '😀']);
    expect(sequence.getState().charIndex).toBe(5);
  });

  it('uses the retained emitted-character cursor when replacing custom text', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'A😀B');
    take(sequence, 2);
    sequence.initialize('classic', 'x🚀z');

    expect(take(sequence, 4)).toEqual(['z', 'x', '🚀', 'z']);
    expect(sequence.getState()).toEqual({ currentText: 'x🚀z', charIndex: 6, initialized: true });
  });

  it('wraps the retained cursor by the replacement code-point length', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', 'ABCDE');
    take(sequence, 4);
    sequence.initialize('mixed', '😀x');

    expect(take(sequence, 3)).toEqual(['😀', 'x', '😀']);
    expect(sequence.getState().charIndex).toBe(7);
  });

  it('resets the cursor while retaining readable text until reinitialization', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('mixed', '😀A');
    take(sequence, 3);
    sequence.reset();

    expect(sequence.getState()).toEqual({ currentText: '😀A', charIndex: 0, initialized: false });
    expect(sequence.getNextChar()).toBe('😀');
    sequence.initialize('mixed', 'B🚀');
    expect(sequence.getState().charIndex).toBe(0);
    expect(take(sequence, 3)).toEqual(['B', '🚀', 'B']);
  });

  it('retains the existing named preset fallback and its ASCII wrap', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('classic');
    const text = sequence.getState().currentText;

    expect(text.startsWith('WINNER!!! ACT NOW!!!')).toBe(true);
    expect(take(sequence, text.length + 2).join('')).toBe(text + 'WI');
  });

  it.each(['', ' \n\t'])('uses the mixed preset for unknown content with blank custom text %j', (customText) => {
    const sequence = new SpamTextSequence();
    sequence.initialize('unknown', customText);

    expect(sequence.getState().currentText.startsWith('WINNER!!! TO THE MOON!!!')).toBe(true);
    expect(take(sequence, 7).join('')).toBe('WINNER!');
  });

  it('gives nonblank Unicode custom text precedence over an unknown preset', () => {
    const sequence = new SpamTextSequence();
    sequence.initialize('unknown', ' 🚀 ');

    expect(take(sequence, 4)).toEqual([' ', '🚀', ' ', ' ']);
    expect(sequence.getState().currentText).toBe(' 🚀 ');
  });
});
