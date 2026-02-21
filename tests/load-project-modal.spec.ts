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
});
