// Test function to draw dither palette swatches on canvas
// Run in console: window.drawTestSwatches()

export const drawTestSwatches = async () => {
  // Get the store to access canvas through proper methods
  const store = (window as Window & { __tinybrushStore?: unknown }).__tinybrushStore;
  if (!store) {
    console.error('Store not found - click the button again in a moment');
    return;
  }
  
  const state = store.getState();
  
  // Get the current offscreen canvas
  const offscreenCanvas = state.currentOffscreenCanvas;
  
  if (!offscreenCanvas) {
    console.error('No offscreen canvas found');
    return;
  }
  
  const ctx = offscreenCanvas.getContext('2d');
  if (!ctx) return;
  
  // Combined dithering palette (from useBrushEngine.ts DITHER_PALETTE)
  const testColors = [
    // Core neutrals
    { color: [0, 0, 0], name: 'Black' },
    { color: [255, 255, 255], name: 'White' },
    { color: [128, 128, 128], name: 'Med Grey' },
    { color: [192, 192, 192], name: 'Lt Grey' },
    { color: [64, 64, 64], name: 'Dk Grey' },
    
    // Browns and earth tones
    { color: [139, 69, 19], name: 'Saddle' },
    { color: [160, 82, 45], name: 'Sienna' },
    { color: [205, 133, 63], name: 'Peru' },
    { color: [210, 180, 140], name: 'Tan' },
    { color: [222, 184, 135], name: 'Burly' },
    { color: [245, 222, 179], name: 'Wheat' },
    { color: [255, 228, 196], name: 'Bisque' },
    { color: [101, 67, 33], name: 'DkBrown' },
    { color: [92, 51, 23], name: 'Russet' },
    { color: [61, 43, 31], name: 'Coffee' },
    
    // Warm neutrals
    { color: [188, 143, 143], name: 'Rosy' },
    { color: [244, 164, 96], name: 'Sandy' },
    { color: [255, 218, 185], name: 'Peach' },
    { color: [250, 235, 215], name: 'Antique' },
    { color: [245, 245, 220], name: 'Beige' },
    
    // Apple II vibrant colors
    { color: [114, 38, 64], name: 'Magenta' },
    { color: [64, 51, 127], name: 'DkBlue' },
    { color: [228, 52, 254], name: 'Purple' },
    { color: [14, 89, 64], name: 'DkGreen' },
    { color: [27, 154, 254], name: 'MedBlue' },
    { color: [191, 179, 255], name: 'LtBlue' },
    { color: [64, 76, 0], name: 'A2Brown' },
    { color: [228, 101, 1], name: 'Orange' },
    { color: [155, 161, 155], name: 'A2Gray' },
    { color: [255, 129, 236], name: 'Pink' },
    { color: [27, 203, 1], name: 'Green' },
    { color: [191, 204, 128], name: 'Yellow' },
    { color: [141, 217, 191], name: 'Aqua' }
  ];
  
  // Save current state
  ctx.save();
  
  // Draw swatches in a grid
  const swatchSize = 50;
  const padding = 4;
  const cols = 8;
  const rows = Math.ceil(testColors.length / cols);
  
  // Calculate grid dimensions
  const gridWidth = cols * swatchSize + (cols - 1) * padding;
  const gridHeight = rows * swatchSize + (rows - 1) * padding;
  
  // Center the grid on canvas
  const startX = (offscreenCanvas.width - gridWidth) / 2;
  const startY = (offscreenCanvas.height - gridHeight) / 2;
  
  testColors.forEach((swatch, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (swatchSize + padding);
    const y = startY + row * (swatchSize + padding);
    
    // Draw the swatch
    ctx.fillStyle = `rgb(${swatch.color[0]}, ${swatch.color[1]}, ${swatch.color[2]})`;
    ctx.fillRect(x, y, swatchSize, swatchSize);
    
    // Draw a border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, swatchSize, swatchSize);
    
    // Add text label
    ctx.fillStyle = swatch.color[0] + swatch.color[1] + swatch.color[2] > 400 ? '#000' : '#fff';
    ctx.font = '9px monospace';
    ctx.fillText(swatch.name, x + 2, y + 10);
  });
  
  ctx.restore();
  
  // Capture the canvas to the active layer to persist the swatches
  await state.captureCanvasToActiveLayer(offscreenCanvas);
  
  console.log('✅ Test swatches drawn! Total colors in combined palette: ' + testColors.length);
  console.log('Palette includes: neutrals, browns, and Apple II vibrant colors');
  console.log('Draw rectangles on each color with colors=2 to test dithering.');
};

// Make it available globally
if (typeof window !== 'undefined') {
  (window as Window & { drawTestSwatches?: typeof drawTestSwatches }).drawTestSwatches = drawTestSwatches;
}