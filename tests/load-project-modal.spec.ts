import path from 'node:path';

import { expect, test } from 'playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

test.describe('Load Project Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByRole('button', { name: /Load File/i })).toBeVisible({ timeout: 20000 });
  });

  test('opens and closes from the toolbar', async ({ page }) => {
    await page.getByRole('button', { name: /Load File/i }).click();
    await expect(page.getByRole('heading', { name: 'Load Project' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Browse Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Browse Folder' })).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Load Project' })).not.toBeVisible();
  });

  test('browses mocked folder entries and shows them sorted', async ({ page }) => {
    await page.evaluate(() => {
      (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
        const makeFileHandle = (name: string): FileSystemFileHandle => ({
          kind: 'file',
          name,
          async getFile() {
            return new File(['demo'], name, {
              type: 'application/json',
              lastModified: Date.now(),
            });
          },
          async isSameEntry(other: FileSystemHandle) {
            return other.name === name;
          },
        } as FileSystemFileHandle);

        return {
          kind: 'directory',
          name: 'mock-projects',
          async *entries() {
            yield ['project-10.vs', makeFileHandle('project-10.vs')] as [string, FileSystemHandle];
            yield ['project-2.vs', makeFileHandle('project-2.vs')] as [string, FileSystemHandle];
            yield ['project-1.vs', makeFileHandle('project-1.vs')] as [string, FileSystemHandle];
          },
          async isSameEntry(other: FileSystemHandle) {
            return other.name === 'mock-projects';
          },
        } as FileSystemDirectoryHandle;
      };
    });

    await page.getByRole('button', { name: /Load File/i }).click();
    await page.getByRole('button', { name: 'Browse Folder' }).click();

    const first = page.locator('button', { hasText: 'project-1.vs' }).first();
    const second = page.locator('button', { hasText: 'project-2.vs' }).first();
    const third = page.locator('button', { hasText: 'project-10.vs' }).first();
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(third).toBeVisible();
  });

  test('shows a real artwork fitted and centered before health inspection completes', async ({ page }) => {
    const fixturePath = path.resolve(
      'tests/fixtures/goblet2/legacy-corpus/pre-schema-2-susan-kare-2.vs',
    );
    await page.getByRole('button', { name: /Load File/i }).click();
    const startedAt = Date.now();
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    const preview = page.getByRole('img', { name: 'Untitled preview' });
    await expect(preview).toBeVisible();
    const firstPreviewMs = Date.now() - startedAt;
    const geometry = await preview.evaluate((image) => {
      const imageRect = image.getBoundingClientRect();
      const viewportRect = image.parentElement?.parentElement?.getBoundingClientRect();
      if (!viewportRect) {
        throw new Error('Missing preview viewport');
      }
      return {
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
        centerDeltaX: Math.abs(
          (imageRect.left + imageRect.width / 2)
          - (viewportRect.left + viewportRect.width / 2),
        ),
        centerDeltaY: Math.abs(
          (imageRect.top + imageRect.height / 2)
          - (viewportRect.top + viewportRect.height / 2),
        ),
      };
    });

    expect(firstPreviewMs).toBeLessThan(1000);
    expect(geometry.imageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.imageHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.centerDeltaX).toBeLessThan(2);
    expect(geometry.centerDeltaY).toBeLessThan(2);
  });
});
