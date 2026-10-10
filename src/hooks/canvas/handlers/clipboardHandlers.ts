import studioExtension from '@/extensions/studioExtension';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugWarn } from '@/utils/debug';
import type { ClipboardHandlers, EventHandlerDependencies } from '../utils/types';

const cloneClipboardImageData = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

const isTextPasteTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return ['text', 'search', 'email', 'url', 'password', 'tel', 'number'].includes(
      (target.type || 'text').toLowerCase(),
    );
  }

  let current: HTMLElement | null = target;
  while (current) {
    const contentEditable = current.getAttribute('contenteditable');
    if (
      current.isContentEditable
      || current.contentEditable === 'true'
      || current.contentEditable === 'plaintext-only'
      || contentEditable === ''
      || contentEditable === 'true'
      || contentEditable === 'plaintext-only'
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

export const createClipboardHandlers = (
  deps: EventHandlerDependencies
): Pick<ClipboardHandlers, 'handlePaste'> => {
  const applyInternalClipboardPaste = (clipboardPayload: NonNullable<EventHandlerDependencies['selectionClipboardRef']>['current']) => {
    const getViewportPastePosition = deps.getViewportPastePosition;
    const selectionClipboardRef = deps.selectionClipboardRef;
    if (!getViewportPastePosition || !selectionClipboardRef) {
      return false;
    }

    if (!clipboardPayload) {
      return false;
    }

    const viewportPosition =
      clipboardPayload.mode === 'cut'
        ? clipboardPayload.position
        : getViewportPastePosition(clipboardPayload.width, clipboardPayload.height);
    const position = viewportPosition ?? { ...clipboardPayload.position };

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
      colorCycleGradientIds: clipboardPayload.colorCycleGradientIds ?? null,
      colorCycleSlotPalettes: clipboardPayload.colorCycleSlotPalettes ?? null,
      colorCycleGradientDefIds: clipboardPayload.colorCycleGradientDefIds ?? null,
      colorCycleGradientDefs: clipboardPayload.colorCycleGradientDefs ?? null,
      colorCycleSpeed: clipboardPayload.colorCycleSpeed ?? null,
      colorCycleFlow: clipboardPayload.colorCycleFlow ?? null,
      colorCyclePhase: clipboardPayload.colorCyclePhase ?? null,
      colorCycleSelectionMasks: clipboardPayload.colorCycleSelectionMasks
        ? {
            membership: clipboardPayload.colorCycleSelectionMasks.membership.slice(),
            eraseAlpha: clipboardPayload.colorCycleSelectionMasks.eraseAlpha?.slice() ?? null,
            softEdgeAlpha: clipboardPayload.colorCycleSelectionMasks.softEdgeAlpha?.slice() ?? null,
          }
        : null,
    });

    requestAnimationFrame(() => {
      const canvas = deps.canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
    });

    return true;
  };

  const handlePaste = async (event: ClipboardEvent) => {
    if (isTextPasteTarget(event.target)) {
      return;
    }
    const extensionHandled = await studioExtension.handleClipboardAction?.({
      action: 'paste',
      event,
    });
    if (extensionHandled) {
      event.preventDefault();
      return;
    }
    const getViewportPastePosition = deps.getViewportPastePosition;
    const selectionClipboardRef = deps.selectionClipboardRef;
    if (!getViewportPastePosition || !selectionClipboardRef) {
      return;
    }
    event.preventDefault();

    const applyAfterPendingCommit = async (apply: () => void) => {
      try {
        if (getAppStoreState().floatingPaste) {
          await deps.commitFloatingPaste();
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          debugWarn('raw-console', '[floatingPaste] Failed to commit existing floating before paste', error);
        }
        return;
      }
      // Refusals retain the recoverable float. Read the live owner, since React may
      // lag behind a commit or another paste sharing that commit may have won admission.
      if (getAppStoreState().floatingPaste) return;
      apply();
    };

    const project = deps.dynamicDepsRef.current.project;
    const clipboardPayload = selectionClipboardRef.current;
    const clipboardHtml = event.clipboardData?.getData?.('text/html');
    const clipboardTemplate = document.createElement('template');
    clipboardTemplate.innerHTML = clipboardHtml ?? '';
    const nativeClipboardId = clipboardTemplate.content.querySelector('img[data-vessel-selection]')
      ?.getAttribute('data-vessel-selection');
    // Indexed planes and Cut positioning belong only to this exact native copy.
    if (clipboardPayload?.clipboardId && nativeClipboardId === clipboardPayload.clipboardId) {
      await applyAfterPendingCommit(() => applyInternalClipboardPaste(clipboardPayload));
      return;
    }

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

            tempCanvas.width = img.width;
            tempCanvas.height = img.height;

            const imageX = 0;
            const imageY = 0;
            const imageWidth = img.width;
            const imageHeight = img.height;

            const fallbackPosition = {
              x: Math.max(0, Math.min(project.width - imageWidth, imageX)),
              y: Math.max(0, Math.min(project.height - imageHeight, imageY)),
            };
            const viewportPosition = getViewportPastePosition(imageWidth, imageHeight) ?? fallbackPosition;

            tempCtx.drawImage(img, 0, 0);
            const pasteImageData = tempCtx.getImageData(imageX, imageY, imageWidth, imageHeight);

            await applyAfterPendingCommit(() => {
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
    if (!items?.length && !event.clipboardData?.types?.length) {
      await applyAfterPendingCommit(() => applyInternalClipboardPaste(clipboardPayload));
    }
  };

  return {
    handlePaste,
  };
};
