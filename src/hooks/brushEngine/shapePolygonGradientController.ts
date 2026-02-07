import type { Point2D, PolygonGradientData, PolygonGradientSettings } from './shapeTypes';

type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

export type DrawPolygonGradientArgs = {
  ctx: CanvasRenderingContext2D;
  polygonData: PolygonGradientData;
  isPreview?: boolean;
  brushSettings: PolygonGradientSettings;
  withTransparencyLock: (ctx: CanvasRenderingContext2D, draw: () => void) => void;
  setBlendIfUnlocked: (ctx: CanvasRenderingContext2D) => void;
  canvasPool: CanvasPoolLike;
  applyDithering: (
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => ImageData;
  applyDitheringWithFillResolution: (
    imageData: ImageData,
    numColors: number,
    fillResolution: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => ImageData;
  applyRisographEffect: (
    ctx: CanvasRenderingContext2D,
    vertices: Point2D[],
    risographIntensity: number
  ) => void;
};

type OrderedColor = { color: string; position: number };

const getFurthestPoints = (vertices: Point2D[]) => {
  let maxDistance = 0;
  let point1 = vertices[0];
  let point2 = vertices[1];

  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      const dx = vertices[j].x - vertices[i].x;
      const dy = vertices[j].y - vertices[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDistance) {
        maxDistance = dist;
        point1 = vertices[i];
        point2 = vertices[j];
      }
    }
  }

  return { point1, point2 };
};

const getOrderedUniqueColors = (
  validVertices: Point2D[],
  validColors: string[],
  point1: Point2D,
  point2: Point2D
): OrderedColor[] => {
  const gradientVector = { x: point2.x - point1.x, y: point2.y - point1.y };
  const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
  const gradientDir = { x: gradientVector.x / gradientLength, y: gradientVector.y / gradientLength };

  const colorPositions = validVertices.map((vertex, index) => {
    const toVertex = { x: vertex.x - point1.x, y: vertex.y - point1.y };
    const projectionDistance = toVertex.x * gradientDir.x + toVertex.y * gradientDir.y;
    const position = Math.max(0, Math.min(1, projectionDistance / gradientLength));
    return { position, color: validColors[index] };
  });

  colorPositions.sort((a, b) => a.position - b.position);

  const uniqueColorsMap = new Map<string, number>();
  const orderedUniqueColors: OrderedColor[] = [];

  for (const item of colorPositions) {
    if (!uniqueColorsMap.has(item.color)) {
      uniqueColorsMap.set(item.color, item.position);
      orderedUniqueColors.push({ color: item.color, position: item.position });
    }
  }

  return orderedUniqueColors;
};

const addPolygonGradientStops = ({
  gradient,
  validColors,
  validVertices,
  point1,
  point2,
  brushSettings,
  useBanding,
}: {
  gradient: CanvasGradient;
  validColors: string[];
  validVertices: Point2D[];
  point1: Point2D;
  point2: Point2D;
  brushSettings: PolygonGradientSettings;
  useBanding: boolean;
}) => {
  if (validColors.length === 0) {
    const defaultColor = brushSettings.color || '#000000';
    gradient.addColorStop(0, defaultColor);
    gradient.addColorStop(1, defaultColor);
    return;
  }

  if (validColors.length === validVertices.length) {
    const orderedUniqueColors = getOrderedUniqueColors(validVertices, validColors, point1, point2);
    const numColors = brushSettings.gradientBands || brushSettings.colors || orderedUniqueColors.length;

    if (useBanding && brushSettings.gradientBands && brushSettings.gradientBands > 0) {
      const bandCount = Math.min(numColors, orderedUniqueColors.length);
      for (let i = 0; i < bandCount; i += 1) {
        const sourceIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (orderedUniqueColors.length - 1));
        const color = orderedUniqueColors[sourceIndex].color;
        const startPos = i / bandCount;
        const endPos = (i + 1) / bandCount;

        if (i === 0) {
          gradient.addColorStop(0, color);
        } else {
          gradient.addColorStop(startPos, color);
        }

        if (i === bandCount - 1) {
          gradient.addColorStop(1, color);
        } else {
          gradient.addColorStop(endPos - 0.001, color);
        }
      }
      return;
    }

    if (orderedUniqueColors.length <= numColors) {
      orderedUniqueColors.forEach((item, index) => {
        const position = index / Math.max(1, orderedUniqueColors.length - 1);
        gradient.addColorStop(position, item.color);
      });
    } else {
      for (let i = 0; i < numColors; i += 1) {
        const sourceIndex = Math.floor((i / Math.max(1, numColors - 1)) * (orderedUniqueColors.length - 1));
        const position = i / Math.max(1, numColors - 1);
        gradient.addColorStop(position, orderedUniqueColors[sourceIndex].color);
      }
    }

    return;
  }

  if (validColors.length === 1) {
    gradient.addColorStop(0, validColors[0]);
    gradient.addColorStop(1, validColors[0]);
  } else {
    gradient.addColorStop(0, validColors[0]);
    gradient.addColorStop(1, validColors[validColors.length - 1]);
  }
};

const drawPolygonFill = (ctx: CanvasRenderingContext2D, vertices: Point2D[]) => {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  vertices.slice(1).forEach((vertex) => ctx.lineTo(vertex.x, vertex.y));
  ctx.closePath();
  ctx.fill();
};

export const drawPolygonGradient = ({
  ctx,
  polygonData,
  isPreview = false,
  brushSettings,
  withTransparencyLock,
  setBlendIfUnlocked,
  canvasPool,
  applyDithering,
  applyDitheringWithFillResolution,
  applyRisographEffect,
}: DrawPolygonGradientArgs): void => {
  const { vertices, colors } = polygonData || {};

  if (!polygonData || !vertices || !Array.isArray(vertices) || vertices.length < 3) {
    console.warn('[drawPolygonGradient] Skipping - insufficient vertices:', vertices?.length || 0);
    return;
  }

  const validVertices = vertices.filter((v) => v && typeof v.x === 'number' && typeof v.y === 'number');
  if (validVertices.length < 3) {
    return;
  }

  if (typeof window !== 'undefined') {
    const firstVertex = validVertices[0];
    if (firstVertex) {
      window.__AL_sample = { x: firstVertex.x, y: firstVertex.y, tag: 'polyGrad' };
    }
  }

  const minX = Math.floor(Math.min(...validVertices.map((v) => v.x)));
  const minY = Math.floor(Math.min(...validVertices.map((v) => v.y)));
  const maxX = Math.ceil(Math.max(...validVertices.map((v) => v.x)));
  const maxY = Math.ceil(Math.max(...validVertices.map((v) => v.y)));
  const boundWidth = maxX - minX;
  const boundHeight = maxY - minY;

  const { point1, point2 } = getFurthestPoints(validVertices);
  const gradient = ctx.createLinearGradient(point1.x, point1.y, point2.x, point2.y);
  const validColors = colors?.filter((c) => c !== undefined && c !== null && typeof c === 'string') || [];

  addPolygonGradientStops({
    gradient,
    validColors,
    validVertices,
    point1,
    point2,
    brushSettings,
    useBanding: true,
  });

  withTransparencyLock(ctx, () => {
    ctx.save();
    ctx.globalAlpha = brushSettings.opacity;
    setBlendIfUnlocked(ctx);

    const willApplyDithering = brushSettings.ditherEnabled && !isPreview;

    if (willApplyDithering && boundWidth > 0 && boundHeight > 0) {
      const padding = 2;
      const paddedWidth = boundWidth + padding * 2;
      const paddedHeight = boundHeight + padding * 2;
      const tempCanvas = canvasPool.acquire(paddedWidth, paddedHeight);
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

      if (tempCtx && tempCanvas.width > 0 && tempCanvas.height > 0) {
        tempCtx.clearRect(0, 0, paddedWidth, paddedHeight);

        const localGradient = tempCtx.createLinearGradient(
          point1.x - minX + padding,
          point1.y - minY + padding,
          point2.x - minX + padding,
          point2.y - minY + padding
        );

        addPolygonGradientStops({
          gradient: localGradient,
          validColors,
          validVertices,
          point1,
          point2,
          brushSettings,
          useBanding: false,
        });

        tempCtx.fillStyle = localGradient;
        tempCtx.fillRect(0, 0, paddedWidth, paddedHeight);

        const gradientImageData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
        const numColors = brushSettings.gradientBands || brushSettings.colors || 2;
        const fillResolution = brushSettings.fillResolution || 1;
        const algorithm = brushSettings.ditherAlgorithm || 'sierra-lite';
        const patternStyle = brushSettings.patternStyle || 'dots';

        const ditheredData = fillResolution > 1
          ? applyDitheringWithFillResolution(
              gradientImageData,
              numColors,
              fillResolution,
              algorithm,
              patternStyle,
              validColors
            )
          : applyDithering(gradientImageData, numColors, algorithm, patternStyle, validColors);

        tempCtx.putImageData(ditheredData, 0, 0);

        const localVertices = validVertices.map((vertex) => ({
          x: Math.round(vertex.x - minX + padding),
          y: Math.round(vertex.y - minY + padding),
        }));

        if (localVertices.length >= 3) {
          tempCtx.save();
          tempCtx.imageSmoothingEnabled = false;
          tempCtx.globalCompositeOperation = 'destination-in';
          tempCtx.lineJoin = 'miter';
          tempCtx.lineCap = 'butt';
          tempCtx.fillStyle = '#fff';
          tempCtx.beginPath();
          tempCtx.moveTo(localVertices[0].x, localVertices[0].y);
          for (let i = 1; i < localVertices.length; i += 1) {
            tempCtx.lineTo(localVertices[i].x, localVertices[i].y);
          }
          tempCtx.closePath();
          tempCtx.fill();
          tempCtx.restore();

          const maskData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
          const pixels = maskData.data;
          for (let i = 3; i < pixels.length; i += 4) {
            pixels[i] = pixels[i] > 0 ? 255 : 0;
          }
          tempCtx.putImageData(maskData, 0, 0);
        }

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tempCanvas, minX - padding, minY - padding);
        canvasPool.release(tempCanvas);

        const risographIntensity = brushSettings.risographIntensity || 0;
        if (risographIntensity > 0 && !isPreview) {
          applyRisographEffect(ctx, validVertices, risographIntensity);
        }
      } else {
        canvasPool.release(tempCanvas);
        ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = gradient;
        drawPolygonFill(ctx, validVertices);
      }
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = gradient;
      drawPolygonFill(ctx, validVertices);

      const risographIntensity = brushSettings.risographIntensity || 0;
      if (risographIntensity > 0 && !isPreview) {
        applyRisographEffect(ctx, validVertices, risographIntensity);
      }
    }

    ctx.restore();
  });
};
