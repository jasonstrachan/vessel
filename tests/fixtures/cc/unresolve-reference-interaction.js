// Run against production Studio. The expected colours come from a reference
// image, never from the sampled palettes or the animation implementation.
async function verifyUnresolveReference(page, bandPx = 1, zoom = 1, turningMode = null) {
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Color Cycle Stroke', exact: true }).click();
  await page.evaluate(({ spacing, scale }) => {
    const state = window.__vesselStore.getState();
    const reference = state.layers.find(layer => layer.layerType === 'normal');
    const canvas = document.createElement('canvas');
    canvas.width = state.project.width;
    canvas.height = state.project.height;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < canvas.height; y++) {
      const value = Math.floor(y / 80) % 2 ? 195 : 55;
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(0, y, canvas.width, 1);
    }
    state.updateLayer(reference.id, { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), framebuffer: canvas, visible: true });
    state.setActiveLayer(state.layers.find(layer => layer.layerType === 'color-cycle').id);
    state.setBrushSettings({ size: 24, spacing: 1, pressureEnabled: false,
      colorCycleStampDitherEnabled: true, ditherEnabled: false, colorCycleStampDitherPixelSize: 1,
      colorCycleStampDitherBgFill: true, colorCycleStampDitherPressureLinked: false,
      colorCycleStampShape: 'diamond', ditherAlgorithm: 'sierra-lite', ditherPatternDiversity: 0,
      colorCycleBandSpacingPx: spacing, colorCyclePencilEnabled: false, colorCycleBristlesEnabled: false,
      colorCycleSpeed: 0.1, ccGradientRangeContrast: 100, ditherPaletteSpread: 57,
      colorCycleGradientSeamProfile: 'hard' });
    state.pauseColorCycle();
    state.setZoom(scale);
  }, { spacing: bandPx, scale: zoom });
  const sourceToggle = page.getByRole('group', { name: 'Colour source and effects' })
    .getByRole('button', { name: 'Unresolve', exact: true });
  if (await sourceToggle.count()) {
    await sourceToggle.click();
  } else {
    await page.getByRole('button', { name: 'Effects', exact: true }).click();
    await page.getByRole('button', { name: 'Unresolve', exact: true }).and(page.locator('button.w-full')).click();
    await page.getByRole('button', { name: 'Sample strokes: Off', exact: true }).click();
    // The original sampling control also changes contrast; retain this fixture's settings.
    await page.evaluate(() => window.__vesselStore.getState().setBrushSettings({ ccGradientRangeContrast: 100 }));
    await page.getByRole('button', { name: 'Brushes', exact: true }).click();
  }
  const stroke = async (top, bottom, turns) => {
    await page.mouse.move(130, top);
    await page.mouse.down();
    for (let turn = 0; turn < turns; turn++) {
      const x = 130 + turn * 36;
      for (let step = 1; step <= 18; step++) {
        const fraction = step / 18;
        const y = turn % 2 ? bottom - (bottom - top) * fraction : top + (bottom - top) * fraction;
        await page.mouse.move(x + step * 0.8, y);
      }
      if (turn + 1 < turns) await page.mouse.move(x + 36, turn % 2 ? top : bottom);
    }
    await page.mouse.up();
    await page.waitForFunction(() => {
      const state = window.__vesselStore.getState();
      const layer = state.layers.find(layer => layer.layerType === 'color-cycle');
      const buffers = layer.colorCycleData.colorCycleBrush.layerDocumentApi.getStrokeState(layer.id).buffers;
      return buffers.paint.some(value => value > 0) && !buffers.gid.includes(254);
    });
  };
  await stroke(180, 540, 12);
  // The second stroke starts at a different shared playback position.
  await page.evaluate(() => {
    const state = window.__vesselStore.getState();
    state.updateProject({ extensionData: { ...state.project.extensionData,
      unresolveClock: { version: 1, timeSeconds: 2.35, mode: 'forward', easeStrength: 0 } } });
  });
  await stroke(650, 760, 4);
  await page.getByRole('button', { name: 'Effects', exact: true }).click();
  await page.getByRole('button', { name: 'Unresolve', exact: true }).and(page.locator('button.w-full')).click();
  const measure = () => page.evaluate(() => {
    const state = window.__vesselStore.getState();
    const layer = state.layers.find(layer => layer.layerType === 'color-cycle');
    const buffers = layer.colorCycleData.colorCycleBrush.layerDocumentApi.getStrokeState(layer.id).buffers;
    const canvas = layer.colorCycleData.canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const reference = state.layers.find(layer => layer.layerType === 'normal').imageData.data;
    let checked = 0, wrong = 0;
    for (let i = 0; i < buffers.paint.length; i++) {
      const y = Math.floor(i / canvas.width);
      // Exclude the tip radius and a whole wide band at stripe boundaries.
      if (!buffers.paint[i] || y % 80 < 32 || y % 80 > 48) continue;
      checked++;
      if ((pixels[i * 4] > 128) !== (reference[i * 4] > 128)) wrong++;
    }
    return { checked, wrong, clock: state.project.extensionData.unresolveClock.timeSeconds };
  });
  const results = [];
  for (const cycle of [0, 37, 81]) {
    await page.getByRole('slider', { name: 'Unresolve cycle', exact: true }).fill(String(cycle));
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const result = await measure();
    results.push(result);
    if (result.clock !== 0 || result.checked < 1000 || result.wrong !== 0) {
      throw new Error(`Resolve does not match the reference after cycle ${cycle}: ${JSON.stringify(result)}`);
    }
  }
  await page.evaluate(() => {
    const state = window.__vesselStore.getState();
    const canvas = state.layers.find(layer => layer.layerType === 'color-cycle').colorCycleData.canvas;
    window.__unresolveResolvedPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    state.playColorCycle('toolbar');
  });
  await page.waitForFunction(() => {
    const state = window.__vesselStore.getState();
    const canvas = state.layers.find(layer => layer.layerType === 'color-cycle').colorCycleData.canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => value !== window.__unresolveResolvedPixels[index]);
  });
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const afterPlayback = await measure();
  if (afterPlayback.clock !== 0 || afterPlayback.wrong !== 0) {
    throw new Error(`Resolve after live playback differs from reference: ${JSON.stringify(afterPlayback)}`);
  }
  const turns = [];
  if (turningMode) {
    await page.getByRole('button', { name: turningMode, exact: true }).click();
    await page.getByRole('slider', { name: 'Ease strength', exact: true }).fill('63');
    await page.getByRole('slider', { name: 'Cycle length', exact: true }).fill('20.5');
    for (const cycle of [0, 20, 25, 50, 70, 75, 100]) {
      await page.getByRole('slider', { name: 'Unresolve cycle', exact: true }).fill(String(cycle));
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      const result = await measure();
      const turning = cycle % 50 === 0;
      if (turning && result.wrong !== 0) {
        throw new Error(`${turningMode} must resolve at its turns and move between them: ${cycle}, ${JSON.stringify(result)}`);
      }
      turns.push({ cycle, ...result });
    }
    if (!turns.some(result => result.wrong > 0)) {
      throw new Error(`${turningMode} did not move away from the reference between turns`);
    }
  }
  return { bandPx, zoom, strokes: 2, results, afterPlayback, turns };
}
