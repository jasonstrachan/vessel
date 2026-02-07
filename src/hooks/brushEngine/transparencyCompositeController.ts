export const withTransparencyLockComposite = ({
  ctx,
  isTransparencyLocked,
  draw,
}: {
  ctx: CanvasRenderingContext2D;
  isTransparencyLocked: boolean;
  draw: () => void;
}): void => {
  if (!isTransparencyLocked) {
    draw();
    return;
  }

  const previousComposite = ctx.globalCompositeOperation;
  try {
    ctx.globalCompositeOperation = 'source-atop';
    draw();
  } finally {
    ctx.globalCompositeOperation = previousComposite;
  }
};

export const setBlendModeIfUnlocked = ({
  ctx,
  isTransparencyLocked,
  blendMode,
}: {
  ctx: CanvasRenderingContext2D;
  isTransparencyLocked: boolean;
  blendMode?: GlobalCompositeOperation;
}): void => {
  if (isTransparencyLocked) {
    return;
  }
  ctx.globalCompositeOperation = blendMode || 'source-over';
};

export const setMultiplyIfUnlocked = ({
  ctx,
  isTransparencyLocked,
}: {
  ctx: CanvasRenderingContext2D;
  isTransparencyLocked: boolean;
}): void => {
  if (isTransparencyLocked) {
    return;
  }
  ctx.globalCompositeOperation = 'multiply';
};
