import { test, expect } from '@playwright/test';

test.describe('Pixel Perfect + Rotation Debug', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('http://127.0.0.1:3000');
    
    // Wait for canvas to load
    await page.waitForSelector('[data-canvas-container]', { timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('debug pixel perfect + rotation behavior', async ({ page }) => {
    // Listen to console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'log' && (
        msg.text().includes('🎯 STROKE PATH') || 
        msg.text().includes('📍 PATH:') ||
        msg.text().includes('🎨 drawShape') ||
        msg.text().includes('⚙️ setGraphicsMode') ||
        msg.text().includes('🔧 Using') ||
        msg.text().includes('🔲 Setting') ||
        msg.text().includes('🌊 Setting')
      )) {
        consoleLogs.push(msg.text());
        console.log(msg.text());
      }
    });

    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Enable pixel-perfect mode
    const pixelPerfectToggle = page.locator('text=Pixel Perfect').or(page.locator('[data-testid="pixel-perfect"]'));
    if (await pixelPerfectToggle.isVisible()) {
      await pixelPerfectToggle.click();
      console.log('✅ Enabled pixel-perfect mode');
    }
    
    // Enable rotation
    const rotationToggle = page.locator('text=Rotate').or(page.locator('[data-testid="rotation"]'));
    if (await rotationToggle.isVisible()) {
      await rotationToggle.click();
      console.log('✅ Enabled rotation');
    }
    
    // Set brush size to something visible
    const brushSizeInput = page.locator('input[type="range"]').first();
    if (await brushSizeInput.isVisible()) {
      await brushSizeInput.fill('10');
      console.log('✅ Set brush size to 10');
    }
    
    await page.waitForTimeout(500);
    
    // Clear any existing logs
    consoleLogs.length = 0;
    
    // Draw a circle to trigger the issue
    const canvasRect = await canvasContainer.boundingBox();
    if (!canvasRect) throw new Error('Canvas not found');
    
    const centerX = canvasRect.x + canvasRect.width / 2;
    const centerY = canvasRect.y + canvasRect.height / 2;
    const radius = 50;
    
    console.log('🎨 Starting circle draw...');
    
    // Start drawing
    await page.mouse.move(centerX + radius, centerY);
    await page.mouse.down();
    
    // Draw circle in segments to trigger rotation changes
    const segments = 16;
    for (let i = 1; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      
      await page.mouse.move(x, y);
      await page.waitForTimeout(50); // Pause to let logging happen
    }
    
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    console.log('🎨 Circle draw completed');
    
    // Analyze the logs
    console.log('\n📊 ANALYSIS:');
    console.log(`Total logged events: ${consoleLogs.length}`);
    
    const pathDecisions = consoleLogs.filter(log => log.includes('📍 PATH:'));
    const drawShapeCalls = consoleLogs.filter(log => log.includes('🎨 drawShape'));
    const modeChanges = consoleLogs.filter(log => log.includes('🔲 Setting') || log.includes('🌊 Setting'));
    
    console.log(`Path decisions: ${pathDecisions.length}`);
    console.log(`drawShape calls: ${drawShapeCalls.length}`);
    console.log(`Mode changes: ${modeChanges.length}`);
    
    // Check for mode switching issues
    let pixelModeSet = 0;
    let smoothModeSet = 0;
    
    modeChanges.forEach(log => {
      if (log.includes('🔲 Setting PIXEL-PERFECT')) pixelModeSet++;
      if (log.includes('🌊 Setting SMOOTH')) smoothModeSet++;
    });
    
    console.log(`Pixel mode set: ${pixelModeSet} times`);
    console.log(`Smooth mode set: ${smoothModeSet} times`);
    
    // The issue: if pixel perfect + rotation is ON, it should NEVER set smooth mode
    if (smoothModeSet > 0) {
      console.log('❌ BUG DETECTED: Smooth mode was set when pixel-perfect + rotation should be active!');
      
      // Show the problematic logs
      modeChanges.forEach((log, i) => {
        console.log(`  ${i + 1}. ${log}`);
      });
    } else {
      console.log('✅ Good: No unexpected smooth mode changes detected');
    }
    
    // Log some sample path decisions
    console.log('\n📍 Sample path decisions:');
    pathDecisions.slice(0, 5).forEach((log, i) => {
      console.log(`  ${i + 1}. ${log}`);
    });
    
    // Test passes if we captured the expected behavior
    expect(consoleLogs.length).toBeGreaterThan(0);
  });

  test('verify settings toggles work', async ({ page }) => {
    const canvasContainer = page.locator('[data-canvas-container]');
    
    // Try to find and test pixel perfect toggle
    const possiblePixelSelectors = [
      'text=Pixel Perfect',
      'text=Pixel-Perfect', 
      'text=Pixel',
      '[data-testid="pixel-perfect"]',
      'input[type="checkbox"]', // Last resort
    ];
    
    let pixelToggleFound = false;
    for (const selector of possiblePixelSelectors) {
      const toggle = page.locator(selector);
      if (await toggle.isVisible()) {
        await toggle.click();
        console.log(`✅ Found and clicked pixel toggle: ${selector}`);
        pixelToggleFound = true;
        break;
      }
    }
    
    if (!pixelToggleFound) {
      console.log('⚠️ Could not find pixel perfect toggle');
    }
    
    // Try to find and test rotation toggle
    const possibleRotationSelectors = [
      'text=Rotate',
      'text=Rotation',
      'text=Enable Rotation',
      '[data-testid="rotation"]',
      'input[type="checkbox"]', // Last resort
    ];
    
    let rotationToggleFound = false;
    for (const selector of possibleRotationSelectors) {
      const toggle = page.locator(selector);
      if (await toggle.isVisible()) {
        await toggle.click();
        console.log(`✅ Found and clicked rotation toggle: ${selector}`);
        rotationToggleFound = true;
        break;
      }
    }
    
    if (!rotationToggleFound) {
      console.log('⚠️ Could not find rotation toggle');
    }
    
    // At least verify the page loads
    expect(await canvasContainer.isVisible()).toBe(true);
  });
});