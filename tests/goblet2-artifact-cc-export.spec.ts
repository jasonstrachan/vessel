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
});
