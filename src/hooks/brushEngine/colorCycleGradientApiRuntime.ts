import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';

import {
  bindColorCycleGradientDefIdToSlot,
  ColorCycleDefBindingRuntime,
  type ColorCycleGradientDefSlotBindingContext,
} from './colorCycleDefBindingRuntime';
import {
  resolveColorCycleCapturedStampGradientBinding,
  resolveColorCycleGradientDefIdForSlot,
  syncColorCycleGradientDefRuntime,
  type CapturedStampGradientBinding,
  type ColorCycleCapturedStampGradientContext,
  type ColorCycleGradientDefSyncContext,
} from './colorCycleGradientDefRuntime';
import type { LayerStrokeState, SerializedLayerColorCycleMeta } from './colorCycleCanvas2DTypes';
import {
  getColorCycleActiveGradientSlots,
  getColorCycleActiveGradientSlot,
  setColorCycleActiveGradientSlot,
  setColorCycleGradient,
  setColorCycleGradientSlot,
  setColorCycleGradientSlotStops,
  updateColorCycleGradient,
  type ColorCycleActiveGradientSlotContext,
} from './colorCycleActiveGradientSlotRuntime';
import { ColorCycleGradientSlotState } from './colorCycleGradientSlotState';
import type {
  CustomBrushColorCycleData,
  CustomBrushColorCycleMode,
} from '@/types';

export type ColorCycleGradientApiRuntimeDeps = {
  getActiveLayerId(): string | null;
  setActiveLayerId(layerId: string): void;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  ensureStrokeState(layerId: string): LayerStrokeState;
  getAnimator(layerId: string): ColorCycleAnimator;
  getAnimatorIfExists(layerId: string): ColorCycleAnimator | undefined;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getLayerColorCycleMeta(layerId: string): SerializedLayerColorCycleMeta | null;
  setLayerMeta(layerId: string, meta: SerializedLayerColorCycleMeta | null): void;
  getLayerDocumentVersion(layerId: string): number | null;
  setRuntimeGradientStops(stops: GradientStop[], builtFromVersion: number | null): void;
  shouldPreserveGradientPhaseOnChange(): boolean;
  resetStampCounter(): void;
  snapshotFromBuffers(strokeData: LayerStrokeState): void;
  markPresenterLayerDirty(layerId: string): void;
  render(force?: boolean): void;
  setPreserveGradientPhase(enabled: boolean): void;
};

export class ColorCycleGradientApiRuntime {
  private readonly defBindingRuntime = new ColorCycleDefBindingRuntime();
  private readonly gradientSlotState = new ColorCycleGradientSlotState();

  constructor(
    private readonly deps: ColorCycleGradientApiRuntimeDeps,
  ) {}

  readonly setPreserveGradientPhase = (enabled: boolean): void => {
    this.deps.setPreserveGradientPhase(enabled);
  };

  readonly setGradient = (stops: GradientStop[], layerId?: string): void => {
    setColorCycleGradient(this.getActiveGradientSlotContext(), stops, layerId);
  };

  readonly setGradientSlot = (
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ): void => {
    setColorCycleGradientSlot(
      this.getActiveGradientSlotContext(),
      layerId,
      slot,
      stops,
      seamProfile,
    );
  };

  readonly setGradientSlotStops = (
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ): void => {
    setColorCycleGradientSlotStops(
      this.getActiveGradientSlotContext(),
      layerId,
      slot,
      stops,
      seamProfile,
    );
  };

  readonly setActiveGradientSlot = (layerId: string, slot: number): void => {
    setColorCycleActiveGradientSlot(
      this.getActiveGradientSlotContext(),
      layerId,
      slot,
    );
  };

  readonly getActiveGradientSlot = (layerId?: string): number => (
    getColorCycleActiveGradientSlot(this.getActiveGradientSlotContext(), layerId)
  );

  readonly getActiveGradientSlots = (): ReadonlyMap<string, number> => (
    getColorCycleActiveGradientSlots(this.getActiveGradientSlotContext())
  );

  readonly getActiveSlot = (layerId: string): number => (
    this.gradientSlotState.getActiveSlot(layerId)
  );

  readonly getActiveSlotsView = (): ReadonlyMap<string, number> => (
    this.gradientSlotState.getActiveSlotsView()
  );

  readonly setActiveSlot = (
    layerId: string,
    slot: number,
    builtFromVersion: number | null,
  ): void => {
    this.gradientSlotState.setActiveSlot(layerId, slot, builtFromVersion);
  };

  readonly getSlotStops = (layerId: string, slot: number): GradientStop[] | undefined => (
    this.gradientSlotState.getSlotStops(layerId, slot)
  );

  readonly getSlotSeamProfile = (layerId: string, slot: number): GradientSeamProfile => (
    this.gradientSlotState.getSlotSeamProfile(layerId, slot)
  );

  readonly getSlotSignature = (layerId: string, slot: number): string | undefined => (
    this.gradientSlotState.getSlotSignature(layerId, slot)
  );

  readonly setSlot = (
    layerId: string,
    slot: number,
    stops: GradientStop[],
    signature: string,
    seamProfile: GradientSeamProfile,
    builtFromVersion: number | null,
  ): void => {
    this.gradientSlotState.setSlot(layerId, slot, stops, signature, seamProfile, builtFromVersion);
  };

  readonly getActiveGradientSignature = (layerId: string): string | undefined => (
    this.gradientSlotState.getActiveGradientSignature(layerId)
  );

  readonly setActiveGradientSignature = (
    layerId: string,
    signature: string,
    builtFromVersion: number | null,
  ): void => {
    this.gradientSlotState.setActiveGradientSignature(layerId, signature, builtFromVersion);
  };

  readonly syncGradientDefRuntime = (layerId: string): void => {
    syncColorCycleGradientDefRuntime(this.getGradientDefSyncContext(), layerId);
  };

  readonly bindGradientDefIdToSlot = (
    layerId: string,
    defId: number,
    slot: number,
    bbox?: {
      minX: number;
      minY: number;
      width: number;
      height: number;
    },
    previewSlot?: number | null,
  ): void => {
    bindColorCycleGradientDefIdToSlot(
      this.getGradientDefSlotBindingContext(),
      layerId,
      defId,
      slot,
      bbox,
      previewSlot,
    );
  };

  readonly applyDefBindingsForLayer = (
    layerId: string,
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState | undefined,
    defs: Array<{ id: number; hash: string; stops: GradientStop[]; seamProfile?: GradientSeamProfile }> | undefined,
    options?: { forceDefDirty?: boolean },
  ): void => {
    this.defBindingRuntime.applyForLayer({
      layerId,
      animator,
      strokeData,
      defs,
      builtFromVersion: this.deps.getLayerDocumentVersion(layerId),
      forceDefDirty: options?.forceDefDirty,
    });
  };

  readonly clearDefBindings = (): void => {
    this.defBindingRuntime.clear();
  };

  readonly clearGradientSlots = (): void => {
    this.gradientSlotState.clear();
  };

  readonly getLastAppliedDefBinding = (layerId: string) => (
    this.defBindingRuntime.getLastApplied(layerId)
  );

  readonly updateGradient = async (
    gradient: Array<{ position: number; color: string; opacity?: number }>,
  ): Promise<void> => {
    updateColorCycleGradient(this.getActiveGradientSlotContext(), gradient);
  };

  readonly resolveGradientDefIdForSlot = (layerId: string, slot: number): number | null => (
    resolveColorCycleGradientDefIdForSlot(
      this.getCapturedStampGradientContext(),
      layerId,
      slot,
    )
  );

  readonly resolveCapturedStampGradientBinding = (
    layerId: string,
    colorCycle: CustomBrushColorCycleData | undefined,
    mode: CustomBrushColorCycleMode | undefined,
  ): CapturedStampGradientBinding | null => (
    resolveColorCycleCapturedStampGradientBinding(
      this.getCapturedStampGradientContext(),
      layerId,
      colorCycle,
      mode,
    )
  );

  private getLayerGradientDefs(layerId: string): Array<{
    id: number;
    hash: string;
    stops: GradientStop[];
    seamProfile?: GradientSeamProfile;
  }> | undefined {
    return this.deps.getLayerColorCycleMeta(layerId)?.gradientDefStore as
      | Array<{ id: number; hash: string; stops: GradientStop[]; seamProfile?: GradientSeamProfile }>
      | undefined;
  }

  private getCapturedStampGradientContext(): ColorCycleCapturedStampGradientContext {
    return {
      setGradientSlotStops: (layerId, slot, stops, seamProfile) => {
        this.setGradientSlotStops(layerId, slot, stops, seamProfile);
      },
      setLayerMeta: (layerId, meta) => {
        this.deps.setLayerMeta(layerId, meta);
      },
      getLayerColorCycleMeta: (layerId) => this.deps.getLayerColorCycleMeta(layerId),
    };
  }

  private getGradientDefSyncContext(): ColorCycleGradientDefSyncContext {
    return {
      getActiveLayerId: () => this.deps.getActiveLayerId(),
      getAnimator: (layerId) => this.deps.getAnimatorIfExists(layerId),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      getLayerGradientDefs: (layerId) => this.getLayerGradientDefs(layerId),
      applyDefBindingsForLayer: (layerId, animator, strokeData, defs) => {
        this.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
      },
      markPresenterLayerDirty: (layerId) => this.deps.markPresenterLayerDirty(layerId),
      render: (force) => this.deps.render(force),
    };
  }

  private getActiveGradientSlotContext(): ColorCycleActiveGradientSlotContext {
    return {
      getActiveLayerId: () => this.deps.getActiveLayerId(),
      getActiveSlotsView: () => this.getActiveSlotsView(),
      getActiveSlot: (layerId) => this.getActiveSlot(layerId),
      setActiveSlot: (layerId, slot, builtFromVersion) =>
        this.setActiveSlot(layerId, slot, builtFromVersion),
      setActiveLayerId: (layerId) => this.deps.setActiveLayerId(layerId),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      getSlotStops: (layerId, slot) => this.getSlotStops(layerId, slot),
      getSlotSeamProfile: (layerId, slot) => this.getSlotSeamProfile(layerId, slot),
      getSlotSignature: (layerId, slot) => this.getSlotSignature(layerId, slot),
      setSlot: (layerId, slot, stops, signature, seamProfile, builtFromVersion) =>
        this.setSlot(layerId, slot, stops, signature, seamProfile, builtFromVersion),
      getActiveGradientSignature: (layerId) => this.getActiveGradientSignature(layerId),
      setActiveGradientSignature: (layerId, signature, builtFromVersion) =>
        this.setActiveGradientSignature(layerId, signature, builtFromVersion),
      getLayerDocumentVersion: (layerId) => this.deps.getLayerDocumentVersion(layerId),
      getAnimator: (layerId) => this.deps.getAnimator(layerId),
      setRuntimeGradientStops: (stops, builtFromVersion) =>
        this.deps.setRuntimeGradientStops(stops, builtFromVersion),
      shouldPreserveGradientPhaseOnChange: () => this.deps.shouldPreserveGradientPhaseOnChange(),
      resetStampCounter: () => this.deps.resetStampCounter(),
      flowSlotMask: FLOW_SLOT_MASK,
    };
  }

  private getGradientDefSlotBindingContext(): ColorCycleGradientDefSlotBindingContext {
    return {
      ensureStrokeState: (layerId) => this.deps.ensureStrokeState(layerId),
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      getAnimator: (layerId) => this.deps.getAnimatorIfExists(layerId) ?? this.deps.getAnimator(layerId),
      getLayerGradientDefs: (layerId) => this.getLayerGradientDefs(layerId),
      applyDefBindingsForLayer: (layerId, animator, strokeData, defs, options) =>
        this.applyDefBindingsForLayer(layerId, animator, strokeData, defs, options),
      snapshotFromBuffers: (strokeData) => this.deps.snapshotFromBuffers(strokeData),
      flowSlotMask: FLOW_SLOT_MASK,
    };
  }
}
