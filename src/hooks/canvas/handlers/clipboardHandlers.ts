import type { ClipboardHandlers, EventHandlerDependencies } from '../utils/types';

const cloneClipboardImageData = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

export const createClipboardHandlers = (
  deps: EventHandlerDependencies
): Pick<ClipboardHandlers, 'handlePaste'> => {
  const handlePaste = async (event: ClipboardEvent) => {
    const getViewportPastePosition = deps.getViewportPastePosition;
    const selectionClipboardRef = deps.selectionClipboardRef;
    if (!getViewportPastePosition || !selectionClipboardRef) {
      return;
    }
    event.preventDefault();

    const commitExistingFloatingIfPresent = async () => {
      if (!deps.dynamicDepsRef.current.floatingPaste) {
        return;
      }
      try {
        await deps.commitFloatingPaste();
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[floatingPaste] Failed to commit existing floating before paste', error);
        }
      }
    };

    const project = deps.dynamicDepsRef.current.project;
    const items = event.clipboardData?.items;
    let handled = false;

    if (items) {
      for (const item of items) {
        if (!item.type.includes('image')) {
          continue;
        }

        const blob = item.getAsFile();
        if (!blob) {
          continue;
        }

        handled = true;
        const reader = new FileReader();
        reader.onload = async (readerEvent) => {
          const img = new Image();
          img.onload = async () => {
            if (!project) {
              return;
            }

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            if (!tempCtx) {
              return;
            }

            tempCanvas.width = project.width;
            tempCanvas.height = project.height;

            const scale = Math.min(project.width / img.width, project.height / img.height, 1);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (project.width - scaledWidth) / 2;
            const y = (project.height - scaledHeight) / 2;
            const imageX = Math.floor(x);
            const imageY = Math.floor(y);
            const imageWidth = Math.ceil(scaledWidth);
            const imageHeight = Math.ceil(scaledHeight);

            const fallbackPosition = {
              x: Math.max(0, Math.min(project.width - imageWidth, imageX)),
              y: Math.max(0, Math.min(project.height - imageHeight, imageY)),
            };
            const viewportPosition = getViewportPastePosition(imageWidth, imageHeight) ?? fallbackPosition;

            tempCtx.drawImage(img, x, y, scaledWidth, scaledHeight);
            const pasteImageData = tempCtx.getImageData(imageX, imageY, imageWidth, imageHeight);

            await commitExistingFloatingIfPresent();
            deps.clearSelection();
            deps.setFloatingPaste({
              active: true,
              imageData: pasteImageData,
              position: viewportPosition,
              originalPosition: viewportPosition,
              width: imageWidth,
              height: imageHeight,
              displayWidth: imageWidth,
              displayHeight: imageHeight,
              rotation: 0,
              sourceLayerId: null,
              colorCycleIndices: null,
            });

            requestAnimationFrame(() => {
              const canvas = deps.canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            });
          };

          img.src = readerEvent.target?.result as string;
        };

        reader.readAsDataURL(blob);
        break;
      }
    }

    if (handled) {
      return;
    }

    const clipboardPayload = selectionClipboardRef.current;
    if (!clipboardPayload) {
      return;
    }

    const viewportPosition =
      clipboardPayload.mode === 'cut'
        ? clipboardPayload.position
        : getViewportPastePosition(clipboardPayload.width, clipboardPayload.height);

    const position = viewportPosition ?? { ...clipboardPayload.position };

    await commitExistingFloatingIfPresent();
    deps.clearSelection();
    deps.setFloatingPaste({
      active: true,
      imageData: cloneClipboardImageData(clipboardPayload.imageData),
      position,
      originalPosition: position,
      width: clipboardPayload.width,
      height: clipboardPayload.height,
      displayWidth: clipboardPayload.width,
      displayHeight: clipboardPayload.height,
      rotation: 0,
      sourceLayerId: clipboardPayload.colorCycleSourceLayerId ?? null,
      colorCycleIndices: clipboardPayload.colorCycleIndices ?? null,
    });

    requestAnimationFrame(() => {
      const canvas = deps.canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
    });
  };

  return {
    handlePaste,
  };
};
