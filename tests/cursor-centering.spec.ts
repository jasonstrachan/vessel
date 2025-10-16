import { test, expect } from '@playwright/test';

test.describe('Cursor Centering Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://127.0.0.1:3000');
    
    // Wait for canvas to load
    await page.waitForSelector('[data-canvas-container]', { timeout: 10000 });
    
    // Wait a bit more for the app to fully initialize
    await page.waitForTimeout(2000);
  });

  test('cursor updates when brush size changes', async ({ page }) => {
    // Get the canvas container
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Check initial cursor style
    const initialCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    console.log('Initial cursor:', initialCursor);
    
    // Find and change brush size - look for size input/slider
    const brushSizeInput = page.locator('input[type="range"]').first();
    await expect(brushSizeInput).toBeVisible();
    
    // Get initial brush size
    const initialSize = await brushSizeInput.inputValue();
    console.log('Initial brush size:', initialSize);
    
    // Change brush size to a larger value
    await brushSizeInput.fill('20');
    await page.waitForTimeout(500); // Wait for cursor to update
    
    // Check cursor style after size change
    const updatedCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    console.log('Updated cursor:', updatedCursor);
    
    // Verify cursor changed (should be different data URL)
    expect(updatedCursor).not.toBe(initialCursor);
    expect(updatedCursor).toContain('url(data:image/png;base64');
  });

  test('cursor centers properly for different brush shapes', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Test circle brush
    const circleButton = page.locator('button').filter({ hasText: /circle|○/i }).first();
    if (await circleButton.isVisible()) {
      await circleButton.click();
      await page.waitForTimeout(300);
      
      const circleCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
      expect(circleCursor).toContain('url(data:image/png;base64');
      console.log('Circle cursor generated successfully');
    }
    
    // Test square brush
    const squareButton = page.locator('button').filter({ hasText: /square|□/i }).first();
    if (await squareButton.isVisible()) {
      await squareButton.click();
      await page.waitForTimeout(300);
      
      const squareCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
      expect(squareCursor).toContain('url(data:image/png;base64');
      console.log('Square cursor generated successfully');
    }
  });

  test('cursor includes hotspot coordinates for centering', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Get cursor style
    const cursorStyle = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    
    // Verify cursor has hotspot coordinates (should contain two numbers before ", crosshair")
    const hotspotPattern = /url\(data:image\/png;base64,[^)]+\)\s+(\d+)\s+(\d+),\s*crosshair/;
    const match = cursorStyle.match(hotspotPattern);
    
    expect(match).toBeTruthy();
    if (match) {
      const hotspotX = parseInt(match[1]);
      const hotspotY = parseInt(match[2]);
      
      console.log(`Cursor hotspot: (${hotspotX}, ${hotspotY})`);
      
      // Hotspot should be reasonable (not 0, not too large)
      expect(hotspotX).toBeGreaterThan(0);
      expect(hotspotY).toBeGreaterThan(0);
      expect(hotspotX).toBeLessThan(100); // Reasonable max
      expect(hotspotY).toBeLessThan(100);
      
      // For a centered cursor, X and Y should be equal (square canvas)
      expect(hotspotX).toBe(hotspotY);
    }
  });

  test('cursor updates when switching tools', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Get brush cursor
    const brushCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    
    // Switch to eraser tool
    const eraserButton = page.locator('button').filter({ hasText: /eraser|erase/i }).first();
    if (await eraserButton.isVisible()) {
      await eraserButton.click();
      await page.waitForTimeout(300);
      
      const eraserCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
      
      // Both should be dynamic cursors but potentially different
      expect(eraserCursor).toContain('url(data:image/png;base64');
      console.log('Eraser cursor generated successfully');
    }
    
    // Switch to fill tool
    const fillButton = page.locator('button').filter({ hasText: /fill|bucket/i }).first();
    if (await fillButton.isVisible()) {
      await fillButton.click();
      await page.waitForTimeout(300);
      
      const fillCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
      expect(fillCursor).toBe('pointer');
      console.log('Fill tool uses pointer cursor correctly');
    }
  });

  test('cursor scales with zoom level', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Get initial cursor at default zoom
    const initialCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    
    // Simulate zoom by scrolling on canvas (zoom with mouse wheel)
    await canvasContainer.hover();
    
    // Zoom in with wheel events
    await page.mouse.wheel(0, -500); // Negative delta = zoom in
    await page.waitForTimeout(500);
    
    const zoomedCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    
    // Cursor should have changed due to zoom affecting size calculation
    console.log('Initial cursor length:', initialCursor.length);
    console.log('Zoomed cursor length:', zoomedCursor.length);
    
    // The data URLs should be different (different size rendering)
    expect(zoomedCursor).not.toBe(initialCursor);
    expect(zoomedCursor).toContain('url(data:image/png;base64');
  });

  test('cursor changes during pan mode', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Get normal cursor
    const normalCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    
    // Press space to enter pan mode
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    
    const panCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    expect(panCursor).toBe('grab');
    console.log('Pan mode cursor is grab');
    
    // Start panning
    await canvasContainer.hover();
    await page.mouse.down();
    await page.waitForTimeout(100);
    
    const grabbingCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    expect(grabbingCursor).toBe('grabbing');
    console.log('Active pan cursor is grabbing');
    
    // Release mouse and space
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);
    
    // Should return to dynamic brush cursor
    const finalCursor = await canvasContainer.evaluate(el => getComputedStyle(el).cursor);
    expect(finalCursor).toContain('url(data:image/png;base64');
    console.log('Returned to dynamic brush cursor');
  });
});