let cachedSupport: boolean | null = null;

export function supportsOffscreenComposite(): boolean {
  if (cachedSupport !== null) {
    return cachedSupport;
  }

  if (typeof window === 'undefined') {
    cachedSupport = false;
    return cachedSupport;
  }

  const hasOffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined';

  const hasCreateImageBitmap = typeof window.createImageBitmap === 'function';

  // transferControlToOffscreen is optional; if unavailable we can still render on main thread
  cachedSupport = hasOffscreenCanvas && hasCreateImageBitmap;
  return cachedSupport;
}

export function resetOffscreenSupportCache(): void {
  cachedSupport = null;
}
