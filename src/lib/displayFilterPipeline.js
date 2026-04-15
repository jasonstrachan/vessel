const getNumeric = (value, fallback = 0) => (
  Number.isFinite(value) ? Number(value) : fallback
);

export const getSeamlessNoisePatternSize = (tileStep) => {
  const normalizedTileStep = Math.max(1, Math.round(getNumeric(tileStep, 1)));
  const targetPixels = 256;
  const cellsPerAxis = Math.max(8, Math.min(128, Math.round(targetPixels / normalizedTileStep)));
  return normalizedTileStep * cellsPerAxis;
};

const hashNoise = (x, y, seed) => {
  const value = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + seed * 17.13) * 43758.5453123;
  return value - Math.floor(value);
};

export const createTileableNoiseGrid = (columns, rows, seed = 0) => {
  const safeColumns = Math.max(1, Math.floor(getNumeric(columns, 1)));
  const safeRows = Math.max(1, Math.floor(getNumeric(rows, 1)));
  const grid = Array.from({ length: safeRows }, () => Array(safeColumns).fill(0));

  for (let y = 0; y < safeRows; y += 1) {
    for (let x = 0; x < safeColumns; x += 1) {
      const wrappedX = x === safeColumns - 1 ? 0 : x;
      const wrappedY = y === safeRows - 1 ? 0 : y;
      grid[y][x] = Math.floor(hashNoise(wrappedX, wrappedY, seed) * 255);
    }
  }

  return grid;
};

export const createDisplayFilterPipelineState = () => ({
  filterSurfaceCanvas: null,
  workCanvasA: null,
  workCanvasB: null,
  auxCanvas: null,
  bloomCanvas: null,
  channelCanvas: null,
  pixelateCanvas: null,
  lcdPatternKey: '',
  lcdPatternCanvas: null,
  crtGridPatternKey: '',
  crtGridPatternCanvas: null,
  crtGridGlowCanvas: null,
  noisePatternKey: '',
  noisePatternCanvas: null,
});

export const getNextFilterWorkCanvas = (currentCanvas, workCanvasA, workCanvasB) => (
  currentCanvas === workCanvasA ? workCanvasB : workCanvasA
);

export const ensureDisplayFilterCanvas = (canvas, width, height) => {
  if (typeof document === 'undefined') {
    return null;
  }
  const nextWidth = Math.max(1, Math.ceil(width));
  const nextHeight = Math.max(1, Math.ceil(height));
  const target = canvas ?? document.createElement('canvas');
  if (target.width !== nextWidth) {
    target.width = nextWidth;
  }
  if (target.height !== nextHeight) {
    target.height = nextHeight;
  }
  return target;
};

export const clearDisplayFilterCanvas = (canvas) => {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) {
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
};

export const getDisplayFilterByIdFromList = (filters, id) => (
  Array.isArray(filters) ? filters.find((filter) => filter?.id === id) : undefined
);

export const hasEnabledDisplayFiltersInList = (filters) => (
  Array.isArray(filters) && filters.some((filter) => filter?.enabled)
);

const buildColorGradeFilter = (filter) => {
  const brightness = 100 + getNumeric(filter?.settings?.brightness, 0) * 100;
  const contrast = 100 + getNumeric(filter?.settings?.contrast, 0) * 100;
  const saturation = getNumeric(filter?.settings?.saturation, 1) * 100;
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
};

const extractBrightPass = (ctx, canvas) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3] / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const threshold = 56;
    const highlight = Math.max(0, (luma - threshold) / (255 - threshold));
    const glow = Math.max(0.12, highlight) * alpha;
    data[index] = Math.min(255, r * (0.72 + highlight * 0.38) + glow * 120);
    data[index + 1] = Math.min(255, g * (0.78 + highlight * 0.28) + glow * 92);
    data[index + 2] = Math.min(255, b * (0.52 + highlight * 0.18) + glow * 44);
    data[index + 3] = Math.round(Math.min(255, 255 * glow));
  }
  ctx.putImageData(imageData, 0, 0);
};

const applyRoundPixelsWholeImage = ({
  currentCanvas,
  nextCanvas,
  workCanvas,
  blurRadius,
  threshold,
  crush,
  preserveColor,
}) => {
  const workCtx = clearDisplayFilterCanvas(workCanvas);
  const nextCtx = clearDisplayFilterCanvas(nextCanvas);
  if (!workCtx || !nextCtx) {
    return false;
  }

  const scaledBlurRadius = Math.max(0, getNumeric(blurRadius, 0));
  workCtx.imageSmoothingEnabled = true;
  workCtx.filter = scaledBlurRadius > 0 ? `blur(${scaledBlurRadius}px)` : 'none';
  workCtx.drawImage(currentCanvas, 0, 0);
  workCtx.filter = 'none';

  const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  const { data } = imageData;
  const pivot = Math.max(0, Math.min(1, getNumeric(threshold, 0.5)));
  const crushAmount = Math.max(0, Math.min(1, getNumeric(crush, 0)));
  const preserveAmount = Math.max(0, Math.min(1, getNumeric(preserveColor, 0.85)));
  const contrast = 1 + crushAmount * 24;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const a = data[index + 3] / 255;

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const crushedLuma = Math.max(0, Math.min(1, (luma - pivot) * contrast + 0.5));
    const thresholdLuma = luma >= pivot ? 1 : 0;
    const finalLuma = crushedLuma * (1 - crushAmount) + thresholdLuma * crushAmount;
    const lumaScale = luma > 0.0001 ? finalLuma / luma : 0;
    const preservedR = Math.max(0, Math.min(1, r * lumaScale));
    const preservedG = Math.max(0, Math.min(1, g * lumaScale));
    const preservedB = Math.max(0, Math.min(1, b * lumaScale));
    const neutralValue = finalLuma;

    data[index] = Math.round((preservedR * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 1] = Math.round((preservedG * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 2] = Math.round((preservedB * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 3] = Math.round(a * 255);
  }

  workCtx.putImageData(imageData, 0, 0);
  nextCtx.drawImage(workCanvas, 0, 0);
  return true;
};

export const applyDisplayFilterStack = ({
  sourceCanvas,
  displayFilters,
  filterState,
  visibleRect,
  lengthScale = 1,
}) => {
  const workCanvasA = ensureDisplayFilterCanvas(
    filterState.workCanvasA,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const workCanvasB = ensureDisplayFilterCanvas(
    filterState.workCanvasB,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  if (!workCanvasA || !workCanvasB) {
    return sourceCanvas;
  }

  filterState.workCanvasA = workCanvasA;
  filterState.workCanvasB = workCanvasB;

  let currentCanvas = sourceCanvas;
  let nextCanvas = workCanvasA;
  const auxCanvas = ensureDisplayFilterCanvas(
    filterState.auxCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.auxCanvas = auxCanvas;
  const bloomCanvas = ensureDisplayFilterCanvas(
    filterState.bloomCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.bloomCanvas = bloomCanvas;
  const channelCanvas = ensureDisplayFilterCanvas(
    filterState.channelCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.channelCanvas = channelCanvas;

  const origin = visibleRect ?? { x: 0, y: 0 };
  const normalizedLengthScale = Math.max(0.0001, getNumeric(lengthScale, 1));
  const pixelateFilter = getDisplayFilterByIdFromList(displayFilters, 'pixelate');
  const bloomFilter = getDisplayFilterByIdFromList(displayFilters, 'bloom');
  const roundPixelsFilter = getDisplayFilterByIdFromList(displayFilters, 'round-pixels');
  const colorGradeFilter = getDisplayFilterByIdFromList(displayFilters, 'color-grade');
  const lcdMaskFilter = getDisplayFilterByIdFromList(displayFilters, 'lcd-mask');
  const crtGridFilter = getDisplayFilterByIdFromList(displayFilters, 'crt-grid');
  const chromaticAberrationFilter = getDisplayFilterByIdFromList(displayFilters, 'chromatic-aberration');
  const noiseFilter = getDisplayFilterByIdFromList(displayFilters, 'noise');

  const swap = (canvas) => {
    currentCanvas = canvas;
    nextCanvas = getNextFilterWorkCanvas(currentCanvas, workCanvasA, workCanvasB);
    return currentCanvas;
  };

  if (pixelateFilter?.enabled && getNumeric(pixelateFilter?.settings?.cellSize, 1) > 1) {
    const cellSize = Math.max(
      1,
      Math.round(getNumeric(pixelateFilter.settings.cellSize, 1) * normalizedLengthScale),
    );
    const downsampleCanvas = ensureDisplayFilterCanvas(
      filterState.pixelateCanvas,
      Math.max(1, Math.round(currentCanvas.width / cellSize)),
      Math.max(1, Math.round(currentCanvas.height / cellSize)),
    );
    filterState.pixelateCanvas = downsampleCanvas;
    const downsampleCtx = clearDisplayFilterCanvas(downsampleCanvas);
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (downsampleCanvas && downsampleCtx && nextCtx) {
      downsampleCtx.imageSmoothingEnabled = true;
      downsampleCtx.drawImage(currentCanvas, 0, 0, downsampleCanvas.width, downsampleCanvas.height);
      nextCtx.imageSmoothingEnabled = false;
      nextCtx.drawImage(downsampleCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
      swap(nextCanvas);
    }
  }

  if (
    roundPixelsFilter?.enabled &&
    getNumeric(pixelateFilter?.settings?.cellSize, 1) > 1
  ) {
    const workCanvas = ensureDisplayFilterCanvas(
      filterState.auxCanvas,
      currentCanvas.width,
      currentCanvas.height,
    );
    filterState.auxCanvas = workCanvas;
    if (workCanvas && applyRoundPixelsWholeImage({
      currentCanvas,
      nextCanvas,
      workCanvas,
      blurRadius: getNumeric(roundPixelsFilter.settings.blurRadius, 0),
      threshold: getNumeric(roundPixelsFilter.settings.threshold, 0.5),
      crush: getNumeric(roundPixelsFilter.settings.crush, 0),
      preserveColor: getNumeric(roundPixelsFilter.settings.preserveColor, 0.85),
    })) {
      swap(nextCanvas);
    }
  }

  if (bloomFilter?.enabled && getNumeric(bloomFilter?.settings?.blurRadius, 0) > 0 && getNumeric(bloomFilter?.settings?.intensity, 0) > 0) {
    const bloomSourceCanvas = ensureDisplayFilterCanvas(
      bloomCanvas,
      Math.max(1, Math.round(currentCanvas.width / 4)),
      Math.max(1, Math.round(currentCanvas.height / 4)),
    );
    filterState.bloomCanvas = bloomSourceCanvas;
    const bloomSourceCtx = clearDisplayFilterCanvas(bloomSourceCanvas);
    const bloomBlurCanvas = ensureDisplayFilterCanvas(
      auxCanvas,
      Math.max(1, Math.round(currentCanvas.width / 4)),
      Math.max(1, Math.round(currentCanvas.height / 4)),
    );
    const bloomBlurCtx = clearDisplayFilterCanvas(bloomBlurCanvas);
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (bloomSourceCanvas && bloomSourceCtx && bloomBlurCanvas && bloomBlurCtx && nextCtx) {
      const blurRadius = getNumeric(bloomFilter.settings.blurRadius, 0) * normalizedLengthScale;
      const intensity = getNumeric(bloomFilter.settings.intensity, 0);
      bloomSourceCtx.imageSmoothingEnabled = true;
      bloomSourceCtx.drawImage(currentCanvas, 0, 0, bloomSourceCanvas.width, bloomSourceCanvas.height);
      bloomBlurCtx.imageSmoothingEnabled = true;
      bloomBlurCtx.filter = `blur(${blurRadius}px)`;
      // Keep a visible low-frequency softness floor so bloom never disappears on mid-tone art.
      bloomBlurCtx.globalAlpha = Math.min(1, 0.18 + intensity * 0.16);
      bloomBlurCtx.drawImage(bloomSourceCanvas, 0, 0);
      extractBrightPass(bloomSourceCtx, bloomSourceCanvas);
      bloomBlurCtx.globalAlpha = Math.min(1, 0.55 + intensity * 0.35);
      bloomBlurCtx.globalCompositeOperation = 'lighter';
      bloomBlurCtx.drawImage(bloomSourceCanvas, 0, 0);
      bloomBlurCtx.filter = 'none';
      bloomBlurCtx.globalAlpha = 1;
      bloomBlurCtx.globalCompositeOperation = 'source-over';
      nextCtx.drawImage(currentCanvas, 0, 0);
      nextCtx.globalAlpha = Math.min(1, 0.45 + intensity * 0.45);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.drawImage(bloomBlurCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
      nextCtx.globalAlpha = 1;
      nextCtx.globalCompositeOperation = 'source-over';
      swap(nextCanvas);
    }
  }

  if (colorGradeFilter?.enabled) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.filter = buildColorGradeFilter(colorGradeFilter);
      nextCtx.drawImage(currentCanvas, 0, 0);
      nextCtx.filter = 'none';
      swap(nextCanvas);
    }
  }

  if (lcdMaskFilter?.enabled && (getNumeric(lcdMaskFilter?.settings?.stripeOpacity, 0) > 0 || getNumeric(lcdMaskFilter?.settings?.scanlineOpacity, 0) > 0)) {
    const baseCell = Math.max(
      1,
      Math.round(getNumeric(pixelateFilter?.settings?.cellSize, 1) * normalizedLengthScale),
    );
    const patternKey = JSON.stringify({
      baseCell,
      stripeOpacity: getNumeric(lcdMaskFilter.settings.stripeOpacity, 0),
      scanlineOpacity: getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0),
    });
    if (filterState.lcdPatternKey !== patternKey) {
      const patternCanvas = ensureDisplayFilterCanvas(
        filterState.lcdPatternCanvas,
        baseCell * 3,
        Math.max(2, baseCell * 2),
      );
      const patternCtx = clearDisplayFilterCanvas(patternCanvas);
      if (patternCanvas && patternCtx) {
        const stripeWidth = Math.max(1, Math.ceil(patternCanvas.width / 3));
        patternCtx.fillStyle = `rgba(255, 96, 96, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(0, 0, stripeWidth, patternCanvas.height);
        patternCtx.fillStyle = `rgba(96, 255, 96, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(stripeWidth, 0, stripeWidth, patternCanvas.height);
        patternCtx.fillStyle = `rgba(96, 160, 255, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(stripeWidth * 2, 0, patternCanvas.width - stripeWidth * 2, patternCanvas.height);
        if (getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0) > 0) {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0)})`;
          patternCtx.fillRect(0, patternCanvas.height - 1, patternCanvas.width, 1);
        }
      }
      filterState.lcdPatternKey = patternKey;
      filterState.lcdPatternCanvas = patternCanvas;
    }

    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      const patternCanvas = filterState.lcdPatternCanvas;
      const pattern = patternCanvas ? nextCtx.createPattern(patternCanvas, 'repeat') : null;
      if (pattern && patternCanvas) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'multiply';
        nextCtx.translate(
          -((origin.x % patternCanvas.width) + patternCanvas.width) % patternCanvas.width,
          -((origin.y % patternCanvas.height) + patternCanvas.height) % patternCanvas.height,
        );
        nextCtx.fillStyle = pattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + patternCanvas.width, nextCanvas.height + patternCanvas.height);
        nextCtx.restore();
      }
      swap(nextCanvas);
    }
  }

  if (crtGridFilter?.enabled && getNumeric(crtGridFilter?.settings?.lineOpacity, 0) > 0) {
    const baseCell = Math.max(
      1,
      Math.round(getNumeric(pixelateFilter?.settings?.cellSize, 1) * normalizedLengthScale),
    );
    const spacing = Math.max(1, Math.round(getNumeric(crtGridFilter?.settings?.lineSpacing, 4) * baseCell));
    const phosphorOpacity = getNumeric(crtGridFilter.settings.phosphorOpacity, 0.12);
    const scanlineOpacity = getNumeric(crtGridFilter.settings.scanlineOpacity, 0.18);
    const patternKey = JSON.stringify({
      spacing,
      lineOpacity: getNumeric(crtGridFilter.settings.lineOpacity, 0),
      phosphorOpacity,
      scanlineOpacity,
    });
    if (filterState.crtGridPatternKey !== patternKey) {
      const patternCanvas = ensureDisplayFilterCanvas(filterState.crtGridPatternCanvas, spacing, spacing);
      const glowCanvas = ensureDisplayFilterCanvas(filterState.crtGridGlowCanvas, spacing * 3, spacing);
      const patternCtx = clearDisplayFilterCanvas(patternCanvas);
      const glowCtx = clearDisplayFilterCanvas(glowCanvas);
      if (patternCanvas && patternCtx && glowCanvas && glowCtx) {
        const lineOpacity = getNumeric(crtGridFilter.settings.lineOpacity, 0);
        const scanlineHeight = 1;
        const maskTop = patternCanvas.height - scanlineHeight;
        const separatorOpacity = Math.min(1, lineOpacity * 0.72);
        const apertureOpacity = Math.min(1, lineOpacity * 0.5);

        if (patternCanvas.width > 1) {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${apertureOpacity})`;
          patternCtx.fillRect(patternCanvas.width - 1, 0, 1, patternCanvas.height);
        } else {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, apertureOpacity * 0.45)})`;
          patternCtx.fillRect(0, 0, 1, patternCanvas.height);
        }
        patternCtx.fillStyle = `rgba(0, 0, 0, ${separatorOpacity})`;
        patternCtx.fillRect(0, maskTop, patternCanvas.width, scanlineHeight);
        patternCtx.fillStyle = `rgba(255, 255, 255, ${lineOpacity * 0.04})`;
        patternCtx.fillRect(0, 0, patternCanvas.width, 1);

        const glowColors = [
          `rgba(255, 110, 96, ${phosphorOpacity})`,
          `rgba(116, 255, 120, ${phosphorOpacity})`,
          `rgba(110, 174, 255, ${phosphorOpacity})`,
        ];
        const stripeWidth = spacing;
        const glowInset = Math.max(0, Math.floor(stripeWidth * 0.15));
        const glowWidth = Math.max(1, stripeWidth - glowInset * 2);
        const glowHeight = Math.max(1, patternCanvas.height - scanlineHeight);
        for (let channel = 0; channel < 3; channel += 1) {
          const x = channel * stripeWidth + glowInset;
          glowCtx.fillStyle = glowColors[channel];
          glowCtx.fillRect(x, 0, glowWidth, glowHeight);
        }
        glowCtx.fillStyle = `rgba(255, 255, 255, ${phosphorOpacity * 0.22})`;
        glowCtx.fillRect(0, 0, patternCanvas.width, 1);
      }
      filterState.crtGridPatternKey = patternKey;
      filterState.crtGridPatternCanvas = patternCanvas;
      filterState.crtGridGlowCanvas = glowCanvas;
    }

    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      const patternCanvas = filterState.crtGridPatternCanvas;
      const glowCanvas = filterState.crtGridGlowCanvas;
      const pattern = patternCanvas ? nextCtx.createPattern(patternCanvas, 'repeat') : null;
      const glowPattern = glowCanvas ? nextCtx.createPattern(glowCanvas, 'repeat') : null;
      if (pattern && patternCanvas) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'multiply';
        nextCtx.translate(
          -((origin.x % patternCanvas.width) + patternCanvas.width) % patternCanvas.width,
          -((origin.y % patternCanvas.height) + patternCanvas.height) % patternCanvas.height,
        );
        nextCtx.fillStyle = pattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + patternCanvas.width, nextCanvas.height + patternCanvas.height);
        nextCtx.restore();
      }
      if (glowPattern && glowCanvas && phosphorOpacity > 0) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'screen';
        nextCtx.translate(
          -((origin.x % glowCanvas.width) + glowCanvas.width) % glowCanvas.width,
          -((origin.y % glowCanvas.height) + glowCanvas.height) % glowCanvas.height,
        );
        nextCtx.fillStyle = glowPattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + glowCanvas.width, nextCanvas.height + glowCanvas.height);
        nextCtx.restore();
      }
      swap(nextCanvas);
    }
  }

  if (
    chromaticAberrationFilter?.enabled
    && getNumeric(chromaticAberrationFilter?.settings?.offset, 0) > 0
    && getNumeric(chromaticAberrationFilter?.settings?.intensity, 0) > 0
  ) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    const channelCtx = clearDisplayFilterCanvas(channelCanvas);
    if (nextCtx && channelCanvas && channelCtx) {
      const offset = Math.max(
        0.5,
        getNumeric(chromaticAberrationFilter.settings.offset, 0) * normalizedLengthScale,
      );
      const intensity = getNumeric(chromaticAberrationFilter.settings.intensity, 0);
      nextCtx.drawImage(currentCanvas, 0, 0);

      channelCtx.drawImage(currentCanvas, 0, 0);
      channelCtx.globalCompositeOperation = 'multiply';
      channelCtx.fillStyle = 'rgb(255, 0, 0)';
      channelCtx.fillRect(0, 0, channelCanvas.width, channelCanvas.height);
      channelCtx.globalCompositeOperation = 'destination-in';
      channelCtx.drawImage(currentCanvas, 0, 0);

      nextCtx.save();
      nextCtx.globalAlpha = Math.min(1, intensity);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.drawImage(channelCanvas, -offset, 0.25 * offset);
      nextCtx.restore();

      clearDisplayFilterCanvas(channelCanvas);
      const blueChannelCtx = channelCanvas.getContext('2d');
      if (blueChannelCtx) {
        blueChannelCtx.drawImage(currentCanvas, 0, 0);
        blueChannelCtx.globalCompositeOperation = 'multiply';
        blueChannelCtx.fillStyle = 'rgb(0, 96, 255)';
        blueChannelCtx.fillRect(0, 0, channelCanvas.width, channelCanvas.height);
        blueChannelCtx.globalCompositeOperation = 'destination-in';
        blueChannelCtx.drawImage(currentCanvas, 0, 0);
      }

      nextCtx.save();
      nextCtx.globalAlpha = Math.min(1, intensity);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.drawImage(channelCanvas, offset, -0.25 * offset);
      nextCtx.restore();

      swap(nextCanvas);
    }
  }

  if (noiseFilter?.enabled && getNumeric(noiseFilter?.settings?.opacity, 0) > 0) {
    const tileStep = Math.max(
      1,
      Math.round(getNumeric(noiseFilter?.settings?.scale, 1) * normalizedLengthScale),
    );
    const patternKey = JSON.stringify({ tileStep });
    if (filterState.noisePatternKey !== patternKey) {
      const patternSize = getSeamlessNoisePatternSize(tileStep);
      const patternCanvas = ensureDisplayFilterCanvas(
        filterState.noisePatternCanvas,
        patternSize,
        patternSize,
      );
      const patternCtx = clearDisplayFilterCanvas(patternCanvas);
      if (patternCanvas && patternCtx) {
        const columns = Math.max(1, Math.round(patternCanvas.width / tileStep));
        const rows = Math.max(1, Math.round(patternCanvas.height / tileStep));
        const tones = createTileableNoiseGrid(columns, rows, tileStep);
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < columns; x += 1) {
            const tone = tones[y][x];
            patternCtx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
            patternCtx.fillRect(x * tileStep, y * tileStep, tileStep, tileStep);
          }
        }
      }
      filterState.noisePatternKey = patternKey;
      filterState.noisePatternCanvas = patternCanvas;
    }

    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      const patternCanvas = filterState.noisePatternCanvas;
      const pattern = patternCanvas ? nextCtx.createPattern(patternCanvas, 'repeat') : null;
      if (pattern && patternCanvas) {
        nextCtx.save();
        nextCtx.globalAlpha = getNumeric(noiseFilter.settings.opacity, 0);
        nextCtx.globalCompositeOperation = 'soft-light';
        nextCtx.translate(
          -((origin.x % patternCanvas.width) + patternCanvas.width) % patternCanvas.width,
          -((origin.y % patternCanvas.height) + patternCanvas.height) % patternCanvas.height,
        );
        nextCtx.fillStyle = pattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + patternCanvas.width, nextCanvas.height + patternCanvas.height);
        nextCtx.restore();
      }
      swap(nextCanvas);
    }
  }

  return currentCanvas;
};
