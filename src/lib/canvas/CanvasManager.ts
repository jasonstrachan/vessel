/**
 * CanvasManager - Explicit canvas ownership by purpose
 *
 * Preview canvas: ephemeral, cleared at start of each new preview op,
 *                 never participates in compositing.
 *
 * Staging/final canvas: receives finalized geometry only.
 *
 * Animation canvas: owned by color cycle; its invalidation is driven by
 *                   animation ticks, not drawing ops.
 *
 * This lets you delete any "set drawingCanvasHasContent" global.
 * Each surface knows its own lifecycle.
 */

import type { OpId } from './OpController';

export interface CanvasOwnership {
  // Preview canvas state
  previewOpId: OpId | null;
  previewHasContent: boolean;

  // Final canvas state
  finalOpId: OpId | null;
  finalHasContent: boolean;

  // Animation canvas state
  animationActive: boolean;
  animationHasContent: boolean;
}

export class CanvasManager {
  private ownership: CanvasOwnership = {
    previewOpId: null,
    previewHasContent: false,
    finalOpId: null,
    finalHasContent: false,
    animationActive: false,
    animationHasContent: false,
  };

  // Preview canvas lifecycle
  startPreview(opId: OpId, canvas: HTMLCanvasElement): void {
    // Clear at START of each new preview op
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.ownership.previewOpId = opId;
    this.ownership.previewHasContent = false;
  }

  commitPreview(opId: OpId): boolean {
    if (this.ownership.previewOpId !== opId) {
      return false; // Stale operation
    }
    this.ownership.previewHasContent = true;
    return true;
  }

  clearPreview(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.ownership.previewOpId = null;
    this.ownership.previewHasContent = false;
  }

  isPreviewCurrent(opId: OpId): boolean {
    return this.ownership.previewOpId === opId;
  }

  hasPreviewContent(): boolean {
    return this.ownership.previewHasContent;
  }

  // Final canvas lifecycle
  startFinalize(opId: OpId): void {
    this.ownership.finalOpId = opId;
  }

  commitFinalize(opId: OpId): boolean {
    if (this.ownership.finalOpId !== opId) {
      return false; // Stale operation
    }
    this.ownership.finalHasContent = true;
    return true;
  }

  clearFinal(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.ownership.finalOpId = null;
    this.ownership.finalHasContent = false;
  }

  isFinalCurrent(opId: OpId): boolean {
    return this.ownership.finalOpId === opId;
  }

  hasFinalContent(): boolean {
    return this.ownership.finalHasContent;
  }

  // Animation canvas lifecycle
  startAnimation(): void {
    this.ownership.animationActive = true;
  }

  stopAnimation(): void {
    this.ownership.animationActive = false;
  }

  setAnimationContent(hasContent: boolean): void {
    this.ownership.animationHasContent = hasContent;
  }

  clearAnimation(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.ownership.animationHasContent = false;
  }

  isAnimationActive(): boolean {
    return this.ownership.animationActive;
  }

  hasAnimationContent(): boolean {
    return this.ownership.animationHasContent;
  }

  // Global state queries
  hasAnyContent(): boolean {
    return (
      this.ownership.previewHasContent ||
      this.ownership.finalHasContent ||
      this.ownership.animationHasContent
    );
  }

  reset(): void {
    this.ownership = {
      previewOpId: null,
      previewHasContent: false,
      finalOpId: null,
      finalHasContent: false,
      animationActive: false,
      animationHasContent: false,
    };
  }

  getOwnershipState(): Readonly<CanvasOwnership> {
    return { ...this.ownership };
  }
}
