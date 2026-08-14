import {
  getReferenceStudioSessionId,
  getReferenceStudioSessionIdFromLocation,
  openReferenceStudioWindow,
} from '@/referenceStudio/referenceStudioChannel';

describe('Reference Studio window session', () => {
  it('opens a stable popup isolated to the originating Vessel window', () => {
    const focus = jest.fn();
    const open = jest.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window);

    expect(openReferenceStudioWindow()).toBe(true);
    expect(openReferenceStudioWindow()).toBe(true);

    const firstCall = open.mock.calls[0];
    const secondCall = open.mock.calls[1];
    const sessionId = getReferenceStudioSessionId();
    expect(firstCall?.[0]).toContain(`/reference-studio/?session=${sessionId}`);
    expect(firstCall?.[1]).toBe(`vessel-reference-studio-${sessionId}`);
    expect(secondCall?.[1]).toBe(firstCall?.[1]);
    expect(focus).toHaveBeenCalledTimes(2);

    open.mockRestore();
  });

  it('reads the originating session from the studio URL', () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/reference-studio/?session=window-a');

    expect(getReferenceStudioSessionIdFromLocation()).toBe('window-a');

    window.history.replaceState({}, '', originalUrl);
  });
});
