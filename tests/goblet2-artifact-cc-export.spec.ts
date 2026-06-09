import { expect, test } from 'playwright/test';

import { renderSingleFileGobletArtifact } from './helpers/gobletArtifactHarness';

test.describe('Goblet 2 artifact color-cycle export harness', () => {
  test('isolates each visible CC layer and pixel-checks the rendered artifact', async ({ page }) => {
    const { result, pageErrors, consoleErrors } = await renderSingleFileGobletArtifact(page);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(result).toMatchObject({ ready: true });
    expect(result.error).toBeUndefined();
    expect(result.layers.map((layer) => layer.id)).toEqual(['cc-layer-1', 'cc-layer-2']);
    for (const layer of result.layers) {
      expect(layer.nonZeroAlpha).toBeGreaterThan(0);
      expect(layer.nonBackgroundPixels).toBeGreaterThan(0);
    }
  });

  test('keeps animated stroke-style CC layers painting after playback advances', async ({ page }) => {
    const { result, pageErrors, consoleErrors } = await renderSingleFileGobletArtifact(
      page,
      undefined,
      { animationFrames: 90 },
    );

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(result.error).toBeUndefined();

    const strokeLayer = result.layers.find((layer) => layer.id === 'cc-layer-1');
    expect(strokeLayer).toBeDefined();
    expect(strokeLayer?.nonZeroAlpha).toBeGreaterThan(0);
    expect(strokeLayer?.nonBackgroundPixels).toBeGreaterThan(0);
    expect(strokeLayer?.afterAnimationNonZeroAlpha).toBeGreaterThan(0);
    expect(strokeLayer?.afterAnimationNonBackgroundPixels).toBeGreaterThan(0);
  });
});
