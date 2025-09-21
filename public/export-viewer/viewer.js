const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err ?? new Error('Failed to load image'));
    img.src = src;
  });
};

const applyLayer = (ctx, img, layer, scale) => {
  const frame = layer.frame;
  const transform = layer.transform;
  const sourceSize = layer.sourceSize;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1));
  ctx.globalCompositeOperation = layer.blendMode || 'source-over';
  ctx.translate(frame.x, frame.y);
  ctx.translate(transform.translateX, transform.translateY);
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.drawImage(img, 0, 0, sourceSize.width, sourceSize.height);
  ctx.restore();
};

const validateMetadata = (metadata) => {
  if (!metadata || metadata.format !== 'tinybrush-webgl') {
    throw new Error('Unsupported bundle format');
  }
  if (!metadata.viewport || !metadata.viewport.width || !metadata.viewport.height) {
    throw new Error('Missing viewport dimensions');
  }
  if (!Array.isArray(metadata.layers)) {
    throw new Error('Layers array missing or invalid');
  }
};

export const renderTinyBrushWebGL = async (metadata, canvas, options = {}) => {
  validateMetadata(metadata);
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const width = Math.max(1, Math.round(metadata.viewport.width * scale));
  const height = Math.max(1, Math.round(metadata.viewport.height * scale));

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  const visibleLayers = metadata.layers.filter((layer) => layer.assets?.texture);
  const images = await Promise.all(
    visibleLayers.map((layer) => loadImage(layer.assets.texture))
  );

  visibleLayers.forEach((layer, index) => {
    applyLayer(ctx, images[index], layer, scale);
  });

  return {
    viewport: metadata.viewport,
    animation: metadata.animation,
    layers: visibleLayers.length
  };
};
