import fs from 'node:fs';
import path from 'node:path';

import { test } from 'playwright/test';

const studioUrl = process.env.VESSEL_STUDIO_TEST_URL;
const fixture = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/cc/unresolve-reference-interaction.js'), 'utf8');

test.describe('Unresolve reference alignment in production Studio', () => {
  test.skip(!studioUrl, 'Set VESSEL_STUDIO_TEST_URL to the running production Studio.');
  for (const { bandPx, zoom } of [{ bandPx: 1, zoom: 1 }, { bandPx: 20, zoom: 1 }, { bandPx: 1, zoom: 2.3 }]) {
    test(`resolves long turning strokes and later strokes at ${bandPx}px and ${Math.round(zoom * 100)}% zoom`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto(studioUrl!);
      const verify = new Function(`return (${fixture})`)() as (page: unknown, bandPx: number, zoom: number) => Promise<unknown>;
      await verify(page, bandPx, zoom);
    });
  }
});


for (const mode of ['Pendulum', 'Breathe']) {
  test(`${mode} resolves at both eased turning points`, async ({ page }) => {
    test.skip(!studioUrl, 'Set VESSEL_STUDIO_TEST_URL to the running production Studio.');
    test.setTimeout(180_000);
    await page.goto(studioUrl!);
    const verify = new Function(`return (${fixture})`)() as (page: unknown, bandPx: number, zoom: number, turningMode: string) => Promise<unknown>;
    await verify(page, 1, 1, mode);
  });
}


test('holds playback during painting and cancellation and reuses unchanged palettes', async ({ page }) => {
  test.skip(!studioUrl, 'Set VESSEL_STUDIO_TEST_URL to the running production Studio.');
  test.setTimeout(180_000);
  await page.goto(studioUrl!);
  const source = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/cc/painting-playback-hold.js'), 'utf8');
  const verify = new Function(`return (${source})`)() as (page: unknown) => Promise<unknown>;
  await verify(page);
});
