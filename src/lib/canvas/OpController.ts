/**
 * OpController - Operation tracking and cancellation for canvas operations
 *
 * Every preview/finalize run gets an opId. Only the latest operation's results may commit.
 * Provides cancel tokens to workers and early-return paths.
 */

export type OpId = number;
export type CancelToken = { cancelled: boolean };

export class OpController {
  private nextId = 1;
  latestPreviewId: OpId = 0;
  latestFinalizeId: OpId = 0;

  newPreview(): { id: OpId; token: CancelToken } {
    const id = this.nextId++;
    this.latestPreviewId = id;
    return { id, token: { cancelled: false } };
  }

  newFinalize(): { id: OpId; token: CancelToken } {
    const id = this.nextId++;
    this.latestFinalizeId = id;
    return { id, token: { cancelled: false } };
  }

  isCurrentPreview(id: OpId): boolean {
    return id === this.latestPreviewId;
  }

  isCurrentFinalize(id: OpId): boolean {
    return id === this.latestFinalizeId;
  }

  cancelAllPreviews(): void {
    // Create a new preview id to invalidate all previous ones
    this.latestPreviewId = this.nextId++;
  }

  cancelAllFinalizes(): void {
    // Create a new finalize id to invalidate all previous ones
    this.latestFinalizeId = this.nextId++;
  }

  reset(): void {
    this.nextId = 1;
    this.latestPreviewId = 0;
    this.latestFinalizeId = 0;
  }
}
