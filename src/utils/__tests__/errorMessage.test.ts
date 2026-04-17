import { getErrorMessage, getErrorStack } from '@/utils/errorMessage';

describe('errorMessage utilities', () => {
  it('returns standard Error messages and stacks', () => {
    const error = new Error('Boom');

    expect(getErrorMessage(error)).toBe('Boom');
    expect(getErrorStack(error)).toContain('Boom');
  });

  it('unwraps nested rejection reasons', () => {
    const reason = { reason: new Error('Nested failure') };

    expect(getErrorMessage(reason, 'fallback')).toBe('Nested failure');
  });

  it('describes event objects without collapsing to object Event', () => {
    const event = new Event('error');

    expect(getErrorMessage(event, 'fallback')).toBe('Event "error"');
    expect(getErrorStack(event)).toBeNull();
  });

  it('ignores generic object event strings and falls back', () => {
    expect(getErrorMessage('[object Event]', 'fallback')).toBe('fallback');
    expect(getErrorMessage({ message: '[object Event]' }, 'fallback')).toBe('fallback');
  });
});
